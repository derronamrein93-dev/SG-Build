/**
 * The default retail intake: three yes/no questions, two for a returning
 * customer, and then measurement.
 *
 * "Ask less. Measure more." Pilot feedback was that the old intake read as
 * paperwork — eight chip groups, several of them multi-select, before anyone
 * touched a foot. The richer fields still exist and are still written by the
 * optional Add detail panel; the default flow simply stops asking for them.
 *
 * The questions live here as data rather than as JSX so that "exactly three,
 * all binary, none free text" is something a test can assert rather than
 * something a reviewer has to eyeball.
 */

export type IntakeAnswer = boolean | null;

export interface IntakeQuestion {
  /** The fitting_session column this answer lands in. */
  field: string;
  /** Consumer language. No clinical vocabulary — this is a shoe shop. */
  prompt: string;
  /** Every question is yes/no. There is no other kind. */
  kind: 'yes_no';
  /** Whether a Yes offers the optional Add detail panel. */
  offersDetail: boolean;
  /** Which of the pre-existing detailed fields Add detail exposes on a Yes. */
  detailFields: string[];
}

/** New customer — three questions, in this order. */
export const NEW_CUSTOMER_QUESTIONS: readonly IntakeQuestion[] = [
  {
    field: 'intake_discomfort',
    prompt: 'Are you experiencing any foot discomfort today?',
    kind: 'yes_no',
    offersDetail: true,
    detailFields: ['discomfort_area', 'discomfort_timing'],
  },
  {
    field: 'intake_shoe_issue',
    prompt: 'Do your current shoes feel uncomfortable, tight, loose, or create pressure anywhere?',
    kind: 'yes_no',
    offersDetail: true,
    detailFields: ['current_shoe_problem', 'shoe_wear_concern'],
  },
  {
    field: 'intake_high_activity',
    prompt: 'Are you regularly on your feet for long periods, running, or doing high-impact activity?',
    kind: 'yes_no',
    offersDetail: false,
    detailFields: [],
  },
] as const;

/** Returning customer — two questions. Never re-ask what FitOS already knows. */
export const RETURNING_CUSTOMER_QUESTIONS: readonly IntakeQuestion[] = [
  {
    field: 'intake_new_discomfort_since_last',
    prompt: 'Any new pain or discomfort since your last visit?',
    kind: 'yes_no',
    offersDetail: true,
    detailFields: ['discomfort_area', 'discomfort_timing'],
  },
  {
    field: 'intake_use_changed_since_last',
    prompt: 'Has your activity level or primary use changed since your last visit?',
    kind: 'yes_no',
    offersDetail: true,
    detailFields: ['shopping_purpose', 'activity_level', 'standing_hours_per_day'],
  },
] as const;

export function questionsFor(visitNumber: number): readonly IntakeQuestion[] {
  return visitNumber > 1 ? RETURNING_CUSTOMER_QUESTIONS : NEW_CUSTOMER_QUESTIONS;
}

/** Every column the quick intake may write. Used by the server action allowlist. */
export const QUICK_INTAKE_FIELDS = [
  ...NEW_CUSTOMER_QUESTIONS.map((q) => q.field),
  ...RETURNING_CUSTOMER_QUESTIONS.map((q) => q.field),
] as const;

/**
 * The detailed fields Add detail can expose. Every one of these predates the
 * quick intake and is still read by the engine and the report — this list is
 * what "preserved but hidden" means concretely.
 */
export const DETAIL_FIELDS = [
  'shopping_purpose', 'discomfort_area', 'discomfort_timing', 'activity_level',
  'standing_hours_per_day', 'current_shoe_problem', 'shoe_wear_concern',
  'fit_priority', 'uses_orthotics', 'intake_notes',
] as const;
