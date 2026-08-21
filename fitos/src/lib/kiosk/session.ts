/**
 * The kiosk's server-side fitting lifecycle.
 *
 * Thin by design. Every step here delegates to something that already existed —
 * `findCustomerByPhone`, `createCustomer`, `startSession`, `writeIntake`,
 * `writeAssessment`, `finishFitting` — and adds exactly two things the associate
 * app does not need:
 *
 *   1. **A scope check the schema does not give for free.** `fitting_session`'s
 *      RLS policy is org-scoped, not location-scoped, so a kiosk holding a
 *      session uuid from another door would satisfy it. `assertOwnedSession`
 *      closes that: a kiosk may only touch sessions at its own location that
 *      were opened by its own acting user. Every entry point calls it first.
 *
 *   2. **Consent as a gate, not a checkbox.** Nothing customer-linked is
 *      written before `beginSession` is called with an explicit grant. The
 *      IDENTIFICATION step performs no writes at all, so a customer who walks
 *      away at the consent screen leaves nothing behind.
 *
 * -- On what the iPad does NOT do ---------------------------------------------
 *
 * Nothing in this file has a browser counterpart. Pressure analysis, scoring,
 * rule evaluation, catalog matching, language composition and report freezing
 * all run here, in Node, against Postgres. The iPad mini 2 posts a few hundred
 * bytes and renders what comes back. That is not a performance optimisation
 * bolted on afterwards — it is the reason a 2013 device can run this at all.
 */
import type { PoolClient } from 'pg';
import { withTenant } from '../db/client';
import { findCustomerByPhone, createCustomer, startSession, captureCustomerConsent } from '../customers';
import { writeIntake } from '../intake/save';
import { writeAssessment, finishFitting } from '../fitting/mutations';
import { loadCatalog } from '../catalog';
import { normalizePhone } from '../db/identity';
import { writeAudit } from '../db/audit';
import { hasConsent } from '../consent';
import { projectResults, type KioskResults } from './view';
import { readHardwareStatus, isCaptureReady, type HardwareStatus } from './hardware';
import { KioskError } from './errors';
import { contextFor, type KioskIdentity } from './device';

/** Audit vocabulary for the kiosk. Namespaced so a query can find all of it. */
export const KIOSK_AUDIT = {
  SESSION_STARTED: 'kiosk.session_started',
  SESSION_ABANDONED: 'kiosk.session_abandoned',
  CAPTURE_RECORDED: 'kiosk.capture_recorded',
  DELIVERY_REQUESTED: 'kiosk.delivery_requested',
  ENROLLED: 'kiosk.device_enrolled',
  SERVICE_OPENED: 'kiosk.service_mode_opened',
} as const;

/**
 * Assessment columns a Stride Guide capture is permitted to write.
 *
 * An allowlist rather than a passthrough, for the same reason INTAKE_COLUMNS is
 * one: the bridge is a device on a store network, and a device on a store
 * network is not allowed to name a column.
 */
export const SCAN_ASSESSMENT_FIELDS = [
  'size_left', 'size_right', 'width', 'width_asymmetry', 'arch_type', 'foot_shape',
  'pronation_tendency', 'heel_slip_risk', 'toe_box_issue', 'balance_concern',
  'pressure_concern',
] as const;

export interface KioskSessionRef { sessionId: string; visitNumber: number; returning: boolean }

/**
 * A kiosk may only act on its own sessions, at its own location.
 *
 * Returns the row so callers do not immediately re-read it. Throws
 * `invalid_state` — never "not found" — because the difference between "that
 * session does not exist" and "that session is not yours" is information a
 * kiosk on a shop floor has no business distinguishing.
 */
export async function assertOwnedSession(
  c: PoolClient, identity: KioskIdentity, sessionId: string,
): Promise<Record<string, any>> {
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new KioskError('invalid_state', 400, 'malformed session id');
  }
  const { rows } = await c.query(
    `select * from fitting_session
      where id = $1 and location_id = $2 and user_id = $3`,
    [sessionId, identity.locationId, identity.actingUserId]);
  if (!rows.length) throw new KioskError('invalid_state', 404, 'session not owned by this kiosk');
  return rows[0];
}

/**
 * Capture a consent decision, through the one module that writes consent rows.
 * `tablet_checkbox` is the honest method value: the kiosk IS a tablet, and the
 * customer tapped it themselves rather than an associate ticking it for them.
 */
function captureConsent(
  c: PoolClient, identity: KioskIdentity,
  customerId: string, type: string, granted: boolean,
) {
  return captureCustomerConsent(c, {
    customerId, locationId: identity.locationId, type, granted,
    byUserId: identity.actingUserId,
  });
}

