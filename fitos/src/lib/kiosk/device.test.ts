/**
 * Kiosk identity, scoping and the customer session, against Postgres.
 *
 * The claim this suite exists to defend is narrow and load-bearing: **a kiosk
 * credential grants access to one location's fittings and nothing else.** A
 * kiosk is the least trusted thing in FitOS — unattended, in reach of the
 * public, on a shop floor — so the interesting tests here are the ones that try
 * to make one reach past its own door.
 *
 * Everything runs against real policies. `withService` appears only where a
 * fixture must simulate something the application cannot do (an expired code,
 * an associate's own fitting), and each use says why.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { withTenant, withService, closePool } from '../db/client';
import { DEMO } from '../session';
import { hasConsent } from '../consent';
import { validateAuditEntry } from '../db/audit';
import {
  createEnrollmentCode, redeemEnrollmentCode, resolveKioskDevice, revokeKioskDevice,
  contextFor, generateEnrollmentCode, normalizeEnrollmentCode, EnrollmentError,
  type KioskIdentity,
} from './device';
import {
  beginSession, assertOwnedSession, completeSession, deliverResults, abandonSession,
  recordCapture, saveKioskIntake, KIOSK_AUDIT,
} from './session';
import { hashPin, verifyPin, authenticateAssociate, buildDiagnostics, clearPinAttempts } from './service';
import { KioskError } from './errors';

const LOCATION_A = DEMO.locationId;
const LOCATION_B = 'aaaaaaaa-1111-0000-0000-000000000002';
const adminCtx = { organizationId: DEMO.organizationId, locationId: LOCATION_A, userId: DEMO.userId };
const adminCtxB = { organizationId: DEMO.organizationId, locationId: LOCATION_B, userId: DEMO.userId };

const uniquePhone = () => '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

async function enrollKiosk(ctx = adminCtx, name = 'Test Kiosk'): Promise<KioskIdentity> {
  const { code } = await createEnrollmentCode(ctx, { displayName: name });
  const { identity } = await redeemEnrollmentCode(code, '0.0.0-test');
  return identity;
}

/** A fitting begun with consent, ready for the steps after it. */
async function startedFitting(kiosk: KioskIdentity) {
  return beginSession(kiosk, {
    mode: 'identified', phone: uniquePhone(), firstName: 'Kiosk', lastName: 'Customer',
    consentFitHistory: true,
  });
}

// ── enrollment ──────────────────────────────────────────────────────────────

test('KD01 an enrollment code redeems exactly once', async () => {
  const { code } = await createEnrollmentCode(adminCtx, { displayName: 'Front Door' });
  const { credential, identity } = await redeemEnrollmentCode(code, '0.0.0-test');
  assert.ok(credential.length >= 32);
  assert.equal(identity.locationId, LOCATION_A);
  assert.equal(identity.status, 'enrolled');

  await assert.rejects(() => redeemEnrollmentCode(code, '0.0.0-test'),
    (err: EnrollmentError) => err.reason === 'already_used');
});

test('KD02 an expired code is refused', async () => {
  const { code } = await createEnrollmentCode(adminCtx, { displayName: 'Stale' });
  // Only the service role can age a row backwards; the application has no
  // update grant on kiosk_enrollment_code at all, which is the point.
  await withService((c) => c.query(
    `update kiosk_enrollment_code set expires_at = now() - interval '1 minute'
      where consumed_at is null and display_name = 'Stale'`));
  await assert.rejects(() => redeemEnrollmentCode(code, null),
    (err: EnrollmentError) => err.reason === 'expired');
});

test('KD03 an unknown code is refused, and says nothing about why', async () => {
  await assert.rejects(() => redeemEnrollmentCode('NORTHSIDE-ZZZZ-ZZZZ', null),
    (err: EnrollmentError) => err.reason === 'unknown_code');
  await assert.rejects(() => redeemEnrollmentCode('', null),
    (err: EnrollmentError) => err.reason === 'unknown_code');
});

