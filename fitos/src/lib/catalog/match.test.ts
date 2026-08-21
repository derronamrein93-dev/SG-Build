/**
 * Catalog matching: constraints, curves, scoring and explainability.
 *
 * Scenarios A-E from the brief, plus the assertions that keep the design
 * honest: unknown never becomes a claim, a reported label never becomes a
 * physical requirement, and every sentence traces to a scored dimension.
 *
 * Pure functions over synthetic fixtures. No database, no browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequirementProfile, requirementsFromFitting, SOURCE_PRIORITY,
         type Requirement } from './requirements';
import { curveScore, overallScore, scoreDimension, DIMENSIONS, SYMMETRIC, EXCESS, DEFICIT,
         MIN_SCORED_DIMENSIONS, asPercent } from './scoring';
import { evaluateConstraints, firstFailure } from './constraints';
import { matchShoe, rankMatches } from './match';
import { useCaseScore, COMPAT } from './use-case';
import { WIDE_COMFORT, NARROW_PERFORMANCE, SMALL_SIZES_ONLY, GLUED_INSOLE,
         UNDOCUMENTED, MARKETING_ONLY, OVERSIZED, ALL_FIXTURES } from './fixtures';

const ctx = (over: Partial<Parameters<typeof evaluateConstraints>[0]> = {}) => ({
  requiredSize: 11, sizeAsymmetry: 0, requiredWidth: 'wide', widthConfidence: 0.95,
  safetyToeRequired: false, orthoticAccommodationRequired: false, excludedCategories: [],
  ...over,
});

const wideStandingProfile = buildRequirementProfile(requirementsFromFitting({
  fitProfile: { category: 'walking_comfort', cushioning_level: 'plush',
                support_level: 'stability', toe_box: 'roomy', volume: 'high',
                heel_fit: 'standard' },
  measuredWidth: 'wide',
}));

// ── curves ──────────────────────────────────────────────────────────────────

test('CM01 the three curves have the approved shape', () => {
  assert.deepEqual(SYMMETRIC, [1.00, 0.70, 0.40, 0.15]);
  assert.deepEqual(EXCESS,    [1.00, 0.95, 0.80, 0.60]);
  assert.deepEqual(DEFICIT,   [1.00, 0.55, 0.25, 0.05]);
});

test('CM02 too little room is penalised harder than too much', () => {
  assert.equal(curveScore(+1, true), 0.95);
  assert.equal(curveScore(-1, true), 0.55);
  assert.ok(curveScore(+1, true) > curveScore(-1, true));
  // ...but excess is not free, which is the correction to the first draft.
  assert.ok(curveScore(+2, true) < curveScore(+1, true));
  assert.ok(curveScore(+3, true) < curveScore(+2, true));
  assert.ok(curveScore(+3, true) > 0, 'excessive room is a poor fit, not a disqualification');
});

test('CM03 symmetric scoring sits between the two directions', () => {
  assert.ok(curveScore(-1, false) < curveScore(+1, true));
  assert.ok(curveScore(-1, false) > curveScore(-1, true));
});

// ── use-case compatibility ──────────────────────────────────────────────────

test('CM04 a running shoe is a strong answer for walking, not a miss', () => {
  assert.equal(useCaseScore('walking_comfort', 'running_neutral'), COMPAT.STRONG);
  // ...and the reverse is not true.
  assert.ok(useCaseScore('running_neutral', 'walking_comfort') < COMPAT.STRONG);
});

test('CM05 category compatibility is never a silent zero', () => {
  // An unlisted pair is weak, not incompatible. Unusual is not wrong.
  assert.equal(useCaseScore('hiking', 'court_sport'), COMPAT.WEAK);
  // Only genuinely incompatible pairs score zero.
  assert.equal(useCaseScore('walking_comfort', 'kids'), 0);
});

test('CM06 a secondary use is credited when it is the better match', () => {
  assert.equal(useCaseScore('walking_comfort', 'court_sport', ['walking_comfort']), COMPAT.PRIMARY);
});

// ── hard constraints ────────────────────────────────────────────────────────

test('CM07 size is a hard constraint — Scenario: size 11 foot, size 9 shoe', () => {
  const r = evaluateConstraints(ctx(), SMALL_SIZES_ONLY);
  const f = firstFailure(r);
  assert.ok(f, 'a shoe that does not come in the size must be eliminated');
  assert.equal(f.constraint, 'size_available');
  assert.match(f.detail, /needs 11/);
});

test('CM08 an unmeasured foot cannot eliminate the wall', () => {
  const r = evaluateConstraints(ctx({ requiredSize: null, requiredWidth: null }), SMALL_SIZES_ONLY);
  assert.equal(firstFailure(r), null);
  assert.ok(r.find((x) => x.constraint === 'size_available' && !x.applied));
});

test('CM09 width eliminates only when measured AND the shoe data is trusted', () => {
  const trusted = evaluateConstraints(ctx({ requiredWidth: 'extra_wide' }), NARROW_PERFORMANCE);
  assert.equal(firstFailure(trusted)?.constraint, 'width_available');

  const untrusted = evaluateConstraints(
    ctx({ requiredWidth: 'extra_wide', widthConfidence: 0.4 }), NARROW_PERFORMANCE);
  assert.equal(firstFailure(untrusted), null, 'weak width data must not eliminate');
});

test('CM10 an orthotic requirement is hard; the weighted dimension only ranks survivors', () => {
  const r = evaluateConstraints(ctx({ orthoticAccommodationRequired: true }), GLUED_INSOLE);
  assert.equal(firstFailure(r)?.constraint, 'orthotic_accommodation');

  const notNeeded = evaluateConstraints(ctx(), GLUED_INSOLE);
  assert.equal(firstFailure(notNeeded), null, 'no orthotic in play, no constraint');
});

test('CM11 preferences never eliminate', () => {
  // NARROW_PERFORMANCE is wrong on nearly every weighted dimension for this
  // profile. With width unmeasured it must still survive to be ranked, not
  // filtered out -- the inversion this phase exists to fix.
  const r = evaluateConstraints(ctx({ requiredWidth: null }), NARROW_PERFORMANCE);
  assert.equal(firstFailure(r), null);
});

// ── scoring ─────────────────────────────────────────────────────────────────

test('CM12 unknown attributes leave the sums rather than scoring zero', () => {
  const m = matchShoe(wideStandingProfile, UNDOCUMENTED, ctx({ requiredWidth: null }));
  const unknown = m.dimensions.filter((d) => !d.known);
  assert.ok(unknown.length > 0);
  for (const d of unknown) assert.equal(d.score, null, `${d.dimension} must not be scored`);
  assert.ok(unknown.some((d) => d.unknownReason === 'no_value'));
});

test('CM13 below three scored dimensions no percentage is shown', () => {
  const m = matchShoe(wideStandingProfile, UNDOCUMENTED, ctx({ requiredWidth: null }));
  assert.ok(m.scoredCount < MIN_SCORED_DIMENSIONS || m.percent !== null);
  const thin = overallScore([{ known: true, score: 1, weight: 3, confidence: 0.9 } as never]);
  assert.equal(thin.overall, null);
  assert.equal(thin.suppressed, true);
});

test('CM14 marketing-only data is treated as unknown, not as fact', () => {
  const m = matchShoe(wideStandingProfile, MARKETING_ONLY, ctx({ requiredWidth: null }));
  const below = m.dimensions.filter((d) => d.unknownReason === 'below_confidence_threshold');
  assert.ok(below.length > 0, 'marketing-sourced values must fall below the floors');
  // Cushioning has a 0.35 floor on purpose, so it still scores.
  assert.ok(m.dimensions.find((d) => d.dimension === 'cushioning')?.known);
  // Width has a 0.75 floor, so it does not.
  assert.equal(m.dimensions.find((d) => d.dimension === 'width_fit')?.known, false);
});

test('CM15 the overall score reconciles arithmetically with its dimensions', () => {
  const m = matchShoe(wideStandingProfile, WIDE_COMFORT, ctx());
  const known = m.dimensions.filter((d) => d.known && d.score !== null);
  let num = 0, den = 0;
  for (const d of known) { const w = d.weight * d.confidence; num += w * (d.score as number); den += w; }
  assert.ok(Math.abs((num / den) - (m.overall as number)) < 1e-9,
    'the breakdown must add up to the headline number');
  assert.equal(m.percent, Math.round((m.overall as number) * 100));
});

// ── the scenarios from the brief ────────────────────────────────────────────

test('CM16 Scenario A — a wide, high-volume standing foot ranks the wide shoe first', () => {
  const matches = ALL_FIXTURES.map((s) => matchShoe(wideStandingProfile, s, ctx()));
  const ranked = rankMatches(matches).filter((m) => !m.eliminated && m.overall !== null);
  assert.equal(ranked[0].productModelId, 'wide-comfort');
  const narrow = matches.find((m) => m.productModelId === 'narrow-performance');
  // It is eliminated here (no wide width stocked), which is a stronger outcome
  // than ranking low. An earlier version of this assertion defaulted a missing
  // score to 1 and so read elimination as a perfect match.
  assert.ok(narrow?.eliminated || (narrow!.overall as number) < (ranked[0].overall as number),
    'the narrow, firm shoe must not out-rank it');
});

test('CM17 Scenario B — a narrow low-volume foot does not get the high-volume shoe', () => {
  const narrowProfile = buildRequirementProfile(requirementsFromFitting({
    fitProfile: { category: 'running_neutral', cushioning_level: 'firm',
                  support_level: 'neutral', toe_box: 'standard', volume: 'low',
                  heel_fit: 'secure_narrow' },
    measuredWidth: 'standard',
  }));
  const wide = matchShoe(narrowProfile, WIDE_COMFORT, ctx({ requiredWidth: 'standard' }));
  const narrow = matchShoe(narrowProfile, NARROW_PERFORMANCE, ctx({ requiredWidth: 'standard' }));
  assert.ok((narrow.overall as number) > (wide.overall as number),
    'measurements decide, not how well a shoe performs for other people');
});

test('CM18 Scenario C — a reported bunion cannot force a wide recommendation', () => {
  // Measured standard forefoot, reported bunion. The measurement holds the
  // dimension; the concern is discarded for it, not blended in.
  const reqs = requirementsFromFitting({
    fitProfile: { category: 'walking_comfort', cushioning_level: 'moderate',
                  support_level: 'neutral', toe_box: 'standard', volume: 'standard',
                  heel_fit: 'standard' },
    measuredWidth: 'standard',
    reportedConcerns: ['bunion'],
  });
  // The concern DID produce a candidate requirement...
  assert.ok(reqs.some((r) => r.dimension === 'forefoot_room' && r.source === 'reported_concern'));
  // ...and lost to the higher-priority source for that dimension.
  const profile = buildRequirementProfile(reqs);
  assert.notEqual(profile.forefoot_room.source, 'reported_concern');
  assert.equal(profile.forefoot_room.value, 'standard');
});

test('CM19 Scenario D — lower-priority evidence cannot alter a measured dimension', () => {
  const measured: Requirement = { dimension: 'width_fit', value: 'true', source: 'foot_measurement' };
  const contradicting: Requirement[] = [
    { dimension: 'width_fit', value: 'runs_wide', source: 'reported_concern' },
    { dimension: 'width_fit', value: 'runs_wide', source: 'prior_fitting' },
    { dimension: 'width_fit', value: 'runs_wide', source: 'aggregate_outcome' },
  ];
  const profile = buildRequirementProfile([measured, ...contradicting]);
  assert.deepEqual(profile.width_fit, measured, 'the measurement is not reachable from below');
  // Order must not matter either.
  assert.deepEqual(buildRequirementProfile([...contradicting, measured]).width_fit, measured);
});

test('CM20 Scenario E — an eliminated shoe is persisted with its reason', () => {
  const m = matchShoe(wideStandingProfile, SMALL_SIZES_ONLY, ctx());
  assert.equal(m.eliminated, true);
  assert.ok(m.eliminationReason, 'why NOT this shoe must be answerable');
  assert.equal(m.overall, null);
  assert.equal(m.dimensions.length, 0, 'an eliminated shoe is not scored');
  assert.ok(Object.keys(m.catalogSnapshot).length > 0, 'the snapshot is still frozen');
});

// ── explainability ──────────────────────────────────────────────────────────

test('CM21 every dimension record traces to real evidence', () => {
  const m = matchShoe(wideStandingProfile, WIDE_COMFORT, ctx());
  for (const d of m.dimensions.filter((x) => x.known)) {
    assert.ok(d.requirement, `${d.dimension} scored without a requirement`);
    assert.ok(d.customerSource, `${d.dimension} scored without a customer source`);
    assert.ok(d.shoeValue, `${d.dimension} scored without a shoe value`);
    assert.ok(d.shoeSource, `${d.dimension} scored without a shoe source`);
    assert.ok(d.confidence > 0);
  }
});

test('CM22 an unknown attribute produces no positive claim', () => {
  const m = matchShoe(wideStandingProfile, UNDOCUMENTED, ctx({ requiredWidth: null }));
  for (const d of m.dimensions.filter((x) => !x.known)) {
    assert.equal(d.score, null);
    assert.ok(d.unknownReason, 'an unscored dimension must say why');
  }
  // Nothing in the considerations asserts a value we do not have.
  for (const c of m.considerations) {
    assert.ok(!/provides|offers|delivers/i.test(c), `invented a capability: ${c}`);
  }
});

test('CM23 low-confidence data is disclosed rather than silently used', () => {
  const m = matchShoe(wideStandingProfile, MARKETING_ONLY, ctx({ requiredWidth: null }));
  assert.ok(m.considerations.some((c) => /limited verified data/i.test(c)),
    'weak provenance must surface in the panel');
});

test('CM24 meaningful drawbacks appear as considerations', () => {
  const m = matchShoe(wideStandingProfile, OVERSIZED, ctx());
  assert.ok(m.considerations.length > 0, 'a recommendation must not look flawless');
});

test('CM25 the catalog snapshot is frozen, not a live reference', () => {
  const shoe = { ...WIDE_COMFORT, attributes: { ...WIDE_COMFORT.attributes } };
  const m = matchShoe(wideStandingProfile, shoe, ctx());
  const before = m.catalogSnapshot.cushioning_level;
  shoe.attributes.cushioning_level = 'firm';          // catalog edited afterwards
  assert.equal(m.catalogSnapshot.cushioning_level, before,
    'a later catalog change must not rewrite a stored explanation');
});

test('CM26 source priority is ordered as specified', () => {
  assert.ok(SOURCE_PRIORITY.pressure_measurement < SOURCE_PRIORITY.foot_measurement);
  assert.ok(SOURCE_PRIORITY.foot_measurement < SOURCE_PRIORITY.associate_observation);
  assert.ok(SOURCE_PRIORITY.associate_observation < SOURCE_PRIORITY.reported_concern);
  assert.ok(SOURCE_PRIORITY.reported_concern < SOURCE_PRIORITY.prior_fitting);
  assert.ok(SOURCE_PRIORITY.prior_fitting < SOURCE_PRIORITY.aggregate_outcome);
});

test('CM27 the nine weights are the approved set', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DIMENSIONS).map(([k, v]) => [k, v.weight])), {
    use_case: 3, cushioning: 3, support: 3, width_fit: 3, forefoot_room: 2,
    volume: 2, heel_hold: 2, orthotic_compatibility: 2, flexibility: 1,
  });
  assert.equal(asPercent(0.923), 92);
});
