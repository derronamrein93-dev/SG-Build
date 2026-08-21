/**
 * The customer-facing projection.
 *
 * Everything asserted here is subtractive: what does NOT reach a screen a
 * stranger is standing in front of. The additive half — that the numbers are
 * right — is the recommendation engine's own suite, and this module is not
 * allowed to have an opinion about it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectResults } from './view';

const SNAPSHOT = {
  fitProfile: {
    category: 'running_stability', support_level: 'stability', cushioning_level: 'plush',
    width: 'wide', toe_box: 'roomy', insole: 'supportive', volume: 'standard', heel_fit: 'standard',
  },
  flags: ['removable_insole_required'],
  evidence: 'moderate',
  why: 'Your left foot measured wider than your right, so we looked for a shoe with room across the forefoot.',
  toldUs: [{ label: 'Discomfort today', value: 'Yes' }, { label: 'On feet all day', value: 'Yes' }],
  candidates: [
    { productModelId: '11111111-2222-3333-4444-555555555555', brand: 'Corvid', model: 'Anchor GTS',
      score: 0.91, reasons: ['stability', 'wide sizes stocked'], misses: ['no extra wide'] },
    { productModelId: '66666666-7777-8888-9999-000000000000', brand: 'Northmoor', model: 'Camber Max',
      score: 0.84, reasons: ['max cushioning'], misses: [] },
    { productModelId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', brand: 'Alder', model: 'Ridge Mid',
      score: 0.71, reasons: ['structured heel'], misses: [] },
    { productModelId: 'ffffffff-0000-1111-2222-333333333333', brand: 'Extra', model: 'Fourth',
      score: 0.66, reasons: [], misses: [] },
  ],
  avoid: ['minimal_cushioning', 'narrow_toe_box'],
  ruleRationale: 'R14 fired: overpronation -> stability; R22 fired: wide measurement -> wide last',
  languageProvider: 'deterministic',
  languageVersion: 'lang-1.0.0',
};

test('V01 the decision comes first, in words a customer repeats to an associate', () => {
  const r = projectResults(SNAPSHOT);
  assert.equal(r.headline, 'Running Stability');
  assert.equal(r.subhead, 'Stability support · Plush cushioning');
});

test('V02 internal identifiers never reach the screen', () => {
  const serialized = JSON.stringify(projectResults(SNAPSHOT));
  assert.equal(/productModelId/.test(serialized), false);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(serialized), false);
});

test('V03 the raw rule strings stay on the record', () => {
  const serialized = JSON.stringify(projectResults(SNAPSHOT));
  assert.equal(/R14|R22|ruleRationale/.test(serialized), false);
  // The composed paragraph — which has been through the guardrail lexicon — is
  // what the customer reads.
  assert.match(projectResults(SNAPSHOT).why, /wider than your right/);
});

test('V04 three shoes, not a catalog', () => {
  const r = projectResults(SNAPSHOT);
  assert.equal(r.products.length, 3);
  assert.deepEqual(r.products[0], {
    brand: 'Corvid', model: 'Anchor GTS', reasons: ['stability', 'wide sizes stocked'],
  });
});

test('V05 support and cushioning render as pips, not as a slider', () => {
  const r = projectResults(SNAPSHOT);
  const support = r.profile.filter((row) => row.label === 'Support')[0];
  assert.equal(support.filled, 3);
  assert.equal(support.of, 4);
});

test('V06 an insole row appears only when one is recommended', () => {
  assert.ok(projectResults(SNAPSHOT).profile.some((r) => r.label === 'Insole'));
  const none = { ...SNAPSHOT, fitProfile: { ...SNAPSHOT.fitProfile, insole: 'none' } };
  assert.equal(projectResults(none).profile.some((r) => r.label === 'Insole'), false);
});

test('V07 a medical disclaimer is always present', () => {
  assert.match(projectResults(SNAPSHOT).disclaimer, /not a medical assessment or diagnosis/i);
  assert.match(projectResults({}).disclaimer, /not a medical assessment or diagnosis/i);
});

test('V08 a snapshot missing everything still renders something safe', () => {
  // A report from an older template version, or one where the language layer
  // fell back, must not throw on a device a customer is standing in front of.
  const r = projectResults({});
  assert.ok(r.headline.length > 0);
  assert.deepEqual(r.products, []);
  assert.deepEqual(r.toldUs, []);
  assert.equal(r.why, '');
  assert.equal(r.profile.length, 4);
  assert.deepEqual(projectResults(null), projectResults({}));
});

test('V09 what the customer told us is echoed, not restated as a finding', () => {
  const r = projectResults(SNAPSHOT);
  assert.deepEqual(r.toldUs, [
    { label: 'Discomfort today', value: 'Yes' },
    { label: 'On feet all day', value: 'Yes' },
  ]);
});
