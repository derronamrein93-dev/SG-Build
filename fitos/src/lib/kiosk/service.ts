/**
 * Associate service mode: the hidden operator door and what is behind it.
 *
 * Two separate concerns, both of which have a way of going wrong quietly:
 *
 * **Authentication.** The gate is an associate PIN, checked against
 * `app_user.pin_hash`. The hash format lives in ./pin, which is a leaf module
 * so that seeding a development PIN does not pull the fitting pipeline in.
 *
 * **Disclosure.** A customer sees "Stride Guide needs attention". An associate
 * sees "no pressure-matrix frames received for 12.4 seconds". Same underlying
 * state, two audiences, and the associate view is behind the PIN precisely
 * because the detailed one names firmware versions, serials and timings.
 *
 * What service mode is NOT: a way into the rest of FitOS. There is no customer
 * list here, no fitting history, no settings, and no link out. An associate who
 * needs those uses the associate app on their own device.
 */
import { withTenant } from '../db/client';
import { writeAudit } from '../db/audit';
import { KIOSK_AUDIT } from './session';
import { contextFor, type KioskIdentity } from './device';
import { readHardwareStatus, STALE_AFTER_MS, type HardwareStatus, type SubsystemHealth } from './hardware';
import { KioskError } from './errors';
import { verifyPin } from './pin';

export { hashPin, verifyPin } from './pin';

/** The version string the kiosk reports for itself. Bumped by hand, on purpose. */
export const KIOSK_APP_VERSION = '0.1.0-kiosk.1';

/**
 * Attempt throttling, per kiosk device, in process memory.
 *
 * Stated plainly because it matters: this is a single-process control. It is
 * adequate for a pilot running one Node instance and it is NOT adequate behind
 * more than one — a second instance has its own empty map. The durable version
 * is a counter column or a shared cache, and it belongs with real auth rather
 * than being half-built here. See the phase doc.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;
const attempts = new Map<string, { count: number; until: number }>();

export function pinLockoutRemainingMs(kioskDeviceId: string, now = Date.now()): number {
  const a = attempts.get(kioskDeviceId);
  if (!a || a.until <= now) return 0;
  return a.until - now;
}

function recordFailure(kioskDeviceId: string, now = Date.now()) {
  const a = attempts.get(kioskDeviceId) ?? { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) { a.until = now + LOCKOUT_MS; a.count = 0; }
  attempts.set(kioskDeviceId, a);
}

export function clearPinAttempts(kioskDeviceId: string) { attempts.delete(kioskDeviceId); }

/**
 * Authenticate an associate at this kiosk's own location.
 *
 * The PIN is matched against active associates AT THIS LOCATION only, and the
 * location comes off the kiosk's credential. A PIN that works in one store does
 * not open the panel in another, even within the same organization.
 *
 * Kiosk acting-users are excluded structurally by having no pin_hash, and by the
 * role filter as well — two independent reasons, because one of them being
 * removed later should not be enough.
 */
