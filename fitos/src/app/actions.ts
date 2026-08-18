'use server';

import { randomBytes, createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { withTenant } from '../lib/db/client';
import { currentContext } from '../lib/session';
import { recommend, toObservedFeatures } from '../lib/rules/engine';
import { loadCatalog } from '../lib/queries';

/** Debounced autosave target. Every field write lands here; there is no Save button. */
export async function saveIntake(sessionId: string, patch: Record<string, unknown>) {
  const ctx = currentContext();
  const allowed = ['shopping_purpose', 'current_shoe_problem', 'discomfort_area', 'discomfort_timing',
    'activity_level', 'standing_hours_per_day', 'current_shoe_brand', 'current_shoe_model',
    'current_shoe_age', 'fit_priority', 'previous_return_reason', 'uses_orthotics',
    'shoe_wear_concern', 'intake_notes'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  await withTenant(ctx, async (c) => {
    await c.query(
      `update fitting_session
          set ${sets}, draft_saved_at = now(), draft_synced_at = now(),
              status = case when status = 'draft' then 'in_progress' else status end
        where id = $1 and organization_id = $2`,
      [sessionId, ctx.organizationId, ...keys.map((k) => patch[k])]);
  });
}

export async function saveAssessment(sessionId: string, patch: Record<string, unknown>) {
  const ctx = currentContext();
  const allowed = ['size_left', 'size_right', 'width', 'width_asymmetry', 'arch_type', 'foot_shape',
    'pronation_tendency', 'heel_slip_risk', 'toe_box_issue', 'wear_pattern', 'balance_concern',
    'pressure_concern', 'assoc_support_level', 'assoc_cushioning_level', 'assoc_category',
    'assoc_insole', 'assessment_notes'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
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
export async function computeRecommendation(sessionId: string) {
  const ctx = currentContext();
  const catalog = await loadCatalog();
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

    await c.query(
      `insert into recommendation
        (fitting_session_id,fit_profile,flags,evidence_strength,evidence_detail,
         recommendation_engine_version,rule_set_version,catalog_version,feature_schema_version,
         assessment_schema_version,fired_rule_ids,feature_snapshot,talking_points,rationale,
         products_considered,products_avoided)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [sessionId, rec.fitProfile, rec.flags, rec.evidenceStrength, rec.evidenceDetail,
       rec.versions.recommendation_engine_version, rec.versions.rule_set_version,
       rec.versions.catalog_version, rec.versions.feature_schema_version,
       rec.versions.assessment_schema_version, rec.firedRuleIds, rec.featureSnapshot,
       rec.talkingPoints, rec.rationale, rec.candidates.map((x) => x.productModelId), rec.avoid]);

    return rec;
  });
}

export async function completeFitting(sessionId: string, overrides?: Record<string, string>) {
  const ctx = currentContext();
  const rec = await computeRecommendation(sessionId);
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
    const started = await c.query('select started_at, organization_customer_id from fitting_session where id = $1', [sessionId]);
    await c.query(
      `update fitting_session
          set status = 'completed', completed_at = now(),
              time_to_recommendation_ms = extract(epoch from (now() - started_at)) * 1000
        where id = $1`, [sessionId]);
    await c.query(
      `insert into report (fitting_session_id,organization_customer_id,report_version,access_token_hash,expires_at,content_snapshot)
       values ($1,$2,1,$3, now() + interval '90 days', $4)`,
      [sessionId, started.rows[0].organization_customer_id, tokenHash,
       { fitProfile: rec.fitProfile, rationale: rec.rationale, flags: rec.flags,
         evidence: rec.evidenceStrength, candidates: rec.candidates, avoid: rec.avoid }]);
  });
  revalidatePath('/');
  return { token };
}

export async function logFeedback(type: string, screen: string, note: string, sessionId?: string) {
  const ctx = currentContext();
  await withTenant(ctx, async (c) => {
    await c.query(
      `insert into pilot_feedback (organization_id,location_id,user_id,fitting_session_id,type,screen,note)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.organizationId, ctx.locationId, ctx.userId, sessionId ?? null, type, screen, note]);
  });
}
