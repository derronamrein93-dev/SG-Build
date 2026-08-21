/**
 * Kiosk device identity: enrollment codes in, revocable credentials out.
 *
 * Deliberately NOT marked `server-only`. It imports `pg`, so it can never reach
 * a client bundle, and the two behaviours most worth testing — that a credential
 * resolves to exactly one location, and that a consumed code cannot be replayed
 * — are ones a test must be able to drive directly. Same reasoning as
 * ../reports and ../customers.
 *
 * -- The line this module exists to hold --------------------------------------
 *
 * **The browser never says which tenant it is.** It presents an opaque
 * credential; the organization and location come off the row that credential
 * resolves to. There is no parameter on any function here that lets a caller
 * name an organization, and `resolveKioskDevice` cannot be given one.
 *
 * That is the same rule `loadReportByToken` follows, for the same reason: these
 * two are the only paths in FitOS where an unauthenticated party talks to the
 * database, so in both of them the hash match IS the authorization boundary and
 * RLS is not there to catch a mistake. A query inside `withService` here may be
 * keyed by a hash and nothing else.
 */
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { withService, withTenant, type TenantContext } from '../db/client';

/**
 * No 0/O, 1/I/L, 5/S, 8/B. A store manager reads this aloud across a shop floor
 * to someone holding an iPad, and every character they have to disambiguate is a
 * support call.
 */
const CODE_ALPHABET = '23467ACDEFGHJKMNPQRTUVWXYZ';
const CODE_BODY_LENGTH = 8;

/** Fifteen minutes: long enough to walk across a store, short enough to matter. */
export const ENROLLMENT_CODE_TTL_MINUTES = 15;

export type KioskDeviceStatus = 'enrolled' | 'suspended' | 'revoked';