test('KD04 generated codes are readable and unambiguous', () => {
  const code = generateEnrollmentCode('Northside — Grand Ave');
  assert.match(code, /^NORTHSIDE-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  // No 0/O, 1/I/L, 5/S or 8/B: this is read aloud across a shop floor.
  assert.equal(/[01IL5S8B]/.test(code.split('-').slice(1).join('')), false);
  assert.equal(normalizeEnrollmentCode(' northside-a7kf-9m2q '), 'NORTHSIDE-A7KF-9M2Q');
});

test('KD05 the kiosk acts as its own user, which cannot be signed in as', async () => {
  const kiosk = await enrollKiosk();
  const user = await withTenant(contextFor(kiosk), async (c) =>
    (await c.query('select * from app_user where id = $1', [kiosk.actingUserId])).rows[0]);
  assert.equal(user.role, 'kiosk_device');
  assert.equal(user.pin_hash, null, 'a kiosk user must have no PIN');
  assert.notEqual(user.id, DEMO.userId, 'a kiosk must never act as a seeded associate');
});

// ── credential resolution ───────────────────────────────────────────────────

test('KD06 a credential resolves to one location, and nothing else does', async () => {
  const { code } = await createEnrollmentCode(adminCtxB, { displayName: 'Lakeview Kiosk' });
  const { credential } = await redeemEnrollmentCode(code, null);
  const identity = await resolveKioskDevice(credential);
  assert.ok(identity);
  assert.equal(identity!.locationId, LOCATION_B);

  assert.equal(await resolveKioskDevice(undefined), null);
  assert.equal(await resolveKioskDevice(''), null);
  assert.equal(await resolveKioskDevice('short'), null);
  assert.equal(await resolveKioskDevice('x'.repeat(43)), null);
});

test('KD07 revocation removes the credential, not just the status', async () => {
  const { code } = await createEnrollmentCode(adminCtx, { displayName: 'Doomed' });
  const { credential, identity } = await redeemEnrollmentCode(code, null);
  assert.ok(await resolveKioskDevice(credential));

  await revokeKioskDevice(identity.kioskDeviceId);
  assert.equal(await resolveKioskDevice(credential), null, 'a revoked credential must not resolve');

  const row = await withService(async (c) =>
    (await c.query('select status, credential_hash from kiosk_device where id = $1',
      [identity.kioskDeviceId])).rows[0]);
  assert.equal(row.status, 'revoked');
  assert.equal(row.credential_hash, null, 'the stored hash must be gone, not merely ignored');
});

test('KD08 a kiosk never gets org-wide scope', async () => {
  const kiosk = await enrollKiosk();
  const ctx = contextFor(kiosk);
  assert.equal(ctx.bypassLocationScope, false);
  assert.equal(ctx.locationId, kiosk.locationId);
  assert.equal(ctx.userId, kiosk.actingUserId);
});

// ── session scoping: the tests that matter most ─────────────────────────────

test('KD09 a kiosk cannot touch a session at another location', async () => {
  const kioskA = await enrollKiosk(adminCtx, 'A');
  const kioskB = await enrollKiosk(adminCtxB, 'B');
  const fitting = await startedFitting(kioskB);

  // The RLS policy on fitting_session is org-scoped, not location-scoped, so
  // this session IS visible to kiosk A under the policy alone. The ownership
  // check is what closes it.
  await withTenant(contextFor(kioskA), async (c) => {
    const { rows } = await c.query('select id from fitting_session where id = $1', [fitting.sessionId]);
    assert.equal(rows.length, 1, 'precondition: the policy alone does not hide it');
    await assert.rejects(() => assertOwnedSession(c, kioskA, fitting.sessionId),
      (err: KioskError) => err.code === 'invalid_state');
  });
});

test('KD10 a kiosk cannot touch an associate fitting at its own location', async () => {
  const kiosk = await enrollKiosk();
  const associateSession = await withTenant(adminCtx, async (c) =>
    (await c.query(
      `insert into fitting_session (organization_id, location_id, user_id, status)
       values ($1,$2,$3,'draft') returning id`,
      [DEMO.organizationId, LOCATION_A, DEMO.userId])).rows[0].id);

  await withTenant(contextFor(kiosk), async (c) => {
    await assert.rejects(() => assertOwnedSession(c, kiosk, associateSession),
      (err: KioskError) => err.code === 'invalid_state');
  });
});

test('KD11 a malformed or invented session id is refused without a lookup', async () => {
  const kiosk = await enrollKiosk();
  await withTenant(contextFor(kiosk), async (c) => {
    for (const id of ['', 'not-a-uuid', "' or '1'='1", randomUUID()]) {
      await assert.rejects(() => assertOwnedSession(c, kiosk, id),
        (err: KioskError) => err.code === 'invalid_state', `accepted ${id}`);
    }
  });
});

test('KD12 kiosk writes are attributed to the kiosk, never to an associate', async () => {
  const kiosk = await enrollKiosk();
  const fitting = await startedFitting(kiosk);
  const row = await withTenant(contextFor(kiosk), async (c) =>
    (await c.query('select user_id, location_id from fitting_session where id = $1',
      [fitting.sessionId])).rows[0]);
  assert.equal(row.user_id, kiosk.actingUserId);
  assert.equal(row.location_id, kiosk.locationId);
});

// ── consent ─────────────────────────────────────────────────────────────────

test('KD13 an identified fitting cannot begin without consent', async () => {
  const kiosk = await enrollKiosk();
  await assert.rejects(() => beginSession(kiosk, {
    mode: 'identified', phone: uniquePhone(), firstName: 'No', lastName: 'Consent',
    consentFitHistory: false,
  }), (err: KioskError) => err.code === 'consent_required');
});

test('KD14 consent is captured, and holds, for a new customer', async () => {
  const kiosk = await enrollKiosk();
  const fitting = await startedFitting(kiosk);
  await withTenant(contextFor(kiosk), async (c) => {
    const { rows } = await c.query(
      'select organization_customer_id from fitting_session where id = $1', [fitting.sessionId]);
    const customerId = rows[0].organization_customer_id;
    assert.ok(customerId);
    assert.equal(await hasConsent(c, { kind: 'customer', customerId }, 'fit_history_storage'), true);
    assert.equal(await hasConsent(c, { kind: 'customer', customerId }, 'privacy_ack'), true);
    // Not asked for, so not held. Consent is never inferred from adjacency.
    assert.equal(await hasConsent(c, { kind: 'customer', customerId }, 'receive_report'), false);
    assert.equal(await hasConsent(c, { kind: 'customer', customerId }, 'marketing_sms'), false);
  });
});

test('KD15 a returning customer re-consents on the kiosk, on this visit', async () => {
  const kiosk = await enrollKiosk();
  const phone = uniquePhone();
  const first = await beginSession(kiosk, {
    mode: 'identified', phone, firstName: 'Return', lastName: 'Visitor', consentFitHistory: true });
  const second = await beginSession(kiosk, {
    mode: 'identified', phone, firstName: 'Return', lastName: 'Visitor', consentFitHistory: true });

  assert.equal(second.returning, true);
  assert.notEqual(second.sessionId, first.sessionId);
  const count = await withTenant(contextFor(kiosk), async (c) => {
    const { rows } = await c.query(
      `select count(*)::int n from consent_record cr
         join fitting_session s on s.organization_customer_id = cr.organization_customer_id
        where s.id = $1 and cr.type = 'fit_history_storage'`, [second.sessionId]);
    return rows[0].n;
  });
  assert.ok(count >= 2, `expected a fresh consent row on the return visit, saw ${count}`);
});

test('KD16 a guest fitting creates no customer record at all', async () => {
  const kiosk = await enrollKiosk();
  const fitting = await beginSession(kiosk, { mode: 'guest', consentFitHistory: true });
  const row = await withTenant(contextFor(kiosk), async (c) =>
    (await c.query('select organization_customer_id from fitting_session where id = $1',
      [fitting.sessionId])).rows[0]);
  assert.equal(row.organization_customer_id, null);
});

// ── the fitting body ────────────────────────────────────────────────────────

test('KD17 a capture is refused when no hardware has reported', async () => {
  const kiosk = await enrollKiosk();
  const fitting = await startedFitting(kiosk);
  // No Stride Guide unit is bound, so there is no frame and no capture. The
  // failure is the correct behaviour: nothing in FitOS manufactures a scan.
  await assert.rejects(() => recordCapture(kiosk, fitting.sessionId),
    (err: KioskError) => err.code === 'hardware_offline');
});

test('KD18 a completed fitting yields customer-safe results', async () => {
  const kiosk = await enrollKiosk();
  const fitting = await startedFitting(kiosk);
  await saveKioskIntake(kiosk, fitting.sessionId, {
    intake_discomfort: true, intake_shoe_issue: false, intake_high_activity: true });
  const out = await completeSession(kiosk, fitting.sessionId);

  assert.ok(out.results.headline, 'a primary fit result');
  assert.ok(out.results.why.length > 0, 'the composed explanation, not the rule strings');
  assert.ok(out.results.profile.length >= 4);
  assert.match(out.results.disclaimer, /not a medical assessment/i);

  const serialized = JSON.stringify(out.results);
  assert.equal(/productModelId/.test(serialized), false, 'internal catalog ids must not be sent');
  assert.equal(/ruleRationale|firedRuleIds|R\d{2}_/.test(serialized), false,
    'raw rule output must not reach the customer');
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(serialized), false,
    'no uuid of any kind may reach the customer');
  // The report token is minted at completion and must not be handed back.
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'token'), false);
});

