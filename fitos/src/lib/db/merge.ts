/**
 * Customer identity merge — the operator primitive.
 *
 * Two records for the same person is the normal end state of a phone number
 * given twice in two different forms. This resolves them without losing fitting
 * history, consent history, reports, follow-ups, or the ability to explain what
 * happened afterwards.
 *
 * The merged-away record is never deleted. It survives as a tombstone carrying
 * its own phone hash, which is what lets a search on that number reach the
 * surviving record — see docs/05, "Customer merge".
 *
 * All four calls here run through `withService`, because the merge functions are
 * granted to `fitos_svc` only. A merge rewrites six tables; it is an operator
 * action, not something a tablet session performs.
 */
import { withService } from './client';
import { writeAudit, AUDIT_ACTIONS } from './audit';

export interface MergeRequest {
  organizationId: string;
  losingCustomerId: string;
  survivingCustomerId: string;
  actorUserId: string;
  correlationId: string;
}

/** What moved. Shape mirrors the audit manifest. */
export type MergeManifest = Record<string, string[] | undefined>;

/**
 * Record that a merge is proposed, before anything moves. Exists so a proposal
 * that is later declined still leaves a trail — "why are these two records
 * still separate" is a question someone will ask.
 */
export async function requestMerge(e: MergeRequest, counts: Record<string, number> = {}) {
  return withService((c) => writeAudit(c, {
    organizationId: e.organizationId,
    actorUserId: e.actorUserId,
    action: AUDIT_ACTIONS.MERGE_REQUESTED,
    subjectType: 'organization_customer', subjectId: e.survivingCustomerId,
    targetType: 'organization_customer', targetId: e.losingCustomerId,
    correlationId: e.correlationId,
    metadata: { would_move: counts },
  }));
}

/** Record that a proposed merge was declined. `reason` is a code, not prose. */
export async function rejectMerge(e: MergeRequest, reason: string) {
  return withService((c) => writeAudit(c, {
    organizationId: e.organizationId,
    actorUserId: e.actorUserId,
    action: AUDIT_ACTIONS.MERGE_REJECTED,
    subjectType: 'organization_customer', subjectId: e.survivingCustomerId,
    targetType: 'organization_customer', targetId: e.losingCustomerId,
    correlationId: e.correlationId,
    metadata: { reason },
  }));
}

/**
 * Perform the merge. Writes `merge_completed` with the full manifest inside the
 * same transaction as the move, so the audit cannot describe a merge that did
 * not happen or miss one that did.
 *
 * `confirmMarketingFlip` is required when the merge would make a marketing
 * consent effective where the surviving record previously had none. That state
 * did not exist before the merge, and an operator resolving duplicates is not
 * thinking about it — so it has to be said out loud rather than inferred.
 */
export async function mergeCustomer(
  e: MergeRequest, opts: { confirmMarketingFlip?: boolean } = {},
): Promise<MergeManifest> {
  return withService(async (c) => {
    const { rows } = await c.query(
      'select app_merge_customer($1,$2,$3,$4,$5) as manifest',
      [e.losingCustomerId, e.survivingCustomerId, e.actorUserId, e.correlationId,
       opts.confirmMarketingFlip ?? false]);
    return rows[0].manifest as MergeManifest;
  });
}

/**
 * Replay a merge backwards.
 *
 * Restores exactly what the manifest recorded. Rows created *after* the merge
 * stay with the survivor: at the moment they were written only one record was
 * live, so attributing them to either original would be a guess. Refused
 * outright if the survivor has itself been merged since — unwinding a chain is
 * ambiguous, and a forward correction is the honest alternative.
 */
export async function revertMerge(e: {
  losingCustomerId: string; actorUserId: string; correlationId: string;
}): Promise<MergeManifest> {
  return withService(async (c) => {
    const { rows } = await c.query(
      'select app_revert_customer_merge($1,$2,$3) as manifest',
      [e.losingCustomerId, e.actorUserId, e.correlationId]);
    return rows[0].manifest as MergeManifest;
  });
}