export interface KioskIdentity {
  kioskDeviceId: string;
  organizationId: string;
  locationId: string;
  actingUserId: string;
  displayName: string;
  status: KioskDeviceStatus;
  strideGuideDeviceId: string | null;
  locationName: string;
  appVersion: string | null;
  lastSeenAt: string | null;
  enrolledAt: string;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Uppercase, strip anything that is not alphanumeric or a hyphen. */
export function normalizeEnrollmentCode(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/**
 * "Northside — Grand Ave" → NORTHSIDE, the readable half of NORTHSIDE-A7KF-9M2Q.
 *
 * The first word, not the first ten characters of the squashed name: a store
 * called "Northside — Grand Ave" should read as NORTHSIDE, not NORTHSIDEG.
 */
export function locationSlug(name: string): string {
  const words = String(name ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return (words[0] ?? '').slice(0, 12) || 'FITOS';
}

/**
 * ~38 bits of entropy in the random half, single use, fifteen-minute life.
 *
 * Short enough to read aloud, which is the whole point of the format, and
 * therefore not strong enough to be anything but short-lived: an enrollment
 * code is a bearer token that trades entropy for legibility, and the expiry and
 * the single-use flag are what pay for that trade. Attempt-rate limiting on the
 * redemption endpoint is the remaining control and is NOT implemented here —
 * see the kiosk phase doc.
 */
export function generateEnrollmentCode(name: string): string {
  const bytes = randomBytes(CODE_BODY_LENGTH);
  let body = '';
  for (let i = 0; i < CODE_BODY_LENGTH; i++) {
    body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) body += '-';
  }
  return `${locationSlug(name)}-${body}`;
}

/**
 * Mint an enrollment code for a location. Runs under the CALLER's tenant
 * context, so the organization is the caller's own and cannot be chosen.
 *
 * The plaintext is returned exactly once and never stored.
 */
export async function createEnrollmentCode(
  ctx: TenantContext,
  input: { displayName: string; strideGuideDeviceId?: string | null },
): Promise<{ code: string; expiresAt: string }> {
  const displayName = String(input.displayName ?? '').trim().slice(0, 60);
  if (!displayName) throw new Error('A display name is required.');

  const locationName = await withTenant(ctx, async (c) => {
    const { rows } = await c.query('select name from location where id = $1', [ctx.locationId]);
    if (!rows.length) throw new Error('Location not found.');
    // The Stride Guide unit, if one was named, must belong to this tenant. The
    // check runs under RLS on device_installation rather than against `device`,
    // which is a global table with no policy of its own.
    if (input.strideGuideDeviceId) {
      const { rows: inst } = await c.query(
        `select 1 from device_installation
          where device_id = $1 and location_id = $2 and removed_at is null limit 1`,
        [input.strideGuideDeviceId, ctx.locationId]);
      if (!inst.length) throw new Error('That Stride Guide unit is not installed at this location.');
    }
    return rows[0].name as string;
  });

  const code = generateEnrollmentCode(locationName);
  const expiresAt = await withService(async (c) => {
    const { rows } = await c.query(
      `insert into kiosk_enrollment_code
        (organization_id, location_id, code_hash, display_name,
         stride_guide_device_id, created_by_user_id, expires_at)
       values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' minutes')::interval)
       returning expires_at`,
      [ctx.organizationId, ctx.locationId, sha256(code), displayName,
       input.strideGuideDeviceId ?? null, ctx.userId ?? null,
       String(ENROLLMENT_CODE_TTL_MINUTES)]);
    return rows[0].expires_at.toISOString() as string;
  });
  return { code, expiresAt };
}

export class EnrollmentError extends Error {
  readonly reason: 'unknown_code' | 'expired' | 'already_used';
  constructor(reason: 'unknown_code' | 'expired' | 'already_used') {
    super(reason);
    this.name = 'EnrollmentError';
    this.reason = reason;
  }
}

/**
 * Redeem a code: bind a kiosk to a location and mint its credential.
 *
 * The caller is an unenrolled browser. It has no tenant context, so this runs
 * through the service role — keyed by the code hash, and by nothing else.
 *
 * Six things happen, in one transaction, or none of them do:
 *   1. the code is resolved by hash and checked for expiry and prior use
 *   2. a dedicated app_user is created with role 'kiosk_device' and no pin_hash
 *   3. the kiosk_device row is created, bound to the code's org and location
 *   4. a 256-bit credential is minted and stored hashed
 *   5. the code is marked consumed, so a replay finds `already_used`
 *   6. the plaintext credential is returned once, to be set as an httpOnly cookie
 */
export async function redeemEnrollmentCode(
  rawCode: string, appVersion: string | null,
): Promise<{ credential: string; identity: KioskIdentity }> {
  const code = normalizeEnrollmentCode(rawCode);
  if (code.length < 8) throw new EnrollmentError('unknown_code');

  return withService(async (c) => {
    const { rows } = await c.query(
      `select * from kiosk_enrollment_code where code_hash = $1 for update`, [sha256(code)]);
    if (!rows.length) throw new EnrollmentError('unknown_code');
    const ec = rows[0];
    if (ec.consumed_at) throw new EnrollmentError('already_used');
    if (new Date(ec.expires_at).getTime() <= Date.now()) throw new EnrollmentError('expired');

    const { rows: userRows } = await c.query(
      // No pin_hash and no auth_user_id: this row exists to satisfy the actor
      // column on fitting_session, and must never be a way to sign in.
      `insert into app_user (organization_id, location_id, first_name, last_name, role, active)
       values ($1,$2,$3,$4,'kiosk_device',true) returning id`,
      [ec.organization_id, ec.location_id, 'FitOS Kiosk', ec.display_name]);

    const credential = randomBytes(32).toString('base64url');
    const { rows: kioskRows } = await c.query(
      `insert into kiosk_device
        (organization_id, location_id, acting_user_id, display_name,
         stride_guide_device_id, credential_hash, app_version, last_seen_at)
       values ($1,$2,$3,$4,$5,$6,$7, now()) returning id`,
      [ec.organization_id, ec.location_id, userRows[0].id, ec.display_name,
       ec.stride_guide_device_id, sha256(credential), appVersion]);

    await c.query(
      `update kiosk_enrollment_code
          set consumed_at = now(), consumed_by_kiosk_device_id = $2
        where id = $1`, [ec.id, kioskRows[0].id]);

    const identity = await readIdentity(c, kioskRows[0].id);
    if (!identity) throw new EnrollmentError('unknown_code');
    return { credential, identity };
  });
}

async function readIdentity(c: any, kioskDeviceId: string): Promise<KioskIdentity | null> {
  const { rows } = await c.query(
    `select k.id, k.organization_id, k.location_id, k.acting_user_id, k.display_name,
            k.status, k.stride_guide_device_id, k.app_version, k.last_seen_at, k.enrolled_at,
            l.name as location_name
       from kiosk_device k join location l on l.id = k.location_id
      where k.id = $1`, [kioskDeviceId]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    kioskDeviceId: r.id,
    organizationId: r.organization_id,
    locationId: r.location_id,
    actingUserId: r.acting_user_id,
    displayName: r.display_name,
    status: r.status,
    strideGuideDeviceId: r.stride_guide_device_id,
    locationName: r.location_name,
    appVersion: r.app_version,
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
    enrolledAt: r.enrolled_at.toISOString(),
  };
}

/**
 * Resolve a credential to a kiosk. The ONLY way a request acquires tenant scope.
 *
 * Returns null for anything short of a live, enrolled device: no credential, an
 * unknown one, a suspended one, a revoked one. Fails closed in every case, and
 * takes no organization or location argument — there is nothing here for a
 * caller to get wrong.
 */
export async function resolveKioskDevice(credential: string | undefined | null)
  : Promise<KioskIdentity | null> {
  if (!credential || credential.length < 32) return null;
  const hash = sha256(credential);
  return withService(async (c) => {
    const { rows } = await c.query(
      `select id, credential_hash, status from kiosk_device where credential_hash = $1 limit 1`,
      [hash]);
    if (!rows.length) return null;
    // The index lookup already matched; this is belt and braces against a future
    // change to a non-unique predicate, and costs nothing.
    const stored = rows[0].credential_hash as Buffer;
    if (stored.length !== hash.length || !timingSafeEqual(stored, hash)) return null;
    if (rows[0].status !== 'enrolled') return null;
    return readIdentity(c, rows[0].id);
  });
}

/** The tenant context a kiosk request runs under. Derived, never supplied. */
export function contextFor(identity: KioskIdentity): TenantContext {
  return {
    organizationId: identity.organizationId,
    locationId: identity.locationId,
    userId: identity.actingUserId,
    // A kiosk sees one door. Never org-wide, whatever the organization's
    // default_customer_access says — that setting governs associates.
    bypassLocationScope: false,
  };
}

/** Heartbeat. Runs under the device's own context, so RLS applies. */
export async function touchKioskDevice(identity: KioskIdentity, appVersion: string | null) {
  await withTenant(contextFor(identity), async (c) => {
    await c.query(
      `update kiosk_device set last_seen_at = now(), app_version = coalesce($2, app_version)
        where id = $1`, [identity.kioskDeviceId, appVersion]);
  });
}

/**
 * Revoke a credential. Service role, because the application role has no update
 * grant on credential_hash — a compromised app process cannot re-mint one.
 */
export async function revokeKioskDevice(kioskDeviceId: string): Promise<void> {
  await withService(async (c) => {
    await c.query(
      `update kiosk_device
          set status = 'revoked', credential_hash = null,
              credential_version = credential_version + 1, revoked_at = now()
        where id = $1`, [kioskDeviceId]);
    await c.query(`update app_user set active = false
                    where id = (select acting_user_id from kiosk_device where id = $1)`,
      [kioskDeviceId]);
  });
}

/** Cookie name for the credential. httpOnly; JavaScript never reads it. */
export const KIOSK_COOKIE = 'fitos_kiosk_credential';
