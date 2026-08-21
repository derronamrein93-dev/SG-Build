/**
 * Every write in the fitting flow, as plain functions taking an explicit tenant
 * context.
 *
 * Split out of actions.ts — which is `use server` and unimportable under
 * node:test — for one specific reason: until now no test had ever executed a
 * mutation as `fitos_app`. Every fixture in the suite creates data through
 * `withService`, which has BYPASSRLS, so 141 tests could pass while customer
 * creation was broken under the policy the tablet actually runs. See
 * mutations.test.ts.
 *
 * actions.ts is now a thin shim: the boundary stays a server action, the logic
 * lives here where it can be driven directly.
 */
import { randomBytes, createHash } from 'crypto';
import { withTenant, type TenantContext } from '../db/client';
import { recommend, toObservedFeatures, type Recommendation } from '../rules/engine';
import { composeWhy } from '../report/language';
import { buildToldUs } from '../report/toldUs';
import type { CatalogItem } from '../rules/engine';
import { loadCatalogForMatching, persistCandidates } from '../catalog/persist';
import { buildRequirementProfile, requirementsFromFitting } from '../catalog/requirements';
import { matchShoe, rankMatches } from '../catalog/match';

export const ASSESSMENT_COLUMNS = [
  'size_left', 'size_right', 'width', 'width_asymmetry', 'arch_type', 'foot_shape',
  'pronation_tendency', 'heel_slip_risk', 'toe_box_issue', 'wear_pattern', 'balance_concern',
  'pressure_concern', 'assoc_support_level', 'assoc_cushioning_level', 'assoc_category',
  'assoc_insole', 'assessment_notes',
] as const;

export async function writeAssessment(
  ctx: TenantContext, sessionId: string, patch: Record<string, unknown>,
) {
  const keys = Object.keys(patch).filter((k) => (ASSESSMENT_COLUMNS as readonly string[]).includes(k));
  if (!keys.length) return;
  await withTenant(ctx, async (c) => {
    const cols = ['fitting_session_id', ...keys];
    const vals = [sessionId, ...keys.map((k) => patch[k])];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const updates = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await c.query(
      `insert into assessment (${cols.join(',')}) values (${placeholders})
       on conflict (fitting_session_id) do update set ${updates}`, vals);
  });
}

/**
 * Compute and persist a recommendation. Deterministic, local, and stamped with
 * all five versions so this exact output can be reproduced years from now.
 */
