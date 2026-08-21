/**
 * Deterministic match scoring.
 *
 * Three curves, nine weights, one formula:
 *
 *     overall = SUM(w * conf * score) / SUM(w * conf)     over KNOWN dimensions
 *
 * Unknown attributes leave BOTH sums. Scoring a null as zero would punish a
 * shoe for our own research gap, and would let a well-documented mediocre shoe
 * beat an excellent one nobody has measured yet.
 *
 * Confidence appears in numerator and denominator, so it weights INFLUENCE
 * rather than applying a penalty: a marketing-sourced value moves the result
 * less than a spec sheet does, without dragging it down.
 */
import { useCaseScore } from './use-case';

export const SCORING_VERSION = 'match-1.0.0';

// ── curves ──────────────────────────────────────────────────────────────────
// Indexed by min(|delta|, 3), where delta = idx(shoe) - idx(required).
export const SYMMETRIC = [1.00, 0.70, 0.40, 0.15];
export const EXCESS    = [1.00, 0.95, 0.80, 0.60];   // shoe offers MORE
export const DEFICIT   = [1.00, 0.55, 0.25, 0.05];   // shoe offers LESS

export function curveScore(delta: number, directional: boolean): number {
  const step = Math.min(Math.abs(delta), 3);
  if (!directional) return SYMMETRIC[step];
  return delta >= 0 ? EXCESS[step] : DEFICIT[step];
}

// ── scales ──────────────────────────────────────────────────────────────────
const SCALES: Record<string, readonly string[]> = {
  cushioning:             ['firm', 'moderate', 'plush', 'max'],
  support:                ['neutral', 'light_stability', 'stability', 'max_support'],
  width_fit:              ['runs_narrow', 'true', 'runs_wide'],
  forefoot_room:          ['shallow', 'standard', 'generous'],
  volume:                 ['low', 'standard', 'high'],
  heel_hold:              ['loose', 'secure', 'locked'],
  flexibility:            ['stiff', 'moderate', 'flexible'],
  orthotic_compatibility: ['poor', 'fair', 'good', 'excellent'],
};

// ── weights, thresholds, direction ──────────────────────────────────────────
export interface DimensionSpec {
  weight: number;
  directional: boolean;
  minConfidence: number;
  attribute: string;        // the product_model column it reads
}

export const DIMENSIONS: Record<string, DimensionSpec> = {
  use_case:               { weight: 3, directional: false, minConfidence: 0.60, attribute: 'category' },
  cushioning:             { weight: 3, directional: false, minConfidence: 0.35, attribute: 'cushioning_level' },
  support:                { weight: 3, directional: false, minConfidence: 0.60, attribute: 'support_level' },
  width_fit:              { weight: 3, directional: true,  minConfidence: 0.75, attribute: 'fit_width_tendency' },
  forefoot_room:          { weight: 2, directional: true,  minConfidence: 0.60, attribute: 'toe_box_room' },
  volume:                 { weight: 2, directional: true,  minConfidence: 0.60, attribute: 'forefoot_volume' },
  heel_hold:              { weight: 2, directional: false, minConfidence: 0.60, attribute: 'heel_hold' },
  orthotic_compatibility: { weight: 2, directional: true,  minConfidence: 0.75, attribute: 'orthotic_compatibility' },
  flexibility:            { weight: 1, directional: false, minConfidence: 0.35, attribute: 'forefoot_flexibility' },
};

/**
 * Confidence for an attribute with no evidence row.
 *
 * The legacy catalog columns predate per-attribute provenance, so they have no
 * evidence to cite. 0.60 says "somebody entered this deliberately, nobody has
 * verified it" — enough for the low-floor dimensions, deliberately NOT enough
 * for width_fit or orthotic_compatibility, which is the correct outcome: those
 * two should stay unknown until a real source exists.
 */
export const LEGACY_CONFIDENCE = 0.60;

export type UnknownReason = 'no_value' | 'below_confidence_threshold' | 'no_requirement';

export interface DimensionResult {
  dimension: string;
  requirement: string | null;
  customerSource: string | null;
  shoeAttribute: string;
  shoeValue: string | null;
  shoeSource: string;
  confidence: number;
  score: number | null;
  weight: number;
  type: 'weighted_match';
  known: boolean;
  unknownReason?: UnknownReason;
}

export interface ScoreInput {
  requirement?: { value: string; source: string };
  shoeValue: string | null;
  shoeSource: string;
  confidence: number;
  secondaryUses?: readonly string[];
}

/** Score one dimension, or explain why it could not be scored. */
export function scoreDimension(
  dimension: string, spec: DimensionSpec, input: ScoreInput,
): DimensionResult {
  const base = {
    dimension,
    requirement: input.requirement?.value ?? null,
    customerSource: input.requirement?.source ?? null,
    shoeAttribute: spec.attribute,
    shoeValue: input.shoeValue,
    shoeSource: input.shoeSource,
    confidence: input.confidence,
    weight: spec.weight,
    type: 'weighted_match' as const,
  };

  if (!input.requirement) {
    return { ...base, score: null, known: false, unknownReason: 'no_requirement' };
  }
  if (input.shoeValue === null || input.shoeValue === undefined) {
    return { ...base, score: null, known: false, unknownReason: 'no_value' };
  }
  if (input.confidence < spec.minConfidence) {
    // The value exists; we simply do not trust this source enough for this
    // dimension. Distinct from no_value, and the panel says so.
    return { ...base, score: null, known: false, unknownReason: 'below_confidence_threshold' };
  }

  if (dimension === 'use_case') {
    const score = useCaseScore(input.requirement.value, input.shoeValue, input.secondaryUses ?? []);
    return { ...base, score, known: true };
  }

  const scale = SCALES[dimension];
  const ri = scale?.indexOf(input.requirement.value) ?? -1;
  const si = scale?.indexOf(input.shoeValue) ?? -1;
  if (!scale || ri < 0 || si < 0) {
    return { ...base, score: null, known: false, unknownReason: 'no_value' };
  }
  return { ...base, score: curveScore(si - ri, spec.directional), known: true };
}

export const MIN_SCORED_DIMENSIONS = 3;

export interface OverallScore {
  overall: number | null;
  scoredCount: number;
  suppressed: boolean;
}

/**
 * The weighted average. Returns null below MIN_SCORED_DIMENSIONS — a percentage
 * derived from one or two dimensions is not a percentage, and showing one would
 * be the exact false confidence this design exists to avoid.
 */
export function overallScore(dimensions: readonly DimensionResult[]): OverallScore {
  const known = dimensions.filter((d) => d.known && d.score !== null);
  if (known.length < MIN_SCORED_DIMENSIONS) {
    return { overall: null, scoredCount: known.length, suppressed: true };
  }
  let num = 0, den = 0;
  for (const d of known) {
    const w = d.weight * d.confidence;
    num += w * (d.score as number);
    den += w;
  }
  return { overall: den === 0 ? null : num / den, scoredCount: known.length, suppressed: false };
}

export const asPercent = (overall: number | null) =>
  overall === null ? null : Math.round(overall * 100);
