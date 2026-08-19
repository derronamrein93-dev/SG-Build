/**
 * Identity merge. Against the real database throughout: the guarantees are
 * transactional, RLS-shaped, and constraint-shaped, and none of those survive a
 * mock.  Requires: bash db/reset.sh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'crypto';
import { withTenant, withService, closePool } from './client';
import { mergeCustomer, revertMerge, requestMerge, rejectMerge } from './merge';
import { phoneLookupHash, normalizePhone } from './identity';
import { customerConsent } from '../consent';
import { DEMO } from '../session';

const ctx = { organizationId: DEMO.organizationId, locationId: DEMO.locationId };

/**
 * A fresh number per customer, per run. A sequence would collide with rows left
 * by the previous run — phone is UNIQUE per organization, and these tests do not
 * clean up after themselves by design, so that a failure leaves the state that
 * produced it.
 */
function uniquePhone(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000_000;
  return `2${n.toString().padStart(9, '0')}`;
}

async function makeCustomer(org = DEMO.organizationId, loc = DEMO.locationId) {
  const phone = uniquePhone();
  const e164 = normalizePhone(phone)!;
  const id = await withService(async (c) => {
    const { rows } = await c.query(
      `insert into organization_customer
         (organization_id, created_at_location_id, first_name, last_name,
          phone_lookup_hash, phone_encrypted, phone_last4, phone_key_version, identification_method)
       values ($1,$2,'Dupe','Subject',$3,$4,$5,1,'phone') returning id`,
      [org, loc, phoneLookupHash(org, e164), Buffer.from(e164), e164.slice(-4)]);
    return rows[0].id as string;
  });
  return { id, phone };
}

async function makeSession(customerId: string, org = DEMO.organizationId, loc = DEMO.locationId) {
  return withService(async (c) => (await c.query(
    `insert into fitting_session (organization_id, location_id, organization_customer_id, user_id, status, completed_at)
     values ($1,$2,$3,$4,'completed', now()) returning id`,
    [org, loc, customerId, DEMO.userId])).rows[0].id as string);
}

async function capture(customerId: string, type: string, granted: boolean, at?: string) {
  await withService((c) => c.query(
    `insert into consent_record (scope, organization_customer_id, location_id, type, granted,
                                 consent_text_version, privacy_policy_version, method, captured_at)
     values ('organization',$1,$2,$3,$4,'v1','v1','tablet_checkbox', coalesce($5::timestamptz, now()))`,
    [customerId, DEMO.locationId, type, granted, at ?? null]));
}

const req = (loser: string, winner: string) => ({
  organizationId: DEMO.organizationId, losingCustomerId: loser, survivingCustomerId: winner,
  actorUserId: DEMO.userId, correlationId: randomUUID(),
});

test('MG01 every reference moves to the survivor and the tombstone survives', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  const session = await makeSession(a.id);
  await capture(a.id, 'fit_history_storage', true);

  const manifest = await mergeCustomer(req(a.id, b.id));
  assert.deepEqual(manifest.fitting_session, [session]);

  const moved = await withService(async (c) => (await c.query(
    'select organization_customer_id from fitting_session where id = $1', [session])).rows[0]);
  assert.equal(moved.organization_customer_id, b.id);

  const tomb = await withService(async (c) => (await c.query(
    `select merged_into_customer_id, phone_lookup_hash, local_customer_number
       from organization_customer where id = $1`, [a.id])).rows[0]);
  assert.ok(tomb, 'the merged-away record must not be deleted');
  assert.equal(tomb.merged_into_customer_id, b.id);
  assert.ok(tomb.phone_lookup_hash, 'it keeps its own phone hash — that is what redirects');
  assert.ok(tomb.local_customer_number, 'and its customer number, which a retailer may have written down');
});

test('MG02 searching the merged-away number reaches the survivor', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await mergeCustomer(req(a.id, b.id));

  const { findCustomerByPhone } = await import('../customers');
  const found = await findCustomerByPhone(a.phone);
  assert.ok(found, 'the old number must still find someone');
  assert.equal(found.id, b.id, 'and that someone is the survivor');
  assert.equal(found.reached_via_merge, true);
});

test('MG03 the survivor’s own number still resolves to the survivor', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await mergeCustomer(req(a.id, b.id));
  const { findCustomerByPhone } = await import('../customers');
  const found = await findCustomerByPhone(b.phone);
  assert.equal(found?.id, b.id);
  assert.equal(found?.reached_via_merge, false);
});

test('MG04 combined visit history follows the survivor', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await makeSession(a.id); await makeSession(a.id); await makeSession(b.id);
  await mergeCustomer(req(a.id, b.id));

  const { findCustomerByPhone } = await import('../customers');
  const found = await findCustomerByPhone(a.phone);
  assert.equal(found?.visits, 3, 'three completed fittings, not two and one');
});