export async function buildRecommendation(
  ctx: TenantContext, sessionId: string, catalog: CatalogItem[],
): Promise<Recommendation> {
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select s.*, a.* from fitting_session s
         left join assessment a on a.fitting_session_id = s.id
        where s.id = $1`, [sessionId]);
    if (!rows.length) throw new Error('session not found');
    const row = rows[0];

    const features = toObservedFeatures(row, row);
    const rec = recommend(features, catalog, { assessmentSchemaVersion: row.assessment_schema_version });

    // Canonical features, one row each, with provenance as first-class columns.
    await c.query('delete from fitting_feature where fitting_session_id = $1', [sessionId]);
    for (const f of Object.values(features)) {
      const numeric = typeof f.value === 'number';
      await c.query(
        `insert into fitting_feature
          (fitting_session_id,feature_key,value_categorical,value_numeric,source_type,quality,captured_at)
         values ($1,$2,$3,$4,$5,$6,now())`,
        [sessionId, f.key, numeric ? null : JSON.stringify(f.value).replace(/^"|"$/g, ''),
         numeric ? f.value : null, f.source, f.quality ?? null]);
    }

    const { rows: recRows } = await c.query(
      `insert into recommendation
        (fitting_session_id,fit_profile,flags,evidence_strength,evidence_detail,
         recommendation_engine_version,rule_set_version,catalog_version,feature_schema_version,
         assessment_schema_version,fired_rule_ids,feature_snapshot,talking_points,rationale,
         products_considered,products_avoided)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning id`,
      [sessionId, rec.fitProfile, rec.flags, rec.evidenceStrength, rec.evidenceDetail,
       rec.versions.recommendation_engine_version, rec.versions.rule_set_version,
       rec.versions.catalog_version, rec.versions.feature_schema_version,
       rec.versions.assessment_schema_version, rec.firedRuleIds, rec.featureSnapshot,
       rec.talkingPoints, rec.rationale, rec.candidates.map((x) => x.productModelId), rec.avoid]);

    // ── catalog matching, persisted ────────────────────────────────────────
    // Every shoe that reaches evaluation is stored, eliminated ones included,
    // with enough frozen context to explain the decision after the catalog
    // changes. RLS on location_inventory is what keeps this to the local store.
    const shoes = await loadCatalogForMatching(c, ctx.locationId);
    const requirementProfile = buildRequirementProfile(requirementsFromFitting({
      fitProfile: rec.fitProfile as unknown as Record<string, string>,
      measuredWidth: row.width ?? null,
      reportedConcerns: row.reported_concerns ?? [],
      orthoticRequired: rec.flags.includes('removable_insole_required'),
    }));
    const sizes = [Number(row.size_left), Number(row.size_right)].filter(Number.isFinite);
    const constraintCtx = {
      requiredSize: sizes.length ? Math.max(...sizes) : null,
      sizeAsymmetry: sizes.length === 2 ? Math.abs(sizes[0] - sizes[1]) : null,
      requiredWidth: row.width ?? null,
      // Width was measured by the associate on this foot, so the customer side
      // is trustworthy; the shoe side is checked per shoe inside the evaluator.
      widthConfidence: row.width ? 0.9 : null,
      safetyToeRequired: rec.fitProfile.category === 'work_safety',
      orthoticAccommodationRequired: rec.flags.includes('removable_insole_required'),
      excludedCategories: [] as string[],
    };
    const matched = rankMatches(
      shoes.map((shoe) => matchShoe(requirementProfile, shoe, constraintCtx)));
    await persistCandidates(c, {
      recommendationId: recRows[0].id,
      organizationId: ctx.organizationId,
      requirementProfile,
      candidates: matched,
    });

    return rec;
  });
}

export async function finishFitting(
  ctx: TenantContext, sessionId: string, catalog: CatalogItem[],
  overrides?: Record<string, string>,
): Promise<{ token: string }> {
  const rec = await buildRecommendation(ctx, sessionId, catalog);
  // Compose once, at completion, and freeze it onto the report record — never
  // on the critical path of the fitting, and never regenerated on each view.
  const language = composeWhy(rec, rec.featureSnapshot);
  // A report is a record; the page is a rendering of it. The token is stored
  // hashed so a database read cannot mint a working link.
  const token = randomBytes(24).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest();

  await withTenant(ctx, async (c) => {
    if (overrides && Object.keys(overrides).length) {
      await c.query(
        `update recommendation set overridden = true, override_fields = $2, override_reason = 'associate_judgment'
          where fitting_session_id = $1
            and created_at = (select max(created_at) from recommendation where fitting_session_id = $1)`,
        [sessionId, overrides]);
    }
    const started = await c.query('select * from fitting_session where id = $1', [sessionId]);
    const toldUs = buildToldUs(started.rows[0]);
    await c.query(
      `update fitting_session
          set status = 'completed', completed_at = now(),
              time_to_recommendation_ms = extract(epoch from (now() - started_at)) * 1000
        where id = $1`, [sessionId]);
    await c.query(
      `insert into report (fitting_session_id,organization_customer_id,report_version,access_token_hash,expires_at,content_snapshot)
       values ($1,$2,1,$3, now() + interval '90 days', $4)`,
      [sessionId, started.rows[0].organization_customer_id, tokenHash,
       { fitProfile: rec.fitProfile, flags: rec.flags, evidence: rec.evidenceStrength,
         candidates: rec.candidates, avoid: rec.avoid,
         toldUs,
         why: language.paragraph,
         languageProvider: language.provider,
         languageVersion: language.version,
         // the raw rule strings stay on the record for audit; the customer
         // never sees them
         ruleRationale: rec.rationale }]);
  });
  return { token };
}

export async function writeFeedback(
  ctx: TenantContext, type: string, screen: string, note: string, sessionId?: string,
) {
  await withTenant(ctx, async (c) => {
    await c.query(
      `insert into pilot_feedback (organization_id,location_id,user_id,fitting_session_id,type,screen,note)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.organizationId, ctx.locationId, ctx.userId, sessionId ?? null, type, screen, note]);
  });
}

/** The persisted explanation for the latest recommendation on a session. */
export async function loadCandidatesForSession(ctx: TenantContext, sessionId: string) {
  return withTenant(ctx, async (c) => {
    const { rows: rec } = await c.query(
      `select id from recommendation where fitting_session_id = $1
        order by created_at desc limit 1`, [sessionId]);
    if (!rec.length) return [];
    const { rows } = await c.query(
      `select rc.*, m.brand, m.model
         from recommendation_candidate rc
         join product_model m on m.id = rc.product_model_id
        where rc.recommendation_id = $1
        order by rc.eliminated, rc.rank nulls last`, [rec[0].id]);
    return rows;
  });
}