test('KD19 delivery is refused without receive_report consent, allowed with it', async () => {
  const kiosk = await enrollKiosk();
  const withoutConsent = await startedFitting(kiosk);
  await completeSession(kiosk, withoutConsent.sessionId);
  await assert.rejects(() => deliverResults(kiosk, withoutConsent.sessionId),
    (err: KioskError) => err.code === 'consent_required');

  const consented = await beginSession(kiosk, {
    mode: 'identified', phone: uniquePhone(), firstName: 'Send', lastName: 'Me',
    consentFitHistory: true, consentReceiveReport: true });
  await completeSession(kiosk, consented.sessionId);
  const out = await deliverResults(kiosk, consented.sessionId);
  assert.match(out.maskedPhone ?? '', /^••• ••• \d{4}$/, 'only the last four, and only masked');
});

test('KD20 a guest fitting cannot request delivery', async () => {
  const kiosk = await enrollKiosk();
  const fitting = await beginSession(kiosk, { mode: 'guest', consentFitHistory: true });
  await completeSession(kiosk, fitting.sessionId);
  await assert.rejects(() => deliverResults(kiosk, fitting.sessionId),
    (err: KioskError) => err.code === 'invalid_state');
});

test('KD21 an abandoned fitting is voided; a completed one is left alone', async () => {
  const kiosk = await enrollKiosk();
  const abandoned = await startedFitting(kiosk);
  await abandonSession(kiosk, abandoned.sessionId);
  const voided = await withTenant(contextFor(kiosk), async (c) =>
    (await c.query('select status, void_reason from fitting_session where id = $1',
      [abandoned.sessionId])).rows[0]);
  assert.equal(voided.status, 'voided');
  assert.equal(voided.void_reason, 'customer_withdrew');

  const finished = await startedFitting(kiosk);
  await completeSession(kiosk, finished.sessionId);
  await abandonSession(kiosk, finished.sessionId);
  const still = await withTenant(contextFor(kiosk), async (c) =>
    (await c.query('select status from fitting_session where id = $1', [finished.sessionId])).rows[0]);
  assert.equal(still.status, 'completed', 'the customer finished; the screen timing out is not a withdrawal');
});

