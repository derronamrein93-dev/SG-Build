import test from 'node:test';
import assert from 'node:assert/strict';
import { composeWhy, composeWhyWithProvider, LanguageProvider } from './language';
import { recommend, toObservedFeatures } from '../rules/engine';
import { violatesGuardrails } from '../rules/vocabulary';
import { buildToldUs } from './toldUs';

const build = (row: Record<string, unknown>) => {
  const f = toObservedFeatures(row, row);
  return { rec: recommend(f), features: f };
};

const WORK = {
  shopping_purpose: 'work', discomfort_area: ['heel'], standing_hours_per_day: '8_plus',
  fit_priority: ['comfort', 'durability'], shoe_wear_concern: 'inner_edge',
  width: 'wide', arch_type: 'low', size_left: 10, size_right: 10.5,
};

/* ── the language layer ─────────────────────────────────────────── */

test('L01 never emits a rule report string verbatim', () => {
  const { rec, features } = build(WORK);
  const { paragraph } = composeWhy(rec, features);
  // Three rules fire here; none of their report strings may appear.
  for (const fragment of [
    'Long hours on your feet with heel discomfort',
    'Your feet measured slightly different sizes. We fitted the larger foot for comfort.',
    'We recommended a durable, supportive work shoe with an anti-fatigue insole.',
  ]) {
    assert.ok(!paragraph.includes(fragment), `concatenated rule text: ${fragment}`);
  }
});

test('L02 does not repeat the same observation twice', () => {
  const { rec, features } = build(WORK);
  const { paragraph } = composeWhy(rec, features).paragraph
    ? composeWhy(rec, features) : composeWhy(rec, features);
  // Whole observation phrases, not bare words: "heel" legitimately appears
  // twice in a good paragraph — once as the customer's heel, once as the
  // shoe's — and those are different referents, not a repetition.
  for (const phrase of [
    'on your feet', 'discomfort in the heel', 'wear along the inner edge',
    'anti-fatigue', 'different sizes', 'a lower arch',
  ]) {
    const hits = paragraph.toLowerCase().split(phrase.toLowerCase()).length - 1;
    assert.ok(hits <= 1, `"${phrase}" appears ${hits} times`);
  }
});

test('L03 no sentence is duplicated, across many rule combinations', () => {
  const rows = [
    WORK,
    { shopping_purpose: 'running', discomfort_area: ['knee'], shoe_wear_concern: 'inner_edge', arch_type: 'medium' },
    { shopping_purpose: 'walking', uses_orthotics: 'custom', discomfort_area: ['none'] },
    { shopping_purpose: 'hiking', discomfort_area: ['ankle', 'heel'], arch_type: 'high', width: 'wide' },
    { shopping_purpose: 'work', discomfort_area: ['heel', 'ball_of_foot'], standing_hours_per_day: '8_plus',
      width: 'extra_wide', arch_type: 'low', current_shoe_age: '2_plus_years' },
    { shopping_purpose: 'casual' },
  ];
  for (const row of rows) {
    const { rec, features } = build(row);
    const sentences = composeWhy(rec, features).paragraph.split('. ').map((s) => s.trim());
    assert.equal(new Set(sentences).size, sentences.length, `duplicate sentence for ${JSON.stringify(row)}`);
  }
});

test('L04 reads as prose: 3–6 sentences, no jargon, no exclamation', () => {
  const { rec, features } = build(WORK);
  const { paragraph } = composeWhy(rec, features);
  const sentences = paragraph.split(/(?<=\.)\s+/).filter(Boolean);
  assert.ok(sentences.length >= 3 && sentences.length <= 6, `got ${sentences.length} sentences`);
  assert.ok(!paragraph.includes('!'));
  for (const jargon of ['pronation', 'supination', 'plantar', 'varus', 'valgus', 'metatarsal']) {
    assert.ok(!paragraph.toLowerCase().includes(jargon), `jargon leaked: ${jargon}`);
  }
});

test('L05 passes the guardrail lexicon on every scenario', () => {
  const rows = [WORK,
    { discomfort_area: ['heel'], discomfort_timing: 'first_steps_morning' },
    { red_flags: ['numbness'], discomfort_area: ['ball_of_foot'] },
    { shopping_purpose: 'kids' }];
  for (const row of rows) {
    const { rec, features } = build(row);
    assert.deepEqual(violatesGuardrails(composeWhy(rec, features).paragraph), []);
  }
});

