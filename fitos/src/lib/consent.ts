/**
 * Consent — the one intended path for asking whether consent holds.
 *
 * Nothing in FitOS reads consent today; it is only captured. This module exists
 * *before* the first reader so that the first reader does not invent its own
 * rules, because consent logic hand-rolled at three call sites is three places
 * to be subtly wrong about revocation.
 *
 * **Do not query `consent_record` directly.** See docs/05, "Consent checks".
 *
 * How the model works, and why the query looks the way it does:
 *
 * - There is no `revoked_at` and no UPDATE grant. Withdrawal is a *new row* with
 *   `granted = false`. So "does consent hold" is always "what does the most
 *   recent row say", never "is there a row".
 * - `captured_at` defaults to `now()`, which is transaction start time. Two rows
 *   written in one transaction therefore tie. The ordering breaks that tie with
 *   `granted asc`, so a withdrawal beats a grant at the same instant — the
 *   fail-closed direction.
 * - Tenant scoping is not re-implemented here. Every query runs inside
 *   `withTenant`, so RLS has already applied, including the person-scope rules
 *   from migration 0005.
 */
import { PoolClient } from 'pg';

/** The consent vocabulary, exactly as the `consent_type` enum defines it. */
export const CONSENT_TYPES = [
  'fit_history_storage',
  'receive_report',
  'privacy_ack',
  'marketing_email',
  'marketing_sms',
  'identity_resolution',
  'portable_profile_share',
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

/**
 * Who the consent is about.
 *
 * `person` requires a `locationId` structurally, not by convention: a
 * person-scoped row with no location must never satisfy a check, and the
 * cleanest way to guarantee that is to make it impossible to ask without one.
 */
export type ConsentSubject =
  | { kind: 'customer'; customerId: string }
  | { kind: 'person'; personIdentityId: string; locationId: string };

/**
 * Does consent currently hold for this purpose?
 *
 * Fails closed in every uncertain case: no row, a withdrawal, a row belonging to
 * another tenant (invisible under RLS), a person-scoped row captured at a
 * different location, or a person-scoped row with no location at all.
 *
 * Must be called inside `withTenant` — passing a `withService` client would
 * bypass the policies this function relies on for tenant scoping.
 */
export async function hasConsent(
  c: PoolClient,
  subject: ConsentSubject,
  type: ConsentType,
): Promise<boolean> {
  if (!CONSENT_TYPES.includes(type)) return false;

  if (subject.kind === 'customer') {
    if (!subject.customerId) return false;
    const { rows } = await c.query(
      `select granted from consent_record
        where organization_customer_id = $1
          and type = $2
        order by captured_at desc, granted asc
        limit 1`,
      [subject.customerId, type]);
    return rows[0]?.granted === true;
  }

  if (!subject.personIdentityId || !subject.locationId) return false;
  // Person-scoped consent is matched to the location that captured it, not
  // merely to the organization. RLS (0005) already limits visibility to the
  // capturing organization; this narrows it one step further, because extending
  // a person's consent across every door in a chain is an authorization
  // decision nobody has made yet. When someone makes it, it belongs here.
  const { rows } = await c.query(
    `select granted from consent_record
      where person_identity_id = $1
        and location_id = $2
        and organization_customer_id is null
        and type = $3
      order by captured_at desc, granted asc
      limit 1`,
    [subject.personIdentityId, subject.locationId, type]);
  return rows[0]?.granted === true;
}

/**
 * Convenience for the common case, so callers do not build the subject object
 * for a plain retailer-scoped question.
 */
export function customerConsent(c: PoolClient, customerId: string, type: ConsentType) {
  return hasConsent(c, { kind: 'customer', customerId }, type);
}

/**
 * Expiration is NOT evaluated, because `consent_record` has no expiry column.
 *
 * Stated here rather than left implicit: if consent is ever given a lifetime,
 * it needs a schema change plus a predicate in the two queries above, and every
 * caller of `hasConsent` inherits it for free — which is the point of having one
 * chokepoint. Until then, consent holds until it is withdrawn.
 */
export const CONSENT_EXPIRY_SUPPORTED = false;