test('KD22 a kiosk cannot abandon another kiosk\'s fitting', async () => {
  const kioskA = await enrollKiosk(adminCtx, 'A');
  const kioskB = await enrollKiosk(adminCtxB, 'B');
  const fitting = await startedFitting(kioskB);
  await assert.rejects(() => abandonSession(kioskA, fitting.sessionId),
    (err: KioskError) => err.code === 'invalid_state');
});

// ── audit ───────────────────────────────────────────────────────────────────

test('KD23 kiosk audit rows carry identifiers, never people', async () => {
  const kiosk = await enrollKiosk();
  const phone = uniquePhone();
  const fitting = await beginSession(kiosk, {
    mode: 'identified', phone, firstName: 'Audited', lastName: 'Person', consentFitHistory: true });
  const rows = await withTenant(contextFor(kiosk), async (c) =>
    (await c.query(
      `select action, metadata, actor_type, subject_id from audit_log
        where action = $1 and subject_id = $2`,
      [KIOSK_AUDIT.SESSION_STARTED, fitting.sessionId])).rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_type, 'system');
  const serialized = JSON.stringify(rows[0].metadata);
  // Named values, not a digit-run heuristic: a uuid contains runs of digits by
  // chance, and a test that fails one run in twenty is a test people delete.
  assert.equal(serialized.indexOf(phone), -1, 'the phone number reached the audit trail');
  assert.equal(serialized.indexOf(phone.slice(-4)), -1, 'even the last four must not be there');
  assert.equal(/audited|person/i.test(serialized), false, 'the customer name reached the audit trail');
  // The audit module's own guard must accept everything the kiosk writes.
  assert.deepEqual(validateAuditEntry({
    organizationId: kiosk.organizationId, action: KIOSK_AUDIT.SESSION_STARTED,
    subjectType: 'fitting_session', subjectId: fitting.sessionId, metadata: rows[0].metadata,
  }), []);
});