test('MG05 a fitting cannot attach to a tombstone — enforced by the database', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await mergeCustomer(req(a.id, b.id));
  // Straight at the table, bypassing every application guard.
  await assert.rejects(() => makeSession(a.id), /merged into another record/);
});

test('MG06 startSession raises on a tombstone rather than retargeting', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await mergeCustomer(req(a.id, b.id));
  const { startSession } = await import('../customers');
  await assert.rejects(() => startSession(a.id), /merged into another one/);
});

test('MG07 cross-tenant merge is denied, indistinguishably from a missing record', async () => {
  const other = await withService(async (c) => {
    const org = (await c.query(`insert into organization (name) values ('Merge Outsider') returning id`)).rows[0].id;
    const loc = (await c.query(
      `insert into location (organization_id,name,phone,email)
       values ($1,'Door','555-0177','m@x.test') returning id`, [org])).rows[0].id;
    return { org, loc };
  });
  const mine = await makeCustomer();
  const theirs = await makeCustomer(other.org, other.loc);

  let foreign = '', missing = '';
  await mergeCustomer(req(theirs.id, mine.id)).catch((e) => { foreign = e.message; });
  await mergeCustomer(req(randomUUID(), mine.id)).catch((e) => { missing = e.message; });

  assert.match(foreign, /not found or not eligible/);
  assert.equal(foreign, missing,
    'a foreign id and a nonexistent id must be indistinguishable, or this is an existence oracle');
});

test('MG08 self-merge and chained merges are refused', async () => {
  const a = await makeCustomer(); const b = await makeCustomer(); const c2 = await makeCustomer();
  await assert.rejects(() => mergeCustomer(req(a.id, a.id)), /into itself/);
  await mergeCustomer(req(a.id, b.id));
  await assert.rejects(() => mergeCustomer(req(a.id, c2.id)), /already been merged/);
  await assert.rejects(() => mergeCustomer(req(c2.id, a.id)), /already been merged/);
});

test('MG09 the consent chokepoint still fails closed after a merge', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await mergeCustomer(req(a.id, b.id));
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, b.id, 'receive_report')), false);
});

test('MG10 consent moves with the history and resolves on the survivor', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await capture(a.id, 'receive_report', true);
  await mergeCustomer(req(a.id, b.id));
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, b.id, 'receive_report')), true);
});

test('MG11 a marketing consent flip requires a second explicit confirmation', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  // Survivor withdrew in March; the duplicate granted in June.
  await capture(b.id, 'marketing_email', true,  '2026-01-01T00:00:00Z');
  await capture(b.id, 'marketing_email', false, '2026-03-01T00:00:00Z');
  await capture(a.id, 'marketing_email', true,  '2026-06-01T00:00:00Z');

  assert.equal(await withTenant(ctx, (c) => customerConsent(c, b.id, 'marketing_email')), false);

  await assert.rejects(() => mergeCustomer(req(a.id, b.id)),
    /marketing consent effective.*marketing_email/s);

  await mergeCustomer(req(a.id, b.id), { confirmMarketingFlip: true });
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, b.id, 'marketing_email')), true,
    'the later grant is the person’s most recent word, once an operator has confirmed it');
});

test('MG12 a non-marketing consent flip does not require confirmation', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await capture(a.id, 'receive_report', true);
  await mergeCustomer(req(a.id, b.id));   // must not throw
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, b.id, 'receive_report')), true);
});

test('MG13 person-scoped consent is untouched by a merge', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  const person = await withService(async (c) => (await c.query(
    `insert into person_identity (identity_lookup_hash) values ($1) returning id`,
    [randomBytes(32)])).rows[0].id as string);
  const row = await withService(async (c) => (await c.query(
    `insert into consent_record (scope, person_identity_id, location_id, type, granted,
                                 consent_text_version, privacy_policy_version, method)
     values ('person',$1,$2,'identity_resolution',true,'v1','v1','mystrideid_account') returning id`,
    [person, DEMO.locationId])).rows[0].id as string);

  await mergeCustomer(req(a.id, b.id));
  const after = await withService(async (c) => (await c.query(
    `select organization_customer_id, person_identity_id from consent_record where id = $1`, [row])).rows[0]);
  assert.equal(after.organization_customer_id, null);
  assert.equal(after.person_identity_id, person);
});

test('MG14 audit events share a correlation id and order by seq', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  const r = req(a.id, b.id);
  await requestMerge(r, { fitting_session: 0 });
  await mergeCustomer(r);

  const rows = await withService(async (c) => (await c.query(
    `select action, subject_id, target_id, seq, metadata from audit_log
      where correlation_id = $1 order by seq`, [r.correlationId])).rows);

  assert.deepEqual(rows.map((x) => x.action),
    ['customer_identity.merge_requested', 'customer_identity.merge_completed']);
  assert.ok(BigInt(rows[0].seq) < BigInt(rows[1].seq));
  assert.equal(rows[1].subject_id, b.id, 'subject is the survivor');
  assert.equal(rows[1].target_id, a.id, 'target is the record merged away');
  assert.ok(rows[1].metadata.moved, 'the manifest is what makes the merge reversible');
  assert.ok(rows[1].metadata.consent_delta);
});

