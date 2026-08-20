/**
 * Every mutation, executed as `fitos_app`.
 *
 * This suite exists because of a specific failure. `createCustomer` used
 * RETURNING, which re-reads the inserted row through the policy's USING clause
 * — and the location grant that satisfies it is written by an AFTER INSERT
 * trigger that has not fired yet. Creating a customer therefore failed with
 * "new row violates row-level security policy" on the one screen that creates
 * customers.
 *
 * 141 tests passed while that was broken, because every fixture in the suite
 * creates data through `withService`, which carries BYPASSRLS. Not one write
 * had ever run under the policy the tablet actually runs under.
 *
 * So the rule here: **no `withService` in this file.** Fixtures included. If a
 * mutation cannot set up its own preconditions as the application role, that is
 * itself the finding.
 *
 * Cheap on purpose — seconds, no browser. The browser suite (e2e/) covers flows;
 * this covers privilege, and it catches this bug class far faster.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTenant, closePool } from '../db/client';
import { DEMO } from '../session';
import { createCustomer, startSession, findCustomerByPhone } from '../customers';
import { writeIntake } from '../intake/save';
import { writeAssessment, buildRecommendation, finishFitting, writeFeedback } from './mutations';
import { loadCatalog } from '../catalog';

const ctx = { organizationId: DEMO.organizationId, locationId: DEMO.locationId, userId: DEMO.userId };
const uniquePhone = () => '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

test('MU01 createCustomer succeeds as the application role', async () => {
  const created = await createCustomer({
    firstName: 'App', lastName: 'Role', phone: uniquePhone(), consent: true });
  assert.ok(created?.id);
  assert.ok(created.local_customer_number, 'the trigger-assigned number comes back');
});

test('MU02 findCustomerByPhone reads back what createCustomer wrote', async () => {
  const phone = uniquePhone();
  const created = await createCustomer({
    firstName: 'Read', lastName: 'Back', phone, consent: true });
  assert.equal((await findCustomerByPhone(phone))?.id, created.id);
});

test('MU03 startSession succeeds as the application role', async () => {
  const c = await createCustomer({
    firstName: 'Sess', lastName: 'Start', phone: uniquePhone(), consent: true });
  const id = await startSession(c.id);
  assert.ok(id, 'a session id must come back');
});

test('MU04 an anonymous session can be started', async () => {
  assert.ok(await startSession(null), 'a walk-in with no contact details is a supported fitting');
});

test('MU05 writeIntake succeeds as the application role', async () => {
  const id = await startSession(null);
  await writeIntake(ctx, id, {
    intake_discomfort: true, intake_shoe_issue: false, intake_high_activity: true,
    intake_duration_seconds: 18, intake_mode: 'quick' });
  const row = await withTenant(ctx, async (c) =>
    (await c.query('select * from fitting_session where id = $1', [id])).rows[0]);
  assert.equal(row.intake_discomfort, true);
  assert.equal(row.intake_duration_seconds, 18);
  assert.equal(row.status, 'in_progress');
});

test('MU06 writeAssessment succeeds, and upserts on a second call', async () => {
  const id = await startSession(null);
  await writeAssessment(ctx, id, { size_left: 10, size_right: 10.5, width: 'wide' });
  await writeAssessment(ctx, id, { arch_type: 'low' });   // exercises the ON CONFLICT path
  const row = await withTenant(ctx, async (c) =>
    (await c.query('select * from assessment where fitting_session_id = $1', [id])).rows[0]);
  assert.equal(row.width, 'wide');
  assert.equal(row.arch_type, 'low', 'the second write must merge, not replace');
});

test('MU07 buildRecommendation persists features and a recommendation', async () => {
  const id = await startSession(null);
  await writeIntake(ctx, id, { intake_high_activity: true });
  await writeAssessment(ctx, id, { size_left: 10, size_right: 10, arch_type: 'low', width: 'wide' });

  const rec = await buildRecommendation(ctx, id, await loadCatalog(ctx));
  assert.ok(rec.fitProfile.width, 'a fit profile comes back');

  const counts = await withTenant(ctx, async (c) => ({
    features: Number((await c.query(
      'select count(*) n from fitting_feature where fitting_session_id = $1', [id])).rows[0].n),
    recs: Number((await c.query(
      'select count(*) n from recommendation where fitting_session_id = $1', [id])).rows[0].n),
  }));
  assert.ok(counts.features > 0, 'canonical features are written');
  assert.equal(counts.recs, 1);
});

test('MU08 finishFitting completes the session and mints a report', async () => {
  const c0 = await createCustomer({
    firstName: 'Fin', lastName: 'Ish', phone: uniquePhone(), consent: true });
  const id = await startSession(c0.id);
  await writeIntake(ctx, id, { intake_discomfort: false, intake_shoe_issue: false, intake_high_activity: false });
  await writeAssessment(ctx, id, { size_left: 9, size_right: 9 });

  const { token } = await finishFitting(ctx, id, await loadCatalog(ctx));
  assert.ok(token.length >= 16, 'a usable token comes back');

  const session = await withTenant(ctx, async (cl) =>
    (await cl.query('select status, completed_at, time_to_recommendation_ms from fitting_session where id = $1',
      [id])).rows[0]);
  assert.equal(session.status, 'completed');
  assert.ok(session.completed_at);
  assert.ok(session.time_to_recommendation_ms !== null);

  const { loadReportByToken } = await import('../reports');
  const report = await loadReportByToken(token);
  assert.ok(report, 'the token minted by the app role resolves');
  assert.ok(report.content_snapshot.toldUs, 'and carries the What you told us block');
});

test('MU09 an override is recorded on completion', async () => {
  const id = await startSession(null);
  await writeAssessment(ctx, id, { size_left: 9, size_right: 9 });
  await finishFitting(ctx, id, await loadCatalog(ctx), { width: 'standard' });
  const rec = await withTenant(ctx, async (c) => (await c.query(
    `select overridden, override_reason from recommendation
      where fitting_session_id = $1 order by created_at desc limit 1`, [id])).rows[0]);
  assert.equal(rec.overridden, true);
  assert.equal(rec.override_reason, 'associate_judgment');
});

test('MU10 writeFeedback succeeds as the application role', async () => {
  await writeFeedback(ctx, 'bug', 'intake', 'the third question needs an example');
  const n = await withTenant(ctx, async (c) => Number((await c.query(
    "select count(*) n from pilot_feedback where screen = 'intake'")).rows[0].n));
  assert.ok(n > 0);
});

test('MU11 no fixture in this file uses the service role', async () => {
  // The guard on the guard. The bug this suite exists for hid precisely because
  // fixtures reached for withService; if that creeps back in here, the suite
  // stops testing the thing it was written to test.
  const { readFileSync } = await import('fs');
  const source = readFileSync(new URL(import.meta.url).pathname, 'utf8');
  // Assembled at runtime so this line is not itself a match — the first
  // version of this test failed on its own detector.
  const needle = 'with' + 'Service(';
  const uses = source.split('\n')
    .filter((l) => l.includes(needle) && !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  assert.deepEqual(uses, [], 'this suite must run entirely as fitos_app');
});

test('MU12 concurrent customer creation does not collide on the retailer number', async () => {
  // The numbering trigger used to do max()+1 with no lock, so two associates
  // creating a walk-in at the same moment raced and the second one failed on
  // organization_customer_number_key. Migration 0010 takes a per-organization
  // advisory lock. Eight at once is well past what a store does and still fast.
  const created = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    createCustomer({ firstName: 'Race', lastName: `N${i}`, phone: uniquePhone(), consent: true })));

  assert.equal(created.length, 8, 'every concurrent creation must succeed');
  const numbers = created.map((c) => Number(c.local_customer_number));
  assert.equal(new Set(numbers).size, 8, `numbers must be distinct, saw ${numbers.join(',')}`);
});

test.after(async () => { await closePool(); });