export interface BeginInput {
  mode: 'identified' | 'guest';
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** The customer tapped the affirmative button. Never defaulted, never inferred. */
  consentFitHistory: boolean;
  /** Optional and separate: agreeing to be sent a link is not agreeing to storage. */
  consentReceiveReport?: boolean;
}

/**
 * Start a fitting. The first write of the whole flow.
 *
 * Called on CONSENT_GRANTED and at no other point, which is what makes "nothing
 * customer-linked is stored before consent" a property of the code rather than
 * of the screen order.
 *
 * A guest fitting creates no customer record at all — `fitting_session
 * .organization_customer_id` is nullable and the associate app has always
 * supported it. That is the whole guest implementation: no new identity policy,
 * no `anonymous` customer row, nothing invented while open question 9 is open.
 */
export async function beginSession(
  identity: KioskIdentity, input: BeginInput,
): Promise<KioskSessionRef> {
  const ctx = contextFor(identity);

  if (input.mode === 'guest') {
    const sessionId = await startSession(null, ctx);
    await withTenant(ctx, (c) => writeAudit(c, {
      organizationId: identity.organizationId,
      locationId: identity.locationId,
      actorUserId: identity.actingUserId,
      actorType: 'system',
      action: KIOSK_AUDIT.SESSION_STARTED,
      subjectType: 'fitting_session',
      subjectId: sessionId,
      metadata: { mode: 'guest', kiosk_device_id: identity.kioskDeviceId },
    }));
    return { sessionId, visitNumber: 1, returning: false };
  }

  if (!input.consentFitHistory) throw new KioskError('consent_required', 403);

  const e164 = normalizePhone(String(input.phone ?? ''));
  if (!e164) throw new KioskError('invalid_state', 400, 'unparseable phone');
  const firstName = String(input.firstName ?? '').trim().slice(0, 60);
  const lastName = String(input.lastName ?? '').trim().slice(0, 60);
  if (!firstName || !lastName) throw new KioskError('invalid_state', 400, 'name incomplete');

  // The lookup happens here, AFTER consent, and its result is never sent to the
  // browser before this point. On an unattended kiosk, telling whoever types a
  // phone number whether it belongs to a customer is a membership oracle; the
  // identification screen therefore looks identical either way.
  const existing = await findCustomerByPhone(e164, ctx);
  let customerId: string;
  let returning = false;

  if (existing) {
    customerId = existing.id;
    returning = true;
    // A returning customer consents again, on this device, today. Consent that
    // holds from a previous visit is not consent the kiosk may assume, and the
    // append-only model makes re-capture the natural expression of that.
    await withTenant(ctx, async (c) => {
      await captureConsent(c, identity, customerId, 'fit_history_storage', true);
      await captureConsent(c, identity, customerId, 'privacy_ack', true);
      if (input.consentReceiveReport) {
        await captureConsent(c, identity, customerId, 'receive_report', true);
      }
    });
  } else {
    // createCustomer writes fit_history_storage and privacy_ack itself.
    const created = await createCustomer(
      { firstName, lastName, phone: e164, consent: true }, ctx);
    customerId = created.id;
    if (input.consentReceiveReport) {
      await withTenant(ctx, (c) =>
        captureConsent(c, identity, customerId, 'receive_report', true));
    }
  }

  const sessionId = await startSession(customerId, ctx);
  const visitNumber = await withTenant(ctx, async (c) => {
    await writeAudit(c, {
      organizationId: identity.organizationId,
      locationId: identity.locationId,
      actorUserId: identity.actingUserId,
      actorType: 'system',
      action: KIOSK_AUDIT.SESSION_STARTED,
      subjectType: 'fitting_session',
      subjectId: sessionId,
      // No name, no phone, no last four. The audit trail records that a
      // fitting began on this device, which is the fact worth keeping.
      metadata: { mode: 'identified', returning, kiosk_device_id: identity.kioskDeviceId },
    });
    const { rows } = await c.query('select visit_number from fitting_session where id = $1', [sessionId]);
    return Number(rows[0]?.visit_number ?? 1);
  });

  return { sessionId, visitNumber, returning };
}

/** Quick-intake answers. Delegates to the existing allowlisted writer. */
export async function saveKioskIntake(
  identity: KioskIdentity, sessionId: string, patch: Record<string, unknown>,
): Promise<void> {
  const ctx = contextFor(identity);
  await withTenant(ctx, (c) => assertOwnedSession(c, identity, sessionId));
  await writeIntake(ctx, sessionId, patch);
}

/**
 * The capture contract with the Stride Guide bridge.
 *
 * The bridge is what produces a capture: it holds the frame buffer, it decides
 * when a stance has been stable long enough, and it publishes the result on its
 * telemetry frame. The kiosk asks for the most recent one. The iPad never sees
 * a pressure frame and never computes anything from one.
 *
 * If the current frame carries no capture block, this fails as `scan_failed` —
 * which is the honest outcome, and the reason there is no code path in FitOS
 * that manufactures a scan row from a kiosk button press.
 */
