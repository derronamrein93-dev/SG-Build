/**
 * Audit writing — the only intended application path into `audit_log`.
 *
 * The table is append-only by privilege (no UPDATE or DELETE grant) and
 * tenant-scoped by policy. This module adds the third layer: it refuses to
 * write metadata that looks like PII before the row ever reaches Postgres, so
 * the failure surfaces at the call site with a usable message rather than as a
 * constraint violation three frames down.
 *
 * CLAUDE.md: "Log identifiers, not people."
 */
import { PoolClient } from 'pg';

/**
 * Event vocabulary. The database constrains the *shape* of `action`
 * (namespace.event) but not the vocabulary, because a whitelist in SQL means a
 * migration for every new event. This object is the authoritative list.
 *
 * The merge names exist ahead of the merge implementation on purpose: the
 * audit contract is what makes a merge reversible, so it is settled first.
 */
export const AUDIT_ACTIONS = {
  MERGE_REQUESTED: 'customer_identity.merge_requested',
  MERGE_COMPLETED: 'customer_identity.merge_completed',
  MERGE_REJECTED:  'customer_identity.merge_rejected',
  MERGE_REVERTED:  'customer_identity.merge_reverted',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
export type ActorType = 'user' | 'service' | 'system';

export interface AuditEntry {
  organizationId: string;
  locationId?: string | null;
  actorUserId?: string | null;
  actorType?: ActorType;
  action: AuditAction | string;
  subjectType: string;
  subjectId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Key names that must never appear in audit metadata, at any depth. Mirrors
 * `audit_metadata_has_banned_key()` in migration 0006 — deliberately duplicated
 * rather than derived, because the constraint has to hold even if this module
 * is bypassed, and this module has to fail clearly even if the constraint is
 * later relaxed.
 */
const BANNED_KEY = /(phone|mobile|email|name|address|street|city|postal|zip|token|secret|password|passwd|pepper|ssn|dob|birth)/i;

/** Values that are PII on their face, whatever the key is called. */
const EMAILISH = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONEISH = /^\+?[0-9][0-9\s().-]{8,}$/;

const ACTION_FORMAT = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const TYPE_FORMAT = /^[a-z][a-z0-9_]*$/;

function inspectMetadata(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => inspectMetadata(v, `${path}[${i}]`, problems));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (BANNED_KEY.test(key)) {
        problems.push(`key "${here}" looks like PII — log an identifier instead`);
      }
      inspectMetadata(v, here, problems);
    }
    return;
  }
  if (typeof value === 'string') {
    if (EMAILISH.test(value)) problems.push(`value at "${path}" is an email address`);
    else if (PHONEISH.test(value)) problems.push(`value at "${path}" looks like a phone number`);
  }
}

/**
 * Validate an entry without writing it. Exported so tests and future call sites
 * can check an entry before committing to a transaction.
 * Returns the list of problems; empty means valid.
 */
export function validateAuditEntry(entry: AuditEntry): string[] {
  const problems: string[] = [];

  if (!entry.organizationId) problems.push('organizationId is required');
  if (!entry.action) problems.push('action is required');
  else if (!ACTION_FORMAT.test(entry.action)) {
    problems.push(`action "${entry.action}" must be namespace.event, lower_snake_case`);
  }
  if (!entry.subjectType) problems.push('subjectType is required');
  else if (!TYPE_FORMAT.test(entry.subjectType)) {
    problems.push(`subjectType "${entry.subjectType}" must be lower_snake_case`);
  }
  if (entry.targetType && !TYPE_FORMAT.test(entry.targetType)) {
    problems.push(`targetType "${entry.targetType}" must be lower_snake_case`);
  }
  if (entry.metadata !== undefined) {
    if (entry.metadata === null || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata)) {
      problems.push('metadata must be a plain object');
    } else {
      inspectMetadata(entry.metadata, '', problems);
    }
  }
  return problems;
}

/**
 * Write one audit row inside the caller's transaction, so the audit commits or
 * rolls back with the thing it describes. Never opens its own connection.
 *
 * `organizationId` must match the tenant context of the surrounding
 * `withTenant` call: the insert policy checks it, and passing it explicitly
 * means the mismatch is visible at the call site rather than implied.
 */
export async function writeAudit(c: PoolClient, entry: AuditEntry): Promise<string> {
  const problems = validateAuditEntry(entry);
  if (problems.length) {
    throw new Error(`Refusing to write audit event "${entry.action}": ${problems.join('; ')}`);
  }
  const { rows } = await c.query(
    `insert into audit_log
       (organization_id, location_id, actor_user_id, actor_type, action,
        subject_type, subject_id, target_type, target_id,
        correlation_id, request_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [entry.organizationId, entry.locationId ?? null, entry.actorUserId ?? null,
     entry.actorType ?? 'user', entry.action,
     entry.subjectType, entry.subjectId ?? null,
     entry.targetType ?? null, entry.targetId ?? null,
     entry.correlationId ?? null, entry.requestId ?? null,
     JSON.stringify(entry.metadata ?? {})]);
  return rows[0].id as string;
}

/**
 * Merge events, ahead of the merge itself.
 *
 * A merge is only reversible if the trail says which record survived, which was
 * merged away, and which operation they belonged to — so `correlationId` ties
 * request → completed/rejected → reverted into one story. `survivingCustomerId`
 * is the subject because it is the record that still exists; the merged-away id
 * is the target.
 */
export async function writeMergeAudit(c: PoolClient, e: {
  organizationId: string;
  action: AuditAction;
  survivingCustomerId: string;
  mergedCustomerId: string;
  correlationId: string;
  actorUserId?: string | null;
  locationId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  return writeAudit(c, {
    organizationId: e.organizationId,
    locationId: e.locationId ?? null,
    actorUserId: e.actorUserId ?? null,
    actorType: 'user',
    action: e.action,
    subjectType: 'organization_customer',
    subjectId: e.survivingCustomerId,
    targetType: 'organization_customer',
    targetId: e.mergedCustomerId,
    correlationId: e.correlationId,
    metadata: e.metadata ?? {},
  });
}
