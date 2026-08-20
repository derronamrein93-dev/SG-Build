/**
 * Product analytics — an explicit event allowlist and nothing else.
 *
 * docs/06 §4 settles the privacy rules: IDs, enums, durations and counts leave
 * the application boundary; names, phone numbers in any form, notes, report
 * URLs and tokens never do. This module is the chokepoint that makes that
 * enforceable rather than aspirational, in the same spirit as the consent
 * helper.
 *
 * There is no PostHog key configured and no network call here. `emit` is the
 * seam a provider plugs into later; today it records to the server log so the
 * pilot can be measured from a terminal, and so the shape of every payload is
 * visible in review before it is ever sent anywhere.
 */

export const ANALYTICS_EVENTS = [
  'fitting_started',
  'intake_completed',
  'concern_screen_shown',
  'concern_screen_completed',
  'concern_screen_skipped',
  'scan_started',
  'recommendation_viewed',
  'recommendation_overridden',
  'report_generated',
  'fitting_completed',
  'fitting_voided',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Only these keys may appear in a payload. Anything else is dropped. */
export const ALLOWED_KEYS = [
  'fitting_session_id', 'organization_id', 'location_id',
  'visit_number', 'intake_mode', 'evidence_strength', 'override_reason',
  'intake_duration_seconds', 'time_to_recommendation_ms',
  'question_count', 'answered_yes_count', 'detail_opened',
  // Counts and a flag only. `reported_concern_other` is customer speech and is
  // deliberately absent from this list, so passing it would be dropped rather
  // than sent — see concerns.test.ts CN16.
  'concern_count', 'concern_other_used',
] as const;

export type AnalyticsPayload = Partial<Record<(typeof ALLOWED_KEYS)[number], string | number | boolean | null>>;

/**
 * Strip anything not on the allowlist. Deliberately silent about what it drops
 * in the payload itself, and loud about it in the return value, so a caller
 * that accidentally passes a name finds out in a test rather than in a vendor's
 * dashboard six months later.
 */
export function sanitize(payload: Record<string, unknown>): {
  clean: AnalyticsPayload; dropped: string[];
} {
  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if ((ALLOWED_KEYS as readonly string[]).includes(k)) clean[k] = v;
    else dropped.push(k);
  }
  return { clean: clean as AnalyticsPayload, dropped };
}

export function emit(event: AnalyticsEvent, payload: Record<string, unknown> = {}): void {
  if (!(ANALYTICS_EVENTS as readonly string[]).includes(event)) return;
  const { clean } = sanitize(payload);
  // eslint-disable-next-line no-console
  console.log(`[analytics] ${event} ${JSON.stringify(clean)}`);
}
