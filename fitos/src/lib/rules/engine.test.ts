/**
 * Golden scenarios — docs/03 §8.
 *
 * Hand-labeled fittings asserted on every rule change. Ten minutes to write and
 * the single highest-leverage test in the codebase: it is what stops a rule edit
 * from silently breaking an earlier case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, toObservedFeatures, CatalogItem } from './engine';
import { violatesGuardrails } from './vocabulary';

const F = (intake: Record<string, unknown>, assessment: Record<string, unknown> = {}) =>
  toObservedFeatures(intake, assessment);

const catalog: CatalogItem[] = [
  { productModelId: 'p1', brand: 'Brand A', model: 'Shift 4E', category: 'work_support',
    supportLevel: 'stability', cushioningLevel: 'plush', widthsStocked: ['standard', 'wide'],
    toeBoxShape: 'wide_round', heelStructure: 'structured', removableInsole: true },
  { productModelId: 'p2', brand: 'Brand B', model: 'Glide Neutral', category: 'running_neutral',
    supportLevel: 'neutral', cushioningLevel: 'plush', widthsStocked: ['standard'],
    toeBoxShape: 'standard', heelStructure: 'standard', removableInsole: true },
  { productModelId: 'p3', brand: 'Brand C', model: 'Anchor Stability', category: 'running_stability',
    supportLevel: 'stability', cushioningLevel: 'moderate', widthsStocked: ['standard', 'wide'],
    toeBoxShape: 'standard', heelStructure: 'structured', removableInsole: true },
  { productModelId: 'p4', brand: 'Brand D', model: 'Sealed Trail', category: 'hiking',
    supportLevel: 'stability', cushioningLevel: 'moderate', widthsStocked: ['standard'],
    toeBoxShape: 'standard', heelStructure: 'structured', removableInsole: false },
];

// ── 1–7 · the scenarios named in the brief ──────────────────────────

test('G01 arch pain + low arch + inward wear → stability + arch support', () => {
  const r = recommend(F({ discomfort_area: ['arch'] }, { arch_type: 'low', wear_pattern: 'inner_edge' }));
  assert.equal(r.fitProfile.support_level, 'stability');
  assert.equal(r.fitProfile.insole, 'arch_support');
  assert.ok(r.firedRuleIds.includes('R-01'));
});

test('G02 heel pain + standing all day → cushioned support + heel comfort', () => {
  const r = recommend(F({ discomfort_area: ['heel'], standing_hours_per_day: '8_plus' }));
  assert.equal(r.fitProfile.cushioning_level, 'plush');
  assert.equal(r.fitProfile.support_level, 'stability');
  assert.ok(['heel_cup', 'anti_fatigue'].includes(r.fitProfile.insole));
});

test('G03 forefoot pain + wide foot → wide toe box + forefoot cushioning', () => {
  const r = recommend(F({ discomfort_area: ['ball_of_foot'] }, { width: 'wide' }));
  assert.equal(r.fitProfile.toe_box, 'wide_round');
  assert.equal(r.fitProfile.width, 'wide');
  assert.equal(r.fitProfile.insole, 'metatarsal');
});

test('G04 runner + knee discomfort + uneven wear → stability + gait review', () => {
  const r = recommend(F({ shopping_purpose: 'running', discomfort_area: ['knee'] }, { wear_pattern: 'inner_edge' }));
  assert.equal(r.fitProfile.category, 'running_stability');
  assert.ok(r.flags.includes('gait_review'));
});

test('G05 work + standing all day → durable support + anti-fatigue insole', () => {
  const r = recommend(F({ shopping_purpose: 'work', standing_hours_per_day: '8_plus' }));
  assert.equal(r.fitProfile.category, 'work_support');
  assert.equal(r.fitProfile.insole, 'anti_fatigue');
});

test('G06 toe discomfort + tight shoe → roomy toe box + size check', () => {
  const r = recommend(F({ discomfort_area: ['toes'], current_shoe_problem: ['too_tight'] }));
  assert.equal(r.fitProfile.toe_box, 'roomy');
  assert.ok(r.flags.includes('size_up_check'));
});

test('G07 high arch + shock discomfort → neutral cushioned', () => {
  const r = recommend(F({ discomfort_area: ['ball_of_foot'] }, { arch_type: 'high' }));
  assert.equal(r.fitProfile.support_level, 'neutral');
  assert.equal(r.fitProfile.cushioning_level, 'plush');
});

// ── 8–16 · profile mechanics ────────────────────────────────────────

test('G08 size asymmetry raises the flag and a talking point', () => {
  const r = recommend(F({}, { size_left: 10.5, size_right: 11 }));
  assert.ok(r.flags.includes('size_asymmetry'));
  assert.ok(r.talkingPoints.some((t) => t.includes('different sizes')));
});

test('G09 identical sizes do not raise asymmetry', () => {
  const r = recommend(F({}, { size_left: 10.5, size_right: 10.5 }));
  assert.ok(!r.flags.includes('size_asymmetry'));
});

test('G10 custom orthotic forces a removable insole and sells nothing', () => {
  const r = recommend(F({ uses_orthotics: 'custom' }), catalog);
  assert.ok(r.flags.includes('removable_insole_required'));
  assert.equal(r.fitProfile.insole, 'none');
  assert.deepEqual(r.upsells, []);
  assert.ok(!r.candidates.some((c) => c.productModelId === 'p4'), 'glued-in footbed excluded');
});

test('G11 low volume + heel slip → secure narrow heel', () => {
  const r = recommend(F({}, { foot_shape: ['low_volume'], heel_slip_risk: 'noticeable' }));
  assert.equal(r.fitProfile.heel_fit, 'secure_narrow');
  assert.ok(r.flags.includes('lacing_guidance'));
});

test('G12 bunion accommodation widens the toe box', () => {
  const r = recommend(F({}, { toe_box_issue: ['bunion'] }));
  assert.equal(r.fitProfile.toe_box, 'wide_round');
});

test('G13 previous narrow return defaults a width up', () => {
  const r = recommend(F({ previous_return_reason: 'too_narrow' }));
  assert.equal(r.fitProfile.width, 'wide');
});

test('G14 previous uncomfortable return forces the longer path', () => {
  const r = recommend(F({ previous_return_reason: 'uncomfortable' }));
  assert.ok(r.flags.includes('extended_check_in'));
  assert.ok(r.flags.includes('walk_test_required'));
});

test('G15 old shoes trigger expectation setting, not an upsell', () => {
  const r = recommend(F({ current_shoe_age: '2_plus_years' }));
  assert.ok(r.flags.includes('break_in_guidance'));
  assert.ok(r.rationale.includes('firmer at first'));
});

test('G16 hiking + ankle concern → structured heel and break-in', () => {
  const r = recommend(F({ shopping_purpose: 'hiking', discomfort_area: ['ankle'] }));
  assert.equal(r.fitProfile.category, 'hiking');
  assert.equal(r.fitProfile.heel_fit, 'structured');
  assert.ok(r.flags.includes('break_in_guidance'));
});

// ── 17–21 · safety, ethics, guardrails ──────────────────────────────

test('G17 red flags route to referral and suppress every upsell', () => {
  const r = recommend(F({ red_flags: ['numbness'], discomfort_area: ['ball_of_foot'] }));
  assert.equal(r.fitProfile.category, 'orthopedic_friendly');
  assert.ok(r.flags.includes('referral_suggested'));
  assert.deepEqual(r.upsells, [], 'never upsell into a red flag');
});

test('G18 kids fittings sell no insoles', () => {
  const r = recommend(F({ shopping_purpose: 'kids' }));
  assert.equal(r.fitProfile.category, 'kids');
  assert.deepEqual(r.upsells, []);
});

test('G19 no customer-facing string trips the banned lexicon', () => {
  const scenarios = [
    F({ discomfort_area: ['heel'], discomfort_timing: 'first_steps_morning' }),
    F({ red_flags: ['persistent_pain'] }),
    F({ shopping_purpose: 'running', discomfort_area: ['knee'] }, { wear_pattern: 'inner_edge' }),
    F({ uses_orthotics: 'custom' }),
  ];
  for (const f of scenarios) {
    const r = recommend(f);
    for (const text of [...r.talkingPoints, r.rationale, ...r.avoid]) {
      assert.deepEqual(violatesGuardrails(text), [], `guardrail violation in: ${text}`);
    }
  }
});

test('G20 morning heel pain never names a condition', () => {
  const r = recommend(F({ discomfort_area: ['heel'], discomfort_timing: 'first_steps_morning' }));
  assert.ok(r.flags.includes('referral_suggested'));
  assert.deepEqual(r.upsells, [], 'referral suppresses upsell');
});

test('G21 avoid list names characteristics, never brands', () => {
  const r = recommend(F({ discomfort_area: ['arch'] }, { arch_type: 'low', wear_pattern: 'inner_edge', width: 'wide' }), catalog);
  for (const a of r.avoid) {
    for (const item of catalog) assert.ok(!a.includes(item.brand), 'avoid list must not name a brand');
  }
});

// ── 22–27 · evidence strength, conflicts, versions, catalog ─────────

test('G22 complete agreeing input reads high', () => {
  const r = recommend(F(
    { shopping_purpose: 'work', standing_hours_per_day: '8_plus', discomfort_area: ['heel'] },
    { arch_type: 'low', width: 'wide', pronation_tendency: 'mild_inward', wear_pattern: 'inner_edge' },
  ));
  assert.equal(r.evidenceStrength, 'high');
  assert.deepEqual(r.evidenceDetail.missingPrimary, []);
});

test('G23 sparse input reads low and says what is missing', () => {
  const r = recommend(F({ shopping_purpose: 'walking' }));
  assert.equal(r.evidenceStrength, 'low');
  assert.ok(r.evidenceDetail.missingPrimary.length >= 2);
  assert.ok(r.evidenceDetail.reason.length > 0);
});

test('G24 contradictory primaries drop to low and surface the conflict', () => {
  const r = recommend(F(
    { shopping_purpose: 'running', discomfort_area: ['arch'] },
    { arch_type: 'high', width: 'standard', pronation_tendency: 'outward', wear_pattern: 'inner_edge' },
  ));
  assert.equal(r.evidenceStrength, 'low');
  assert.ok(r.evidenceDetail.conflicts.some((c) => c.between.includes('outward roll')));
});

test('G25 price priority against a support need offers the insole route', () => {
  const r = recommend(F(
    { fit_priority: ['price'], discomfort_area: ['arch'] },
    { arch_type: 'low', wear_pattern: 'inner_edge' },
  ));
  assert.ok(r.firedRuleIds.includes('R-29'), 'second pass reads the derived support need');
  assert.ok(r.flags.includes('value_framing'));
});

test('G26 every recommendation carries all five version stamps', () => {
  const r = recommend(F({ shopping_purpose: 'walking' }));
  for (const k of ['recommendation_engine_version', 'rule_set_version', 'catalog_version',
    'feature_schema_version', 'assessment_schema_version'] as const) {
    assert.ok(r.versions[k], `missing ${k}`);
  }
  assert.ok(Object.keys(r.featureSnapshot).length > 0, 'feature snapshot frozen onto the record');
});

test('G27 an empty catalog still produces a usable recommendation', () => {
  const r = recommend(F({ shopping_purpose: 'work', standing_hours_per_day: '8_plus' }), []);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.fitProfile.category, 'work_support');
  assert.ok(r.talkingPoints.length > 0, 'the fit profile alone must be useful');
});

test('G28 catalog matching respects stocked widths', () => {
  const r = recommend(F({ discomfort_area: ['ball_of_foot'] }, { width: 'wide' }), catalog);
  for (const c of r.candidates) {
    const item = catalog.find((i) => i.productModelId === c.productModelId)!;
    assert.ok(item.widthsStocked.includes('wide'), 'never recommend a width the store cannot sell');
  }
});

test('G29 the engine is deterministic', () => {
  const f = F({ shopping_purpose: 'work', standing_hours_per_day: '8_plus', discomfort_area: ['heel'] },
    { arch_type: 'low', width: 'wide', size_left: 10.5, size_right: 11 });
  const a = recommend(f, catalog); const b = recommend(f, catalog);
  assert.deepEqual(a.fitProfile, b.fitProfile);
  assert.deepEqual(a.firedRuleIds, b.firedRuleIds);
  assert.deepEqual(a.candidates, b.candidates);
});

test('G30 rule order does not change the outcome', () => {
  // arch discomfort included deliberately: it is what brings R-01 in alongside
  // R-06 and R-21, giving three independent rules to check ordering against.
  const f = F({ shopping_purpose: 'work', standing_hours_per_day: '8_plus', discomfort_area: ['heel', 'arch'] },
    { arch_type: 'low', wear_pattern: 'inner_edge' });
  const r = recommend(f);
  assert.ok(r.firedRuleIds.length >= 3);
  const sorted = [...r.firedRuleIds].sort();
  assert.deepEqual(r.firedRuleIds, sorted, 'fired ids stay in stable rule-file order');
});

// ── 31–34 · direct observations reach the profile ───────────────────
// Regression tests for a gap found by walking a real fitting: measured width
// and stated purpose never reached the recommendation, because every rule
// encodes an inference and none encoded "what you measured is what you need."

test('G31 a measured wide foot produces a wide last', () => {
  const r = recommend(F({ shopping_purpose: 'work' }, { width: 'wide' }));
  assert.equal(r.fitProfile.width, 'wide');
});

test('G32 a stated purpose sets the category on its own', () => {
  for (const [purpose, category] of [['work', 'work_support'], ['running', 'running_neutral'],
    ['walking', 'walking_comfort'], ['hiking', 'hiking']] as const) {
    assert.equal(recommend(F({ shopping_purpose: purpose })).fitProfile.category, category);
  }
});

test('G33 an inference rule still outranks the baseline seed', () => {
  // purpose seeds running_neutral at 1; R-19 votes running_stability at 3.
  const r = recommend(F({ shopping_purpose: 'running', discomfort_area: ['knee'] }, { wear_pattern: 'inner_edge' }));
  assert.equal(r.fitProfile.category, 'running_stability');
});

test('G34 measured foot volume carries through', () => {
  assert.equal(recommend(F({}, { foot_shape: ['high_volume'] })).fitProfile.volume, 'high');
  assert.equal(recommend(F({}, { foot_shape: ['low_volume'] })).fitProfile.volume, 'low');
});