export interface TelemetryCapture {
  rawUri: string;
  rawChecksum: string;
  captureType?: 'static_stance' | 'weight_shift' | 'walk';
  sampleRateHz?: number;
  frameCount?: number;
  totalLoadMeasured?: number;
  captureQuality?: number;
  algorithmVersion?: string;
  derived?: Record<string, unknown>;
  assessment?: Record<string, unknown>;
}

export interface CaptureResult { scanId: string; captureQuality: number | null }

export async function recordCapture(
  identity: KioskIdentity, sessionId: string,
): Promise<CaptureResult> {
  const ctx = contextFor(identity);

  // Readiness is re-read from the server's own view of the hardware. The
  // browser just told us it was ready; the browser is a device on a shop floor.
  const status = await readHardwareStatus(ctx, identity.strideGuideDeviceId);
  if (!status.connected) throw new KioskError('hardware_offline', 409);
  if (!status.calibrationValid) throw new KioskError('calibration_required', 409);
  if (!isCaptureReady(status)) throw new KioskError('not_ready', 409);

  const frame = await withTenant(ctx, async (c) => {
    await assertOwnedSession(c, identity, sessionId);
    const { rows } = await c.query(
      `select e.component_status, e.firmware_version, e.calibration_version, d.hardware_revision,
              i.id as installation_id
         from device_health_event e
         join device d on d.id = e.device_id
         left join device_installation i
                on i.device_id = e.device_id and i.location_id = $2 and i.removed_at is null
        where e.device_id = $1
        order by e.reported_at desc limit 1`,
      [identity.strideGuideDeviceId, identity.locationId]);
    return rows[0] ?? null;
  });

  const capture: TelemetryCapture | undefined = frame?.component_status?.capture;
  if (!capture?.rawUri || !capture?.rawChecksum) throw new KioskError('scan_failed', 409, 'no capture on frame');

  const quality = typeof capture.captureQuality === 'number' ? capture.captureQuality : null;

  const scanId = await withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `insert into scan
        (fitting_session_id, device_id, device_installation_id, firmware_version,
         calibration_version, hardware_revision, capture_type, raw_uri, raw_checksum,
         sample_rate_hz, frame_count, total_load_measured, capture_quality)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [sessionId, identity.strideGuideDeviceId, frame.installation_id ?? null,
       frame.firmware_version ?? 'unknown', frame.calibration_version ?? 'unknown',
       frame.hardware_revision ?? 'unknown', capture.captureType ?? 'static_stance',
       capture.rawUri, capture.rawChecksum, capture.sampleRateHz ?? null,
       capture.frameCount ?? null, capture.totalLoadMeasured ?? status.totalWeight ?? null,
       quality]);
    const id = rows[0].id as string;

    if (capture.derived) {
      await c.query(
        `insert into scan_derivation (scan_id, algorithm_version, derived, quality_metrics)
         values ($1,$2,$3,$4)`,
        [id, capture.algorithmVersion ?? 'bridge-unversioned', capture.derived,
         quality === null ? null : { capture_quality: quality }]);
    }

    await writeAudit(c, {
      organizationId: identity.organizationId,
      locationId: identity.locationId,
      actorUserId: identity.actingUserId,
      actorType: 'system',
      action: KIOSK_AUDIT.CAPTURE_RECORDED,
      subjectType: 'scan',
      subjectId: id,
      targetType: 'fitting_session',
      targetId: sessionId,
      metadata: { kiosk_device_id: identity.kioskDeviceId, capture_quality: quality },
    });
    return id;
  });

  // Measurements the bridge derived, into the observation record the engine
  // already reads. Allowlisted; anything else on the frame is ignored.
  if (capture.assessment) {
    const patch: Record<string, unknown> = {};
    for (const key of SCAN_ASSESSMENT_FIELDS) {
      if (capture.assessment[key] !== undefined) patch[key] = capture.assessment[key];
    }
    if (Object.keys(patch).length) await writeAssessment(ctx, sessionId, patch);
  }

  return { scanId, captureQuality: quality };
}

export interface CompleteResult { results: KioskResults; canDeliver: boolean; maskedPhone: string | null }

/**
 * Finish the fitting: recommendation, catalog match, language, frozen report.
 *
 * All of it is `finishFitting()` — the same call the associate app makes, with
 * the same rule set, the same versions and the same frozen snapshot. The kiosk
 * has no scoring of its own and must never acquire one.
 *
 * The report's access token is minted here and is NOT returned. The customer's
 * link is a secret; putting it in a page on a shared device makes it a secret
 * the next customer can press Back to find. `deliverResults` re-reads it from
 * the session when it is actually needed.
 */
export async function completeSession(
  identity: KioskIdentity, sessionId: string,
): Promise<CompleteResult> {
  const ctx = contextFor(identity);
  await withTenant(ctx, (c) => assertOwnedSession(c, identity, sessionId));

  await finishFitting(ctx, sessionId, await loadCatalog(ctx));

  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select r.content_snapshot, s.organization_customer_id, c.phone_last4
         from report r
         join fitting_session s on s.id = r.fitting_session_id
         left join organization_customer c on c.id = s.organization_customer_id
        where r.fitting_session_id = $1
        order by r.report_version desc limit 1`, [sessionId]);
    if (!rows.length) throw new KioskError('unavailable', 500, 'report missing after completion');
    const row = rows[0];
    const canDeliver = Boolean(row.organization_customer_id)
      && await hasConsent(c, { kind: 'customer', customerId: row.organization_customer_id }, 'receive_report');
    return {
      results: projectResults(row.content_snapshot),
      canDeliver,
      maskedPhone: row.phone_last4 ? `••• ••• ${row.phone_last4}` : null,
    };
  });
}

