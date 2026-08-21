/**
 * Use-case compatibility.
 *
 * Category membership was scored as a binary: same category matched, anything
 * else missed. Retail footwear categories overlap far too much for that. A
 * neutral running shoe is frequently the right answer for someone who walks all
 * day, and a taxonomy label should never be able to rule that out.
 *
 * So this is a deterministic compatibility matrix, not a category test. It
 * answers one question: **if the customer needs X, how well does a shoe built
 * for Y serve that need?**
 *
 * What it deliberately does NOT do: re-judge fit. Support level, cushioning,
 * width and volume are each their own weighted dimension. A stability running
 * shoe scores 0.85 for a neutral running need because it is unambiguously a
 * running shoe; whether its support suits this foot is the support dimension's
 * job, and penalising it here as well would be counting the same fact twice.
 */
import type { CatalogCategory } from './types';

/** The four defined compatibility levels. */
export const COMPAT = {
  PRIMARY: 1.00,   // built for exactly this
  STRONG:  0.85,   // a different label, genuinely well suited
  ADJACENT:0.65,   // works, with a real trade-off
  WEAK:    0.30,   // possible, rarely the right answer
} as const;

/** Anything unlisted is WEAK rather than zero: unusual is not the same as wrong. */
const DEFAULT = COMPAT.WEAK;

/**
 * Genuinely incompatible pairs, deliberately almost empty.
 *
 * Category exclusion is a HARD constraint, so the bar is "physically the wrong
 * product", not "suboptimal". Kids footwear against an adult fitting is the only
 * pair that clears it. A missing safety toe is handled by its own constraint
 * (H4) rather than through the category taxonomy, so a work fitting that does
 * not strictly require safety can still be served by a non-safety work shoe.
 */
export const INCOMPATIBLE: ReadonlyArray<readonly [CatalogCategory, CatalogCategory]> = [
  ['kids', 'running_neutral'], ['kids', 'running_stability'], ['kids', 'walking_comfort'],
  ['kids', 'work_support'], ['kids', 'work_safety'], ['kids', 'hiking'],
  ['kids', 'casual_comfort'], ['kids', 'orthopedic_friendly'], ['kids', 'court_sport'],
];

/**
 * Rows are what the CUSTOMER needs; columns are what the SHOE is built for.
 * The matrix is intentionally asymmetric — a running shoe walks well, a walking
 * shoe runs badly.
 */
const MATRIX: Partial<Record<CatalogCategory, Partial<Record<CatalogCategory, number>>>> = {
  running_neutral: {
    running_neutral: COMPAT.PRIMARY, running_stability: COMPAT.STRONG,
    walking_comfort: COMPAT.ADJACENT, orthopedic_friendly: COMPAT.WEAK,
  },
  running_stability: {
    running_stability: COMPAT.PRIMARY, running_neutral: COMPAT.STRONG,
    walking_comfort: COMPAT.ADJACENT,
  },
  // The example from the brief: a running shoe is a strong answer for walking
  // and extended standing, even though the marketing category differs.
  walking_comfort: {
    walking_comfort: COMPAT.PRIMARY,
    running_neutral: COMPAT.STRONG, running_stability: COMPAT.STRONG,
    orthopedic_friendly: COMPAT.STRONG,
    casual_comfort: COMPAT.ADJACENT, work_support: COMPAT.ADJACENT, hiking: COMPAT.ADJACENT,
  },
  work_support: {
    work_support: COMPAT.PRIMARY, work_safety: COMPAT.STRONG,
    walking_comfort: COMPAT.ADJACENT, orthopedic_friendly: COMPAT.ADJACENT,
    hiking: COMPAT.ADJACENT,
  },
  work_safety: {
    work_safety: COMPAT.PRIMARY,
    // Adjacent rather than excluded: when safety footwear is genuinely required
    // the safety-toe constraint eliminates, and it does so with a reason the
    // associate can read. Doing it twice would hide that reason.
    work_support: COMPAT.ADJACENT, hiking: COMPAT.WEAK,
  },
  hiking: {
    hiking: COMPAT.PRIMARY, work_support: COMPAT.ADJACENT, walking_comfort: COMPAT.ADJACENT,
  },
  casual_comfort: {
    casual_comfort: COMPAT.PRIMARY,
    walking_comfort: COMPAT.STRONG, orthopedic_friendly: COMPAT.STRONG,
    running_neutral: COMPAT.ADJACENT,
  },
  orthopedic_friendly: {
    orthopedic_friendly: COMPAT.PRIMARY, walking_comfort: COMPAT.STRONG,
    casual_comfort: COMPAT.ADJACENT, work_support: COMPAT.ADJACENT,
  },
  court_sport: {
    court_sport: COMPAT.PRIMARY,
    running_neutral: COMPAT.ADJACENT, running_stability: COMPAT.ADJACENT,
  },
  kids: { kids: COMPAT.PRIMARY },
};

export function isIncompatible(required: string, shoe: string): boolean {
  return INCOMPATIBLE.some(([a, b]) =>
    (a === required && b === shoe) || (a === shoe && b === required));
}

/**
 * Compatibility of one shoe for one stated need.
 *
 * `secondaryUses` are additional categories the shoe is also built for
 * (product_model.use_case). The best of them wins: a shoe explicitly built for
 * two jobs should be scored on the one that matches, not on its primary label.
 */
export function useCaseScore(
  required: string, shoeCategory: string, secondaryUses: readonly string[] = [],
): number {
  if (isIncompatible(required, shoeCategory)) return 0;
  const row = MATRIX[required as CatalogCategory];
  if (!row) return DEFAULT;
  const candidates = [shoeCategory, ...secondaryUses]
    .map((c) => row[c as CatalogCategory] ?? DEFAULT);
  return Math.max(...candidates);
}