// ── service mode ────────────────────────────────────────────────────────────

test('KD24 PIN hashing round-trips and rejects everything else', () => {
  const stored = hashPin('4417');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(stored.indexOf('4417'), -1, 'the PIN must not appear in its own hash');
  assert.equal(verifyPin('4417', stored), true);
  assert.equal(verifyPin('4418', stored), false);
  assert.equal(verifyPin('4417', null), false);
  assert.equal(verifyPin('4417', 'sha256$deadbeef'), false);
  assert.equal(verifyPin('4417', hashPin('4417')) && hashPin('4417') !== stored, true,
    'each hash carries its own salt');
});

test('KD25 the seeded associate PIN opens the panel; a wrong one does not', async () => {
  const kiosk = await enrollKiosk();
  clearPinAttempts(kiosk.kioskDeviceId);
  const who = await authenticateAssociate(kiosk, '4417');
  assert.equal(who.firstName, 'Denise');

  await assert.rejects(() => authenticateAssociate(kiosk, '0000'),
    (err: KioskError) => err.code === 'service_auth_failed');
  await assert.rejects(() => authenticateAssociate(kiosk, 'abcd'),
    (err: KioskError) => err.code === 'service_auth_failed');
  clearPinAttempts(kiosk.kioskDeviceId);
});

test('KD26 a PIN from another location does not open this kiosk', async () => {
  // The seeded PIN belongs to an associate at location A. A kiosk enrolled at
  // location B must not accept it, even though both are the same organization.
  const kioskB = await enrollKiosk(adminCtxB, 'Lakeview');
  clearPinAttempts(kioskB.kioskDeviceId);
  await assert.rejects(() => authenticateAssociate(kioskB, '4417'),
    (err: KioskError) => err.code === 'service_auth_failed');
  clearPinAttempts(kioskB.kioskDeviceId);
});

test('KD27 repeated wrong PINs lock the panel', async () => {
  const kiosk = await enrollKiosk();
  clearPinAttempts(kiosk.kioskDeviceId);
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => authenticateAssociate(kiosk, '0000'));
  }
  // The sixth is refused by the lockout rather than by the PIN check, so even
  // the correct PIN does not get in.
  await assert.rejects(() => authenticateAssociate(kiosk, '4417'),
    (err: KioskError) => err.httpStatus === 429);
  clearPinAttempts(kiosk.kioskDeviceId);
});

test('KD28 diagnostics name the fault; the customer copy never does', async () => {
  const kiosk = await enrollKiosk();
  const d = await buildDiagnostics(kiosk);
  assert.equal(d.kioskDeviceId, kiosk.kioskDeviceId);
  assert.match(d.summary, /no stride guide unit is paired/i);
  const labels = d.rows.map((r) => r.label);
  for (const expected of ['FitOS API', 'Stride Guide', 'Pressure matrix', 'Calibration', 'FitOS app']) {
    assert.ok(labels.indexOf(expected) >= 0, `missing diagnostic row: ${expected}`);
  }
  // Nothing about any customer, ever, in a panel an associate opens on the floor.
  assert.equal(/customer|phone|first_name/i.test(JSON.stringify(d)), false);
});

test.after(async () => { await closePool(); });
