/**
 * The intake write and its column allowlist.
 *
 * Split out of actions.ts, which is `server-only` and therefore unimportable
 * under node:test — the same reason ./reports and ./customers are separate.
 * What matters here is the allowlist: it is the list a test can assert has not
 * quietly shed a field, which is the whole preservation claim of the quick
 * intake redesign.
 */
import { withTenant, type TenantContext } from '../db/client';

/** Quick-intake answers plus every pre-existing detailed field. */
export const INTAKE_COLUMNS = [
  // the three-question default, and the two returning-customer variants
  'intake_discomfort', 'intake_shoe_issue', 'intake_high_activity',
  'intake_new_discomfort_since_last', 'intake_use_changed_since_last',
  // bookkeeping for the redesign's own metric
  'intake_mode', 'intake_duration_seconds',
  // preserved, hidden from the default UI, still written by Add detail
  'shopping_purpose', 'current_shoe_problem', 'discomfort_area', 'discomfort_timing',
  'activity_level', 'standing_hours_per_day', 'current_shoe_brand', 'current_shoe_model',
  'current_shoe_age', 'fit_priority', 'previous_return_reason', 'uses_orthotics',
  'shoe_wear_concern', 'intake_notes',
] as const;

export async function writeIntake(
  ctx: TenantContext, sessionId: string, patch: Record<string, unknown>,
) {
  const keys = Object.keys(patch).filter((k) => (INTAKE_COLUMNS as readonly string[]).includes(k));
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
