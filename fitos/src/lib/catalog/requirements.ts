/**
 * The requirement profile: what THIS customer needs, right now.
 *
 * The rule the whole phase turns on: **current measured evidence is not blended
 * downward.** Each dimension takes the single highest-priority source available
 * and discards the rest. No averaging, no tie-breaking toward the weaker
 * source, no "nudging" a measurement with a reported concern.
 *
 * That is a mechanism, not a weighting. A forefoot_room requirement established
 * by measurement is not reachable by a reported concern — the concern's
 * candidate requirement is dropped on the floor before scoring ever runs.
 */

export const SOURCE_PRIORITY = {
  pressure_measurement:   1,
  foot_measurement:       2,
  associate_observation:  3,
  reported_concern:       4,
  prior_fitting:          5,
  aggregate_outcome:      6,
} as const;

export type RequirementSource = keyof typeof SOURCE_PRIORITY;

/** How the Why panel labels each source to the associate. */
export const SOURCE_LABEL: Record<RequirementSource, string> = {
  pressure_measurement:  'Measured today',
  foot_measurement:      'Measured today',
  associate_observation: 'Observed during fitting',
  reported_concern:      'Customer reported',
  prior_fitting:         'From a previous visit',
  aggregate_outcome:     'From aggregated outcomes',
};

export interface Requirement {
  dimension: string;
  value: string;
  source: RequirementSource;
}

export type RequirementProfile = Record<string, Requirement>;

/**
 * Highest-priority source per dimension wins outright.
 *
 * Ties (two candidates at the same priority for one dimension) keep the first,
 * which is deterministic given a deterministic caller. Two measurements of the
 * same thing disagreeing is a data problem to surface, not one to average away.
 */
export function buildRequirementProfile(candidates: readonly Requirement[]): RequirementProfile {
  const profile: RequirementProfile = {};
  for (const c of candidates) {
    const held = profile[c.dimension];
    if (!held || SOURCE_PRIORITY[c.source] < SOURCE_PRIORITY[held.source]) {
      profile[c.dimension] = c;
    }
  }
  return profile;
}

/** Map a fit profile plus observations into candidate requirements. */
export function requirementsFromFitting(input: {
  fitProfile: Record<string, string>;
  measuredWidth?: string | null;
  reportedConcerns?: readonly string[];
  orthoticRequired?: boolean;
}): Requirement[] {
  const out: Requirement[] = [];
  const push = (dimension: string, value: string | undefined | null, source: RequirementSource) => {
    if (value) out.push({ dimension, value, source });
  };

  // The fit profile is the product of rules over measurements and observations.
  push('use_case', input.fitProfile.category, 'associate_observation');
  push('cushioning', input.fitProfile.cushioning_level, 'associate_observation');
  push('support', input.fitProfile.support_level, 'associate_observation');
  push('forefoot_room', TOE_BOX_TO_ROOM[input.fitProfile.toe_box], 'associate_observation');
  push('volume', input.fitProfile.volume, 'associate_observation');
  push('heel_hold', HEEL_FIT_TO_HOLD[input.fitProfile.heel_fit], 'associate_observation');

  // A measured width outranks anything the fit profile inferred.
  if (input.measuredWidth) {
    push('width_fit', WIDTH_TO_TENDENCY[input.measuredWidth], 'foot_measurement');
  }

  // Concerns are the weakest source here on purpose. Where a measurement exists
  // for the same dimension, these are discarded rather than blended.
  if (input.reportedConcerns?.includes('bunion') || input.reportedConcerns?.includes('toe_pressure')) {
    push('forefoot_room', 'generous', 'reported_concern');
  }
  if (input.reportedConcerns?.includes('orthotics_inserts') || input.orthoticRequired) {
    push('orthotic_compatibility', 'good', 'reported_concern');
  }
  return out;
}

const TOE_BOX_TO_ROOM: Record<string, string> = {
  standard: 'standard', roomy: 'generous', wide_round: 'generous',
};
const HEEL_FIT_TO_HOLD: Record<string, string> = {
  standard: 'secure', secure_narrow: 'locked', structured: 'locked',
};
const WIDTH_TO_TENDENCY: Record<string, string> = {
  narrow: 'runs_narrow', standard: 'true', wide: 'runs_wide', extra_wide: 'runs_wide',
};