export async function authenticateAssociate(
  identity: KioskIdentity, pin: string,
): Promise<{ userId: string; firstName: string }> {
  if (pinLockoutRemainingMs(identity.kioskDeviceId) > 0) {
    throw new KioskError('service_auth_failed', 429);
  }
  if (!/^\d{4,8}$/.test(String(pin ?? ''))) {
    recordFailure(identity.kioskDeviceId);
    throw new KioskError('service_auth_failed', 401);
  }
  const ctx = contextFor(identity);
  const match = await withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select id, first_name, pin_hash from app_user
        where location_id = $1 and active
          and role in ('associate','manager','owner','org_admin')
          and pin_hash is not null`, [identity.locationId]);
    // Every candidate is checked, with no early return on a match, so the time
    // taken does not depend on which associate's PIN was entered.
    let found: { id: string; first_name: string } | null = null;
    for (const row of rows) {
      if (verifyPin(pin, row.pin_hash) && !found) found = row;
    }
    return found;
  });
  if (!match) {
    recordFailure(identity.kioskDeviceId);
    throw new KioskError('service_auth_failed', 401);
  }
  clearPinAttempts(identity.kioskDeviceId);
  await withTenant(ctx, (c) => writeAudit(c, {
    organizationId: identity.organizationId,
    locationId: identity.locationId,
    actorUserId: match.id,
    actorType: 'user',
    action: KIOSK_AUDIT.SERVICE_OPENED,
    subjectType: 'kiosk_device',
    subjectId: identity.kioskDeviceId,
    metadata: { app_version: KIOSK_APP_VERSION },
  }));
  return { userId: match.id, firstName: match.first_name };
}

export interface DiagnosticRow { label: string; value: string; health: SubsystemHealth }

export interface Diagnostics {
  deviceName: string;
  locationName: string;
  kioskDeviceId: string;
  rows: DiagnosticRow[];
  /** One sentence an associate can read to a support line. */
  summary: string;
}

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/**
 * The operational panel. Every row is a fact read from a record — there is no
 * row here whose value is "probably fine".
 */
export async function buildDiagnostics(identity: KioskIdentity): Promise<Diagnostics> {
  const ctx = contextFor(identity);
  const now = Date.now();
  const hw: HardwareStatus = await readHardwareStatus(ctx, identity.strideGuideDeviceId);

  const lastScan = await withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select max(sc.captured_at) as at from scan sc
         join fitting_session s on s.id = sc.fitting_session_id
        where s.location_id = $1`, [identity.locationId]);
    return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
  });

  const rows: DiagnosticRow[] = [
    { label: 'FitOS API', value: 'Connected', health: 'healthy' },
    { label: 'Kiosk', value: 'Online', health: 'healthy' },
    {
      label: 'Stride Guide',
      value: hw.connected ? 'Connected'
        : identity.strideGuideDeviceId ? 'No frames received' : 'No unit paired',
      health: hw.health.link,
    },
    { label: 'ESP32', value: hw.serial ?? '—', health: hw.serial ? 'healthy' : 'unknown' },
    {
      label: 'Pressure matrix',
      value: hw.health.pressureMatrix === 'healthy' ? 'Ready'
        : hw.connected ? 'Not reporting ready'
        : `No frames for ${hw.secondsSinceReading ?? '∞'}s`,
      health: hw.health.pressureMatrix,
    },
    {
      label: 'Load cells',
      value: hw.health.loadCells === 'healthy' ? 'Ready' : 'Not ready',
      health: hw.health.loadCells,
    },
    {
      label: 'Calibration',
      value: hw.calibrationValid ? `Valid · ${hw.calibrationVersion ?? 'unversioned'}`
        : hw.connected ? 'Invalid — run a setup check' : 'Unknown',
      health: hw.health.calibration,
    },
    { label: 'Last frame', value: ago(hw.lastReadingAt, now), health: hw.health.link },
    { label: 'Last scan', value: ago(lastScan, now), health: lastScan ? 'healthy' : 'unknown' },
    { label: 'Firmware', value: hw.firmwareVersion ?? '—', health: hw.firmwareVersion ? 'healthy' : 'unknown' },
    { label: 'FitOS app', value: KIOSK_APP_VERSION, health: 'healthy' },
    { label: 'Kiosk enrolled', value: ago(identity.enrolledAt, now), health: 'healthy' },
  ];

  const summary = hw.connected
    ? hw.calibrationValid
      ? 'All subsystems reporting healthy.'
      : `Unit is reporting but calibration is invalid (${hw.calibrationVersion ?? 'no version'}).`
    : identity.strideGuideDeviceId
      ? `No pressure-matrix frames received for ${hw.secondsSinceReading ?? '∞'} seconds ` +
        `(stale after ${STALE_AFTER_MS / 1000}s).`
      : 'No Stride Guide unit is paired with this kiosk.';

  return {
    deviceName: identity.displayName,
    locationName: identity.locationName,
    kioskDeviceId: identity.kioskDeviceId,
    rows,
    summary,
  };
}
