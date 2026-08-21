/**
 * Persisted explanations, against the real database.
 *
 * The assertions that matter most are the null-score guards. A defaulted
 * missing value has bitten this project three times now -- most recently a
 * `?? 1` that scored an eliminated shoe as a perfect match -- so eliminated and
 * unscored candidates are checked at the row level, in the source, and by the
 * database constraint.
 *
 * Requires: bash db/reset.sh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { withTenant, withService, closePool } from '../db/client';
import { DEMO } from '../session';
import { createCustomer, startSession } from '../customers';
import { writeIntake } from '../intake/save';
import { writeAssessment, buildRecommendation, loadCandidatesForSession } from '../fitting/mutations';
import { loadCatalog } from '../catalog';

const ctx = { organizationId: DEMO.organizationId, locationId: DEMO.locationId, userId: DEMO.userId };
const uniquePhone = () => '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

async function fittingWith(assessment: Record<string, unknown>, intake: Record<string, unknown> = {}) {
  const c = await createCustomer({ firstName: 'Cand', lastName: 'Idate', phone: uniquePhone(), consent: true });
  const id = await startSession(c.id);
  await writeIntake(ctx, id, { intake_discomfort: false, intake_shoe_issue: false,
                               intake_high_activity: true, ...intake });
  await writeAssessment(ctx, id, assessment);
  await buildRecommendation(ctx, id, await loadCatalog(ctx));
  return { sessionId: id, candidates: await loadCandidatesForSession(ctx, id) };
}

test('PC01 every evaluated shoe is persisted, eliminated ones included', async () => {
  // Counted from inventory rather than hardcoded: the point is that the whole
  // local wall reaches evaluation, not that the wall is any particular size.
  const wall = await withTenant(ctx, async (c) => Number((await c.query(
    `select count(*) n from location_inventory where location_id = $1 and stocked`,
    [ctx.locationId])).rows[0].n));
  const { candidates } = await fittingWith({ size_left: 10, size_right: 10, width: 'standard', arch_type: 'low' });
  assert.ok(wall > 0, 'the fixture store must actually stock something');
  assert.equal(candidates.length, wall, 'every stocked model reaches evaluation');
  assert.ok(candidates.some((c) => !c.eliminated), 'some survive');
});

test('PC02 an eliminated candidate stores its failing constraint and a null score', async () => {
  // extra_wide is stocked by very few models here, so most are eliminated on width.
  const { candidates } = await fittingWith({ size_left: 11, size_right: 11, width: 'extra_wide' });
  const gone = candidates.filter((c) => c.eliminated);
  assert.ok(gone.length > 0, 'the fixture must actually eliminate something');
  for (const c of gone) {
    assert.equal(c.overall_score, null, 'an eliminated candidate has NO score');
    assert.equal(c.rank, null, 'and no rank');
    assert.ok(c.elimination_reason, 'and must say why');
    const failed = (c.hard_constraints as any[]).find((h) => h.applied && !h.passed);
    assert.ok(failed, 'the failing constraint is persisted, not just a message');
  }
});

test('PC03 NEGATIVE CONTROL — no source converts a null score into a valid one', () => {
  // The specific regression: `(narrow?.overall ?? 1)` read elimination as 100%.
  //
  // The first version of this control matched `overall ?? 1` literally, and so
  // sailed past `Number(candidate.overall_score) ?? 1` -- the same bug with a
  // wrapper around it. Worse, `Number(null)` is 0, not null, so wrapping a
  // nullable score in Number() defaults it even without a `??`. Both shapes are
  // scanned for now, per line, so a wrapper cannot hide either one.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(full) || /\.test\.tsx?$/.test(full)) continue;
      readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        const where = `${full}:${i + 1}: ${code}`;
        if (!/\b(overall|overall_score|score)\b/.test(line)) return;
        // A numeric fallback anywhere on a line that handles a score.
        if (/(\?\?|\|\|)\s*[0-9]/.test(line)) offenders.push(where);
        // Number(<something score-ish>) with no null test on the same line.
        if (/Number\s*\(\s*[A-Za-z_$][\w.?$]*(overall|score)[\w.?$]*\s*\)/i.test(line)
            && !/=== null|!== null|== null|!= null|\?\s|null \?/.test(line)) {
          offenders.push(`${where}   [Number(null) is 0, not null]`);
        }
      });
    }
  };
  walk('src/lib/catalog'); walk('src/lib/fitting'); walk('src/components');
  assert.deepEqual(offenders, [],
    `a missing score must never default to a number:\n  ${offenders.join('\n  ')}`);
});

test('PC03b NEGATIVE CONTROL — the database refuses a scored elimination', () => {
  // Belt to PC03's braces. Source scanning is a heuristic; this is not. Even a
  // fallback the scanner never imagined cannot land in the table.
  return withService(async (c) => {
    const s = (await c.query(
      `select recommendation_id, organization_id, product_model_id
         from recommendation_candidate limit 1`)).rows[0];
    assert.ok(s, 'needs at least one persisted candidate to build the illegal row from');
    await assert.rejects(
      c.query(
        `insert into recommendation_candidate
           (recommendation_id, organization_id, product_model_id,
            rank, overall_score, eliminated, elimination_reason, scoring_version)
         values ($1,$2,$3, null, 1.0, true, 'size', 'test')`,
        [s.recommendation_id, s.organization_id, s.product_model_id]),
      /eliminated_shape/, 'an eliminated candidate carrying a score must not be storable');
  });
});

test('PC04 the requirement snapshot records the source of each dimension', async () => {
  const { candidates } = await fittingWith({ size_left: 10, size_right: 10, width: 'wide' });
  const live = candidates.find((c) => !c.eliminated);
  const snap = live.requirement_snapshot as Record<string, { value: string; source: string }>;
  assert.ok(Object.keys(snap).length > 0);
  for (const [dim, req] of Object.entries(snap)) {
    assert.ok(req.source, `${dim} stored without a source`);
    assert.ok(req.value, `${dim} stored without a value`);
  }
  assert.equal(snap.width_fit?.source, 'foot_measurement', 'a measured width is recorded as measured');
});

test('PC05 the stored explanation survives a later catalog change', async () => {
  const { candidates, sessionId } = await fittingWith({ size_left: 10, size_right: 10, width: 'standard' });
  const before = candidates.find((c) => !c.eliminated);
  const snapBefore = { ...(before.catalog_snapshot as Record<string, unknown>) };

  // Edit the catalog underneath it. This runs as the service role because
  // product_model is deliberately not writable by fitos_app -- the tablet may
  // read the catalog, never edit it. A real catalog revision arrives the same
  // way, so this is the mutation the snapshot has to survive.
  await withService((c) => c.query(
    `update product_model set cushioning_level = 'firm', toe_box_room = 'shallow' where id = $1`,
    [before.product_model_id]));

  const after = (await loadCandidatesForSession(ctx, sessionId))
    .find((c) => c.product_model_id === before.product_model_id);
  assert.deepEqual(after.catalog_snapshot, snapBefore,
    'a stored explanation must not change when the catalog does');
  assert.equal(Number(after.overall_score), Number(before.overall_score));
});

test('PC06 the score breakdown reconciles with the stored overall', async () => {
  const { candidates } = await fittingWith({ size_left: 10, size_right: 10, width: 'standard' });
  const live = candidates.filter((c) => !c.eliminated && c.overall_score !== null);
  assert.ok(live.length > 0);
  for (const c of live) {
    const known = (c.dimensions as any[]).filter((d) => d.known && d.score !== null);
    let num = 0, den = 0;
    for (const d of known) { const w = d.weight * d.confidence; num += w * d.score; den += w; }
    assert.ok(Math.abs(num / den - Number(c.overall_score)) < 1e-9,
      `${c.product_model_id}: breakdown does not add up to the headline`);
    assert.equal(known.length, c.scored_dimension_count);
  }
});

test('PC07 a reason cannot exist without a scored dimension behind it', async () => {
  const { candidates } = await fittingWith({ size_left: 10, size_right: 10, width: 'standard' });
  for (const c of candidates.filter((x) => !x.eliminated)) {
    const strong = (c.dimensions as any[]).filter((d) => d.known && d.score >= 0.85);
    assert.ok((c.reasons as string[]).length <= strong.length,
      'more reasons than evidence to support them');
  }
});

test('PC08 size is a hard constraint at the persistence layer too', async () => {
  const { candidates } = await fittingWith({ size_left: 16, size_right: 16, width: 'standard' });
  // Nothing is stocked past 15, so every candidate must be eliminated on size.
  assert.ok(candidates.every((c) => c.eliminated), 'a size nobody stocks cannot rank');
  for (const c of candidates) {
    const failed = (c.hard_constraints as any[]).find((h) => h.applied && !h.passed);
    assert.equal(failed.constraint, 'size_available');
  }
});

test('PC09 a reported concern does not override a measured width', async () => {
  const { candidates } = await fittingWith(
    { size_left: 10, size_right: 10, width: 'standard' },
    { intake_discomfort: true, reported_concerns: ['bunion'] });
  const live = candidates.find((c) => !c.eliminated);
  const snap = live.requirement_snapshot as Record<string, { value: string; source: string }>;
  assert.equal(snap.width_fit?.source, 'foot_measurement');
  assert.notEqual(snap.forefoot_room?.source, 'reported_concern',
    'the measurement-derived requirement holds the dimension');
});

test('PC10 demonstration catalog data is self-identifying', async () => {
  const rows = await withTenant(ctx, async (c) => (await c.query(
    `select count(*) n from shoe_attribute_evidence where source_type = 'synthetic_fixture'`)).rows[0]);
  assert.ok(Number(rows.n) > 0, 'the demo catalog carries synthetic provenance');
  // Nothing claims to be a manufacturer spec, because nothing here is one.
  const specs = await withTenant(ctx, async (c) => (await c.query(
    `select count(*) n from shoe_attribute_evidence
      where source_type in ('manufacturer_technical_spec','independent_measurement')`)).rows[0]);
  assert.equal(Number(specs.n), 0, 'no seeded row may pose as a verified specification');
});

test('PC11 the tablet role cannot edit the catalog it reads', async () => {
  // Found while writing PC05: the catalog edit had to run as fitos_svc, because
  // fitos_app has no UPDATE on product_model. That is the intended shape -- a
  // fitting session reads specifications, it never revises them -- but nothing
  // asserted it, so a future grant could widen it silently.
  const id = await withTenant(ctx, async (c) =>
    (await c.query('select id from product_model limit 1')).rows[0].id);
  await assert.rejects(
    () => withTenant(ctx, (c) =>
      c.query(`update product_model set cushioning_level = 'firm' where id = $1`, [id])),
    /permission denied/i, 'fitos_app must not be able to write the catalog');
  await assert.rejects(
    () => withTenant(ctx, (c) =>
      c.query(`update shoe_attribute_evidence set confidence = 1.0 where id is not null`)),
    /permission denied/i, 'nor rewrite the evidence its explanations cite');
});

test('NC03 NEGATIVE CONTROL — the Why? panel cannot recompute a recommendation', () => {
  // The panel renders a stored row. If it ever imported the engine it could
  // silently start explaining today's catalog instead of that day's fitting,
  // and PC05 would keep passing because the stored row would still be intact.
  const src = readFileSync(join(__dirname, '../../components/WhyPanel.tsx'), 'utf8');
  const imports = [...src.matchAll(/^import[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  // One allowance: the label vocabulary, which is a data-only leaf module with
  // no imports of its own. Sharing it beats a second copy that drifts.
  const ALLOWED = ['react', '../lib/catalog/labels'];
  for (const spec of imports) {
    if (ALLOWED.includes(spec)) continue;
    assert.ok(!/catalog|rules|scoring|match|requirements|constraints|db\/|actions/.test(spec),
      `WhyPanel imports ${spec}; it must read the persisted row and nothing else`);
  }
  // And that allowance is only safe while the leaf stays a leaf.
  const labels = readFileSync(join(__dirname, 'labels.ts'), 'utf8');
  assert.ok(!/^import\s/m.test(labels), 'labels.ts must import nothing at all');
  for (const fn of ['matchShoe', 'rankMatches', 'overallScore', 'scoreDimension',
                    'evaluateConstraints', 'buildRequirementProfile', 'buildConsiderations']) {
    assert.ok(!src.includes(fn), `WhyPanel calls ${fn}: that is recomputation, not explanation`);
  }
  // Nor may it reach the network for one.
  assert.ok(!/fetch\(|useEffect/.test(src), 'the panel is a pure render of what it was handed');
});

test.after(async () => { await closePool(); });
