/**
 * Quick intake, end to end against the database and the engine.
 *
 * Requires: bash db/reset.sh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTenant, withService, closePool } from '../db/client';
import { DEMO } from '../session';
import { buildToldUs } from '../report/toldUs';
import { toObservedFeatures, recommend } from '../rules/engine';
import { sanitize, ANALYTICS_EVENTS, ALLOWED_KEYS } from '../analytics';
import { NEW_CUSTOMER_QUESTIONS, RETURNING_CUSTOMER_QUESTIONS } from './questions';
import { writeIntake } from './save';

const ctx = { organizationId: DEMO.organizationId, locationId: DEMO.locationId };

async function newSession(visit = 1): Promise<string> {
  return withService(async (c) => (await c.query(
    `insert into fitting_session (organization_id, location_id, user_id, status, visit_number)
     values ($1,$2,$3,'draft',$4) returning id`,
    [DEMO.organizationId, DEMO.locationId, DEMO.userId, visit])).rows[0].id as string);
}

async function answerAll(sessionId: string, questions: readonly { field: string }[], value: boolean) {
  for (const q of questions) await writeIntake(ctx, sessionId, { [q.field]: value });
  await writeIntake(ctx, sessionId, { intake_duration_seconds: 22, intake_mode: 'quick' });
}

const load = (id: string) => withTenant(ctx, async (c) =>
  (await c.query('select * from fitting_session where id = $1', [id])).rows[0]);

test('QX01 answering every question No still reaches a scannable session', async () => {
  const id = await newSession();
  await answerAll(id, NEW_CUSTOMER_QUESTIONS, false);
  const s = await load(id);
  assert.equal(s.intake_discomfort, false);
  assert.equal(s.intake_shoe_issue, false);
  assert.equal(s.intake_high_activity, false);
  assert.equal(s.status, 'in_progress', 'the session advances on the first answer');
  assert.equal(s.intake_duration_seconds, 22);
});

test('QX02 answering every question Yes also reaches a scannable session', async () => {
  const id = await newSession();
  await answerAll(id, NEW_CUSTOMER_QUESTIONS, true);
  const s = await load(id);
  assert.equal(s.intake_discomfort, true);
  assert.equal(s.intake_high_activity, true);
  // No detail was supplied, and none is required: every detailed field is still null.
  assert.equal(s.shopping_purpose, null);
  assert.deepEqual(s.discomfort_area, []);
});

test('QX03 a returning customer writes only the two returning answers', async () => {
  const id = await newSession(2);
  await answerAll(id, RETURNING_CUSTOMER_QUESTIONS, true);
  const s = await load(id);
  assert.equal(s.intake_new_discomfort_since_last, true);
  assert.equal(s.intake_use_changed_since_last, true);
  assert.equal(s.intake_discomfort, null, 'the new-customer questions are not asked, so not answered');
});

test('QX04 unanswered questions stay null, and null is not No', async () => {
  const id = await newSession();
  const s = await load(id);
  for (const f of ['intake_discomfort', 'intake_shoe_issue', 'intake_high_activity']) {
    assert.equal(s[f], null, `${f} must start null`);
  }
  assert.deepEqual(buildToldUs(s).filter((i) => /discomfort|activity/i.test(i.label)), [],
    'an unanswered question must not print on the report');
});

test('QX05 the report prints the quick answers in plain language', () => {
  const items = buildToldUs({
    intake_discomfort: true, intake_shoe_issue: false, intake_high_activity: true,
  });
  assert.deepEqual(items, [
    { label: 'Foot discomfort reported', value: 'Yes' },
    { label: 'Current shoe discomfort or pressure', value: 'No' },
    { label: 'High activity or extended standing', value: 'Yes' },
  ]);
});

test('QX06 detailed fields still print when Add detail was used', () => {
  const items = buildToldUs({
    intake_discomfort: true, discomfort_area: ['heel'], shopping_purpose: 'work',
  });
  const labels = items.map((i) => i.label);
  assert.ok(labels.includes('Foot discomfort reported'));
  assert.ok(labels.includes('Where it bothers you'), 'the preserved fields still reach the report');
  assert.ok(labels.includes('Shopping for'));
});

test('QX07 the three answers are context, and cannot change an observed outcome', () => {
  // The honest form of "they must not overpower measured data": run the same
  // observations twice, once with every intake answer set to Yes and once with
  // none set at all, and require the measured attributes to come out identical.
  //
  // (An earlier version asserted that a low arch drives support to stability.
  // It does not, and should not: R-01 needs a reported arch discomfort plus
  // inner-edge wear or inward pronation before it will say that. The engine was
  // right and the assertion was wrong.)
  const observations = { size_left: 10, size_right: 10, arch_type: 'low', width: 'wide',
                         pronation_tendency: 'mild_inward', wear_pattern: 'inner_edge' };
  const intakeYes = { intake_discomfort: true, intake_shoe_issue: true, intake_high_activity: true,
                      discomfort_area: ['arch'] };
  const intakeBare = { discomfort_area: ['arch'] };

  const withAnswers = recommend(toObservedFeatures(intakeYes, observations), [],
    { assessmentSchemaVersion: 'test' });
  const without = recommend(toObservedFeatures(intakeBare, observations), [],
    { assessmentSchemaVersion: 'test' });

  for (const attr of ['width', 'support_level', 'insole', 'category', 'toe_box', 'heel_fit'] as const) {
    assert.equal(withAnswers.fitProfile[attr], without.fitProfile[attr],
      `${attr} must be decided by observation, not by a yes/no answer`);
  }
});

test('QX08 intake answers alone produce no diagnosis-shaped output', () => {
  const observed = toObservedFeatures(
    { intake_discomfort: true, intake_shoe_issue: true, intake_high_activity: true }, {});
  const rec = recommend(observed, [], { assessmentSchemaVersion: 'test' });
  const prose = JSON.stringify(rec).toLowerCase();
  for (const word of ['plantar', 'fasciitis', 'diagnos', 'patholog', 'condition', 'syndrome']) {
    assert.ok(!prose.includes(word), `a yes/no answer must not produce "${word}"`);
  }
});

test('QX09 analytics carries the new duration metric and drops anything else', () => {
  assert.ok((ANALYTICS_EVENTS as readonly string[]).includes('intake_completed'));
  assert.ok((ANALYTICS_EVENTS as readonly string[]).includes('scan_started'));
  assert.ok((ALLOWED_KEYS as readonly string[]).includes('intake_duration_seconds'));

  const { clean, dropped } = sanitize({
    fitting_session_id: 'abc', intake_duration_seconds: 21,
    first_name: 'Marisol', phone: '+16125554417',
  });
  assert.deepEqual(clean, { fitting_session_id: 'abc', intake_duration_seconds: 21 });
  assert.deepEqual(dropped.sort(), ['first_name', 'phone']);
});

test('QX10 every pre-existing intake column still exists and is still writable', async () => {
  const id = await newSession();
  const preserved = {
    shopping_purpose: 'work', discomfort_area: ['heel'], discomfort_timing: 'end_of_day',
    activity_level: 'active', standing_hours_per_day: '8_plus',
    current_shoe_problem: ['worn_out'], fit_priority: ['comfort'],
    uses_orthotics: 'otc', shoe_wear_concern: 'inner_edge', intake_notes: 'kept for later',
  };
  await writeIntake(ctx, id, preserved);
  const s = await load(id);
  for (const [k, v] of Object.entries(preserved)) {
    assert.deepEqual(s[k], v, `${k} must still round-trip`);
  }
});

test('QX11 a customer can be created through the real app path, under RLS', async () => {
  // The gap this covers: every other test creates customers through
  // withService, which has BYPASSRLS, so none of them exercised the policy the
  // associate's tablet actually runs under. createCustomer used RETURNING,
  // which re-reads the row through the policy's USING clause — and the location
  // grant that satisfies it is written by an AFTER INSERT trigger that has not
  // fired yet. Creating a customer therefore failed with "new row violates
  // row-level security policy" on the one screen that creates customers.
  const { createCustomer } = await import('../customers');
  const phone = `2${(Math.floor(Math.random() * 1e9)).toString().padStart(9, '0')}`;
  const created = await createCustomer({
    firstName: 'Dana', lastName: 'Okafor', phone, consent: true });

  assert.ok(created?.id, 'creating a customer must return the created row');
  assert.equal(created.first_name, 'Dana');
  assert.ok(created.local_customer_number, 'the per-retailer number is assigned by trigger');

  const { findCustomerByPhone } = await import('../customers');
  assert.equal((await findCustomerByPhone(phone))?.id, created.id,
    'and the new customer is immediately findable by the associate');
});

test.after(async () => { await closePool(); });