test('L06 red flags end on the referral line, stated neutrally', () => {
  const { rec, features } = build({ red_flags: ['numbness'], discomfort_area: ['ball_of_foot'] });
  const { paragraph } = composeWhy(rec, features);
  assert.ok(paragraph.includes('healthcare professional'));
  assert.ok(!/urgent|serious|condition|danger/i.test(paragraph));
});

test('L07 is deterministic', () => {
  const { rec, features } = build(WORK);
  assert.equal(composeWhy(rec, features).paragraph, composeWhy(rec, features).paragraph);
});

/* ── the provider seam ──────────────────────────────────────────── */

const provider = (text: string): LanguageProvider =>
  ({ name: 'test', compose: async () => text });

test('L08 a clean model paragraph is used', async () => {
  const { rec, features } = build(WORK);
  const good = 'You are on your feet all day and mentioned heel discomfort, so we fitted a supportive '
    + 'shoe with lasting cushioning in a wider fit. The insole takes a little pressure off late in a shift.';
  const out = await composeWhyWithProvider(rec, features, provider(good));
  assert.equal(out.provider, 'model');
  assert.equal(out.paragraph, good);
});

test('L09 a model paragraph tripping the lexicon is discarded', async () => {
  const { rec, features } = build(WORK);
  const bad = 'This shoe will treat your plantar fasciitis and prevent injury over a long shift at work today.';
  const out = await composeWhyWithProvider(rec, features, provider(bad));
  assert.equal(out.provider, 'deterministic');
  assert.match(out.fallbackReason ?? '', /guardrail/);
});

test('L10 a model implying precision is discarded', async () => {
  const { rec, features } = build(WORK);
  const bad = 'We are 93% sure this is the right shoe for the way you stand and walk through a long working day.';
  const out = await composeWhyWithProvider(rec, features, provider(bad));
  assert.equal(out.provider, 'deterministic');
  assert.match(out.fallbackReason ?? '', /precision/);
});

test('L11 a provider failure falls back silently to the deterministic text', async () => {
  const { rec, features } = build(WORK);
  const out = await composeWhyWithProvider(rec, features, {
    name: 'broken', compose: async () => { throw new Error('timeout'); },
  });
  assert.equal(out.provider, 'deterministic');
  assert.equal(out.paragraph, composeWhy(rec, features).paragraph);
});

/* ── what you told us ───────────────────────────────────────────── */

test('T01 renders every supplied intake field in customer-readable words', () => {
  const items = buildToldUs({
    shopping_purpose: 'work', discomfort_area: ['heel'], fit_priority: ['comfort', 'durability'],
    standing_hours_per_day: '8_plus', current_shoe_problem: ['too_tight'], uses_orthotics: 'custom',
  });
  const map = Object.fromEntries(items.map((i) => [i.label, i.value]));
  assert.equal(map['Shopping for'], 'Work');
  assert.equal(map['Where it bothers you'], 'Heel');
  assert.equal(map['What matters most'], 'Comfort, Durability');
  assert.equal(map['Time on your feet'], '8+ hours a day');
  assert.equal(map['Current shoes'], 'Too tight');
  assert.equal(map['Inserts or orthotics'], 'Yes — custom orthotics');
});

test('T02 omits fields the customer never answered', () => {
  const items = buildToldUs({ shopping_purpose: 'walking' });
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Shopping for');
});

test('T03 "no orthotics" is not shown as a row', () => {
  const items = buildToldUs({ shopping_purpose: 'walking', uses_orthotics: 'no' });
  assert.ok(!items.some((i) => i.label === 'Inserts or orthotics'));
});

test('T04 falls back to activity level when hours are not given', () => {
  const items = buildToldUs({ activity_level: 'very_active' });
  assert.equal(items.find((i) => i.label === 'Time on your feet')?.value, 'Very active');
});

test('T05 emits no raw enum values', () => {
  const items = buildToldUs({
    shopping_purpose: 'orthopedic', discomfort_area: ['ball_of_foot'], fit_priority: ['price'],
    standing_hours_per_day: '4_8', shoe_wear_concern: 'inner_edge', uses_orthotics: 'otc',
  });
  for (const i of items) assert.ok(!/_/.test(i.value), `raw enum leaked: ${i.value}`);
});
