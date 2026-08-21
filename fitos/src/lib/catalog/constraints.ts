/**
 * Hard constraints — the only things that may eliminate a shoe.
 *
 * The previous ranker did the opposite: it ended with
 * `.filter(c => c.misses.length === 0)`, so a soft miss like "toe box narrower
 * than ideal" removed a shoe entirely, while a missing size passed unnoticed.
 * Preferences acted as constraints and constraints did not act at all.
 *
 * A constraint only applies when the data to apply it exists. An unmeasured
 * foot must not eliminate the whole wall.
 */

export interface ConstraintContext {
  /** The larger foot drives the size, matching the existing fitting rule. */
  requiredSize: number | null;
  sizeAsymmetry: number | null;
  requiredWidth: string | null;
  widthConfidence: number | null;
  safetyToeRequired: boolean;
  orthoticAccommodationRequired: boolean;
  excludedCategories: readonly string[];
}

export interface ShoeForConstraints {
  category: string;
  safetyToe: boolean;
  removableInsole: boolean;
  depth: string | null;
  sizeLow: number | null;
  sizeHigh: number | null;
  widthsStocked: readonly string[];
  stocked: boolean;
}

export interface ConstraintResult {
  constraint: string;
  applied: boolean;
  passed: boolean;
  detail: string;
}

/** Width data is only trusted enough to eliminate above this floor. */
export const WIDTH_CONSTRAINT_MIN_CONFIDENCE = 0.75;

export function evaluateConstraints(
  ctx: ConstraintContext, shoe: ShoeForConstraints,
): ConstraintResult[] {
  const results: ConstraintResult[] = [];
  const add = (constraint: string, applied: boolean, passed: boolean, detail: string) =>
    results.push({ constraint, applied, passed, detail });

  // H1 size — the larger foot sets the minimum. Asymmetry stays a consideration.
  if (ctx.requiredSize !== null && shoe.sizeLow !== null && shoe.sizeHigh !== null) {
    const ok = ctx.requiredSize >= shoe.sizeLow && ctx.requiredSize <= shoe.sizeHigh;
    add('size_available', true, ok,
      ok ? `size ${ctx.requiredSize} is stocked`
         : `stocked ${shoe.sizeLow}-${shoe.sizeHigh}, needs ${ctx.requiredSize}`);
  } else {
    add('size_available', false, true, 'no measured size, constraint not applied');
  }

  // H2 width — hard only when the foot was measured AND the shoe's width data is
  // trustworthy. Either unknown and it cannot eliminate anything.
  const widthTrusted = (ctx.widthConfidence ?? 0) >= WIDTH_CONSTRAINT_MIN_CONFIDENCE;
  if (ctx.requiredWidth && ctx.requiredWidth !== 'standard' && widthTrusted) {
    const ok = shoe.widthsStocked.includes(ctx.requiredWidth);
    add('width_available', true, ok,
      ok ? `${ctx.requiredWidth} width stocked` : `no ${ctx.requiredWidth} width here`);
  } else {
    add('width_available', false, true,
      !ctx.requiredWidth ? 'width not measured, constraint not applied'
        : !widthTrusted ? 'width data not trustworthy enough to eliminate'
        : 'standard width, constraint not applied');
  }

  // H3 stocked here — pilot mode is local inventory only.
  add('stocked_here', true, shoe.stocked, shoe.stocked ? 'in this store' : 'not stocked here');

  // H4 safety toe — only when the fitting explicitly requires it.
  if (ctx.safetyToeRequired) {
    add('safety_toe', true, shoe.safetyToe,
      shoe.safetyToe ? 'has a safety toe' : 'no safety toe, and one is required');
  } else {
    add('safety_toe', false, true, 'not required');
  }

  // H5 orthotic accommodation — a physical requirement, not a preference. The
  // weighted orthotic dimension ranks the survivors; it does not rescue a shoe
  // the orthotic physically will not go into.
  if (ctx.orthoticAccommodationRequired) {
    const ok = shoe.removableInsole;
    add('orthotic_accommodation', true, ok,
      ok ? 'insole comes out' : 'glued-in footbed, the orthotic will not fit');
  } else {
    add('orthotic_accommodation', false, true, 'no orthotic in this fitting');
  }

  // H6 category exclusion — conservative by design. Almost nothing qualifies;
  // a missing safety toe is H4's job, not the taxonomy's.
  if (ctx.excludedCategories.length) {
    const ok = !ctx.excludedCategories.includes(shoe.category);
    add('category_compatible', true, ok, ok ? 'compatible use' : `${shoe.category} is excluded here`);
  } else {
    add('category_compatible', false, true, 'no exclusions');
  }

  return results;
}

export const firstFailure = (results: readonly ConstraintResult[]) =>
  results.find((r) => r.applied && !r.passed) ?? null;
