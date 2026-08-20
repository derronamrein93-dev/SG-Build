/**
 * Customer-reported concerns.
 *
 * The safety-critical assertions are CN14 and CN15: a concern is a quote, and a
 * quote must never become a claim. `plantar fasciitis` and `neuroma` are in
 * BANNED_TERMS -- generated prose still may not contain them, even when the
 * customer has selected exactly those chips.
 *
 * Requires: bash db/reset.sh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTenant, withService, closePool } from '../db/client';
import { DEMO } from '../session';
import { writeIntake } from './save';
import {
  CONCERN_VALUES, CONCERN_LABELS, CONCERN_OTHER_MAX,
  shouldOfferConcerns, normalizeConcerns, inspectionPrompts,
} from './concerns';
import { buildToldUs } from '../report/toldUs';
import { toObservedFeatures, recommend } from '../rules/engine';
import { composeWhy } from '../report/language';
import { violatesGuardrails, BANNED_TERMS } from '../rules/vocabulary';
import { sanitize, ANALYTICS_EVENTS } from '../analytics';

const ctx = { organizationId: DEMO.organizationId, locationId: DEMO.locationId };
const CONTROL = new RegExp('[' + '\\u0000-\\u001f\\u007f' + ']');
const TAB = String.fromCharCode(9);

async function newSession(visit = 1): Promise<string> {
  return withService(async (c) => (await c.query(
    `insert into fitting_session (organization_id, location_id, user_id, status, visit_number)
     values ($1,$2,$3,'draft',$4) returning id`,
    [DEMO.organizationId, DEMO.locationId, DEMO.userId, visit])).rows[0].id as string);
}
const load = (id: string) => withTenant(ctx, async (c) =>
  (await c.query('select * from fitting_session where id = $1', [id])).rows[0]);

test('CN01 both No means the concern screen is never offered', () => {
  assert.equal(shouldOfferConcerns(
    { intake_discomfort: false, intake_shoe_issue: false, intake_high_activity: true }), false);
});

test('CN02 a Yes on discomfort offers the screen', () => {
  assert.equal(shouldOfferConcerns({ intake_discomfort: true, intake_shoe_issue: false }), true);
});

test('CN03 a Yes on the shoe question offers the screen', () => {
  assert.equal(shouldOfferConcerns({ intake_discomfort: false, intake_shoe_issue: true }), true);
});

test('CN04 a returning customer with new discomfort is offered the screen', () => {
  assert.equal(shouldOfferConcerns({ intake_new_discomfort_since_last: true }), true);
});

test('CN05 a returning customer with no new discomfort is not', () => {
  assert.equal(shouldOfferConcerns(
    { intake_new_discomfort_since_last: false, intake_use_changed_since_last: true }), false);
  assert.equal(shouldOfferConcerns({}), false, 'unanswered is not a Yes');
});

test('CN06 skipping leaves nothing behind', async () => {
  const id = await newSession();
  await writeIntake(ctx, id, { reported_concerns: [], reported_concern_other: null });
  const s = await load(id);
  assert.deepEqual(s.reported_concerns, []);
  assert.equal(s.reported_concern_other, null);
});

test('CN07 several concerns persist, in canonical order', async () => {
  const id = await newSession();
  await writeIntake(ctx, id, { reported_concerns: ['heel_pain', 'plantar_fasciitis', 'bunion'] });
  assert.deepEqual((await load(id)).reported_concerns, ['plantar_fasciitis', 'bunion', 'heel_pain']);
});

test('CN08 deselecting removes a concern', async () => {
  const id = await newSession();
  await writeIntake(ctx, id, { reported_concerns: ['heel_pain', 'bunion'] });
  await writeIntake(ctx, id, { reported_concerns: ['heel_pain'] });
  assert.deepEqual((await load(id)).reported_concerns, ['heel_pain']);
});

test('CN09 other text is optional, and only kept alongside the other chip', async () => {
  const id = await newSession();
  await writeIntake(ctx, id, { reported_concerns: ['other'] });
  assert.equal((await load(id)).reported_concern_other, null, 'the chip alone is valid');

  await writeIntake(ctx, id, { reported_concerns: ['heel_pain'], reported_concern_other: 'stray' });
  assert.equal((await load(id)).reported_concern_other, null,
    'text without the chip is dropped, matching the database constraint');
});

test('CN10 other text is bounded and stripped of control characters', async () => {
  const id = await newSession();
  const messy = 'morton' + TAB + 'toe   ' + 'x'.repeat(400);
  await writeIntake(ctx, id, { reported_concerns: ['other'], reported_concern_other: messy });
  const stored = (await load(id)).reported_concern_other as string;
  assert.ok(stored.length <= CONCERN_OTHER_MAX);
  assert.ok(stored.startsWith('morton toe '), 'saw: ' + stored.slice(0, 20));
  assert.ok(!CONTROL.test(stored), 'no control characters reach the database');
});

test('CN11 unknown values are dropped rather than stored', async () => {
  const id = await newSession();
  await writeIntake(ctx, id, { reported_concerns: ['heel_pain', 'gout', 'DROP TABLE'] });
  assert.deepEqual((await load(id)).reported_concerns, ['heel_pain']);
});

test('CN12 the report shows concerns as a customer-reported quote', () => {
  const items = buildToldUs({
    intake_discomfort: true,
    reported_concerns: ['plantar_fasciitis', 'heel_pain', 'orthotics_inserts'],
  });
  const row = items.find((i) => i.label === 'Customer-reported concerns');
  assert.ok(row, 'the section must appear');
  assert.equal(row.value, 'Plantar fasciitis, Heel pain, Uses orthotics / inserts');
});

test('CN13 the report omits the section when nothing was selected', () => {
  for (const session of [{ intake_discomfort: true }, { reported_concerns: [] }]) {
    const labels = buildToldUs(session).map((i) => i.label);
    assert.ok(!labels.some((l) => /concern/i.test(l)), 'no empty concern row');
  }
  const withOther = buildToldUs({ reported_concerns: ['other'], reported_concern_other: 'sore after work' });
  assert.ok(withOther.some((i) => i.label === 'Other customer-reported concern'));
});

test('CN14 a diagnosis label alone never moves the fit profile', () => {
  // plantar_fasciitis is a name for a condition, not a description of a foot.
  // Acting on it would be inferring from a self-reported diagnosis, so it votes
  // on nothing. The heel or arch pain that usually accompanies it is what
  // carries the fit signal, and that is a description.
  const observations = { size_left: 10, size_right: 10, arch_type: 'low', width: 'standard' };
  const labelled = recommend(
    toObservedFeatures({ reported_concerns: ['plantar_fasciitis'] }, observations),
    [], { assessmentSchemaVersion: 'test' });
  const bare = recommend(
    toObservedFeatures({}, observations), [], { assessmentSchemaVersion: 'test' });
  assert.deepEqual(labelled.fitProfile, bare.fitProfile);
});

test('CN14b a concern that does nudge cannot outvote an observation', () => {
  // neuroma and bunion nudge the toe box, because "make room in the forefoot" is
  // a fitting response. Weight 0.25 means an observation always wins.
  const observed = { size_left: 10, size_right: 10, toe_box_issue: ['width_pinch'] };
  const withConcern = recommend(
    toObservedFeatures({ reported_concerns: ['neuroma', 'bunion'] }, observed),
    [], { assessmentSchemaVersion: 'test' });
  const withoutConcern = recommend(
    toObservedFeatures({}, observed), [], { assessmentSchemaVersion: 'test' });

  for (const attr of ['support_level', 'width', 'category', 'insole', 'heel_fit'] as const) {
    assert.equal(withConcern.fitProfile[attr], withoutConcern.fitProfile[attr],
      attr + ' must be decided by observation, not by a reported concern');
  }
});

test('CN15 generated prose still cannot name a condition the customer selected', () => {
  const rec = recommend(
    toObservedFeatures(
      { intake_discomfort: true, reported_concerns: ['plantar_fasciitis', 'neuroma', 'bunion'] },
      { size_left: 10, size_right: 10, arch_type: 'low', width: 'wide' }),
    [], { assessmentSchemaVersion: 'test' });

  const language = composeWhy(rec, rec.featureSnapshot);
  assert.deepEqual(violatesGuardrails(language.paragraph), [],
    'the composed paragraph must stay clean: ' + language.paragraph);
  for (const point of rec.talkingPoints) {
    assert.deepEqual(violatesGuardrails(point), [], 'talking point leaked a term: ' + point);
  }
  assert.ok(BANNED_TERMS.includes('plantar fasciitis'));
  assert.ok(BANNED_TERMS.includes('neuroma'));
});

test('CN16 analytics carries counts, never the customer words', () => {
  for (const e of ['concern_screen_shown', 'concern_screen_completed', 'concern_screen_skipped']) {
    assert.ok((ANALYTICS_EVENTS as readonly string[]).includes(e), e + ' must be declared');
  }
  const { clean, dropped } = sanitize({
    fitting_session_id: 'abc', concern_count: 3, concern_other_used: true,
    reported_concern_other: 'morton toe since June', reported_concerns: ['neuroma'],
  });
  assert.deepEqual(clean, { fitting_session_id: 'abc', concern_count: 3, concern_other_used: true });
  assert.deepEqual(dropped.sort(), ['reported_concern_other', 'reported_concerns']);
});

test('CN17 inspection prompts say what to look at, not what it is', () => {
  const prompts = inspectionPrompts(['plantar_fasciitis', 'bunion', 'neuroma']);
  assert.equal(prompts.length, 3);
  for (const p of prompts) {
    assert.match(p.check, /^Check|^Confirm/, 'a prompt is an instruction to inspect');
    for (const banned of ['diagnos', 'treat', 'cure', 'prescri', 'condition']) {
      assert.ok(!p.check.toLowerCase().includes(banned), '"' + p.check + '" reads clinical');
    }
  }
});

test('CN18 every concern value has a label, and the lists agree', () => {
  for (const v of CONCERN_VALUES) assert.ok(CONCERN_LABELS[v], v + ' has no label');
  assert.equal(Object.keys(CONCERN_LABELS).length, CONCERN_VALUES.length);
  assert.deepEqual(normalizeConcerns([...CONCERN_VALUES]), [...CONCERN_VALUES]);
});

test.after(async () => { await closePool(); });