test('MG15 a rejected proposal is audited and moves nothing', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  const session = await makeSession(a.id);
  const r = req(a.id, b.id);
  await requestMerge(r); await rejectMerge(r, 'different_people');

  const still = await withService(async (c) => (await c.query(
    'select organization_customer_id from fitting_session where id = $1', [session])).rows[0]);
  assert.equal(still.organization_customer_id, a.id, 'a rejection must not move anything');
  const actions = await withService(async (c) => (await c.query(
    `select action from audit_log where correlation_id = $1 order by seq`, [r.correlationId])).rows);
  assert.deepEqual(actions.map((x) => x.action),
    ['customer_identity.merge_requested', 'customer_identity.merge_rejected']);
});

test('MG16 reversal restores the manifest and clears the redirect', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  const session = await makeSession(a.id);
  await mergeCustomer(req(a.id, b.id));

  await revertMerge({ losingCustomerId: a.id, actorUserId: DEMO.userId, correlationId: randomUUID() });

  const back = await withService(async (c) => (await c.query(
    'select organization_customer_id from fitting_session where id = $1', [session])).rows[0]);
  assert.equal(back.organization_customer_id, a.id);

  const tomb = await withService(async (c) => (await c.query(
    'select merged_into_customer_id, merged_at from organization_customer where id = $1', [a.id])).rows[0]);
  assert.equal(tomb.merged_into_customer_id, null);
  assert.equal(tomb.merged_at, null);

  const { findCustomerByPhone } = await import('../customers');
  assert.equal((await findCustomerByPhone(a.phone))?.id, a.id, 'the old number points at itself again');
});

test('MG17 rows created after the merge stay with the survivor on reversal', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  const before = await makeSession(a.id);
  await mergeCustomer(req(a.id, b.id));
  const after = await makeSession(b.id);   // done under the merged identity

  await revertMerge({ losingCustomerId: a.id, actorUserId: DEMO.userId, correlationId: randomUUID() });

  const rows = await withService(async (c) => (await c.query(
    'select id, organization_customer_id from fitting_session where id = any($1)', [[before, after]])).rows);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.organization_customer_id]));
  assert.equal(byId[before], a.id, 'what moved, moves back');
  assert.equal(byId[after], b.id,
    'what was created while only one record was live cannot be attributed to either original');
});

test('MG18 reversal of a chain is refused rather than guessed', async () => {
  const a = await makeCustomer(); const b = await makeCustomer(); const c2 = await makeCustomer();
  await mergeCustomer(req(a.id, b.id));
  await mergeCustomer(req(b.id, c2.id));   // the survivor is itself merged away
  await assert.rejects(
    () => revertMerge({ losingCustomerId: a.id, actorUserId: DEMO.userId, correlationId: randomUUID() }),
    /unwinding a chain is ambiguous/);
});

test('MG19 a phone-less record still tombstones rather than disappearing', async () => {
  const b = await makeCustomer();
  const a = await withService(async (c) => (await c.query(
    `insert into organization_customer (organization_id, created_at_location_id, first_name, last_name, identification_method)
     values ($1,$2,'Walk','In','anonymous') returning id`, [DEMO.organizationId, DEMO.locationId])).rows[0].id as string);
  const session = await makeSession(a);

  await mergeCustomer(req(a, b.id));
  const tomb = await withService(async (c) => (await c.query(
    'select merged_into_customer_id from organization_customer where id = $1', [a])).rows[0]);
  assert.equal(tomb.merged_into_customer_id, b.id, 'no phone to redirect, but the audit trail still needs the row');
  const moved = await withService(async (c) => (await c.query(
    'select organization_customer_id from fitting_session where id = $1', [session])).rows[0]);
  assert.equal(moved.organization_customer_id, b.id);
});

test('MG20 the app role cannot merge', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  await assert.rejects(
    () => withTenant(ctx, (c) => c.query(
      'select app_merge_customer($1,$2,$3,$4,false)', [a.id, b.id, DEMO.userId, randomUUID()])),
    /permission denied/i);
});

test('MG21 report access is unchanged by a merge', async () => {
  const a = await makeCustomer(); const b = await makeCustomer();
  const session = await makeSession(a.id);
  const token = randomBytes(24).toString('base64url');
  await withService((c) => c.query(
    `insert into report (fitting_session_id, organization_customer_id, access_token_hash, expires_at, content_snapshot)
     values ($1,$2,$3, now() + interval '90 days', '{}')`,
    [session, a.id, require('crypto').createHash('sha256').update(token).digest()]));

  await mergeCustomer(req(a.id, b.id));

  const { loadReportByToken } = await import('../reports');
  const report = await loadReportByToken(token);
  assert.ok(report, 'the customer’s link must keep working across a merge they never saw');
  assert.equal(report.fitting_session_id, session);
});

test.after(async () => { await closePool(); });
