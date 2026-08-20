/**
 * Customer-reported concerns.
 *
 * The pilot asked for "a place for people to key in specifics, like plantar
 * fasciitis, or neuroma" without going back to a long intake. This is that: an
 * optional screen, offered only when the customer has already said something
 * hurts, skippable in one tap.
 *
 * -- The line this module exists to hold --------------------------------------
 *
 * A concern is a QUOTE. "Customer reported: plantar fasciitis" is a record of
 * something a person said. It is never a finding, an observation, or a
 * diagnosis, and FitOS never says it on its own account.
 *
 * That distinction has teeth here, because `plantar fasciitis` and `neuroma`
 * are both in BANNED_TERMS -- generated prose may not contain them, and that
 * stays true. The report renders concerns as a labelled echo of the customer's
 * own words; the composed paragraph still cannot mention a condition, and
 * concerns.test.ts asserts it.
 *
 * So: concerns influence what the associate is prompted to LOOK AT, they appear
 * on the report as a quote, and a few of them nudge fit attributes
 * conservatively -- roomier toe box for a reported bunion is shoe fitting, not
 * medicine. `plantar_fasciitis` deliberately nudges nothing: it is a diagnosis
 * label, and the heel or arch pain that comes with it carries the fit signal
 * honestly. No concern produces treatment advice, severity, or clinical
 * inference.
 */

export const CONCERN_VALUES = [
  'plantar_fasciitis', 'neuroma', 'bunion', 'heel_pain', 'arch_pain',
  'forefoot_pain', 'toe_pressure', 'ankle_pain', 'knee_pain',
  'diabetes_neuropathy', 'orthotics_inserts', 'other',
] as const;

export type ConcernValue = (typeof CONCERN_VALUES)[number];

/** Consumer language, in the order the chips appear. */
export const CONCERN_LABELS: Record<ConcernValue, string> = {
  plantar_fasciitis:   'Plantar fasciitis',
  neuroma:             'Neuroma',
  bunion:              'Bunions',
  heel_pain:           'Heel pain',
  arch_pain:           'Arch pain',
  forefoot_pain:       'Forefoot pain',
  toe_pressure:        'Toe pressure',
  ankle_pain:          'Ankle pain',
  knee_pain:           'Knee pain',
  diabetes_neuropathy: 'Diabetes / neuropathy',
  orthotics_inserts:   'Uses orthotics / inserts',
  other:               'Other',
};

export const CONCERN_OTHER_MAX = 200;

/**
 * Show the screen only when the customer has already said something is wrong.
 * A customer with no discomfort and no shoe complaint is asked nothing extra --
 * that is what keeps the default path three taps long.
 */
export function shouldOfferConcerns(intake: Record<string, unknown>): boolean {
  return intake.intake_discomfort === true
      || intake.intake_shoe_issue === true
      || intake.intake_new_discomfort_since_last === true;
}

export function isConcernValue(v: unknown): v is ConcernValue {
  return typeof v === 'string' && (CONCERN_VALUES as readonly string[]).includes(v);
}

/** Drop anything unknown and de-duplicate, preserving the canonical order. */
export function normalizeConcerns(input: unknown): ConcernValue[] {
  if (!Array.isArray(input)) return [];
  const chosen = new Set(input.filter(isConcernValue));
  return CONCERN_VALUES.filter((v) => chosen.has(v));
}

/**
 * Free text is stored as the customer's words, trimmed and bounded. Control
 * characters go, because they corrupt a printed report and serve no one; the
 * wording itself is left exactly as typed. Returns null when there is nothing
 * to keep, so the column stays null rather than holding an empty string.
 */
export function sanitizeConcernOther(input: unknown, concerns: ConcernValue[]): string | null {
  if (!concerns.includes('other')) return null;          // matches the DB constraint
  if (typeof input !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, CONCERN_OTHER_MAX) : null;
}

/**
 * What the associate should look at, given what the customer said.
 *
 * Procedural, never clinical. Each prompt names the concern as a quote and then
 * says what to inspect -- "check the toe box" is a fitting instruction, "this
 * is a bunion" would be a claim. Nothing here suggests a treatment, a severity,
 * or a cause.
 *
 * Deliberately NOT part of the engine's talkingPoints, which are authored rule
 * strings that flow into generated language. These are UI prompts for the
 * person doing the fitting.
 */
const INSPECTION: Partial<Record<ConcernValue, string>> = {
  plantar_fasciitis:   'Check heel cushioning and arch contact.',
  neuroma:             'Check forefoot pressure and toe-box room.',
  bunion:              'Check toe-box width at the first joint.',
  heel_pain:           'Check heel cushioning and heel-cup fit.',
  arch_pain:           'Check arch contact through the midfoot.',
  forefoot_pain:       'Check forefoot cushioning and toe-box room.',
  toe_pressure:        'Check toe-box height and length.',
  ankle_pain:          'Check collar height and heel stability.',
  knee_pain:           'Check overall support and cushioning.',
  diabetes_neuropathy: 'Check for seams and pressure points; fit carefully.',
  orthotics_inserts:   'Confirm the insole is removable and the volume fits.',
};

export interface InspectionPrompt { concern: ConcernValue; label: string; check: string; }

export function inspectionPrompts(concerns: readonly string[]): InspectionPrompt[] {
  return normalizeConcerns(concerns)
    .filter((c) => INSPECTION[c])
    .map((c) => ({ concern: c, label: CONCERN_LABELS[c], check: INSPECTION[c]! }));
}