/**
 * Request delivery of the fit report.
 *
 * Reuses the existing secure report architecture untouched: the token minted by
 * `finishFitting` is already hashed, already expires in 90 days and is already
 * revocable. Nothing new is created and no link is put on screen.
 *
 * **There is no send transport in FitOS.** docs/04 §3 specifies an emailed link;
 * nothing implements it, and inventing an SMS gateway is not this change's job.
 * So this records the request against the report and returns the masked
 * destination, and the kiosk tells the customer the truth — their associate has
 * the link. Wiring a real sender is a queue reader over these audit rows.
 */
export async function deliverResults(
  identity: KioskIdentity, sessionId: string,
): Promise<{ maskedPhone: string | null }> {
  const ctx = contextFor(identity);
  return withTenant(ctx, async (c) => {
    const session = await assertOwnedSession(c, identity, sessionId);
    if (!session.organization_customer_id) throw new KioskError('invalid_state', 409, 'guest fitting');

    const allowed = await hasConsent(
      c, { kind: 'customer', customerId: session.organization_customer_id }, 'receive_report');
    if (!allowed) throw new KioskError('consent_required', 403);

    const { rows } = await c.query(
      `select r.id, c.phone_last4
         from report r
         join organization_customer c on c.id = r.organization_customer_id
        where r.fitting_session_id = $1
        order by r.report_version desc limit 1`, [sessionId]);
    if (!rows.length) throw new KioskError('invalid_state', 409, 'no report');

    await writeAudit(c, {
      organizationId: identity.organizationId,
      locationId: identity.locationId,
      actorUserId: identity.actingUserId,
      actorType: 'system',
      action: KIOSK_AUDIT.DELIVERY_REQUESTED,
      subjectType: 'report',
      subjectId: rows[0].id,
      targetType: 'fitting_session',
      targetId: sessionId,
      // `phone_last4` would trip the audit module's PII guard on the key name
      // alone, and rightly so. The channel is the fact worth recording.
      metadata: { channel: 'link', kiosk_device_id: identity.kioskDeviceId },
    });
    return { maskedPhone: rows[0].phone_last4 ? `••• ••• ${rows[0].phone_last4}` : null };
  });
}

/**
 * A fitting that ended without a recommendation.
 *
 * Voided rather than deleted: `session_status` has a `voided` value and
 * `void_reason` has a vocabulary, so an abandoned fitting stays countable
 * without pretending it was completed. A completed session is never touched —
 * the customer finished, whatever happened to the screen afterwards.
 */
export async function abandonSession(
  identity: KioskIdentity, sessionId: string,
  reason: 'customer_withdrew' | 'mistaken_start' = 'customer_withdrew',
): Promise<void> {
  const ctx = contextFor(identity);
  await withTenant(ctx, async (c) => {
    const session = await assertOwnedSession(c, identity, sessionId);
    if (session.status === 'completed' || session.status === 'voided') return;
    await c.query(
      `update fitting_session set status = 'voided', void_reason = $2, updated_at = now()
        where id = $1`, [sessionId, reason]);
    await writeAudit(c, {
      organizationId: identity.organizationId,
      locationId: identity.locationId,
      actorUserId: identity.actingUserId,
      actorType: 'system',
      action: KIOSK_AUDIT.SESSION_ABANDONED,
      subjectType: 'fitting_session',
      subjectId: sessionId,
      metadata: { reason, kiosk_device_id: identity.kioskDeviceId },
    });
  });
}

/** Hardware plus the machine event it implies, in one round trip. */
export async function kioskHardware(identity: KioskIdentity): Promise<HardwareStatus> {
  return readHardwareStatus(contextFor(identity), identity.strideGuideDeviceId);
}
