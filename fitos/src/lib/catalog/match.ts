/**
 * Matching: constraints, then scoring, then an explanation that is persisted
 * rather than regenerated.
 *
 * The explanation is built from the same records the scorer produced. Nothing
 * here calls a model, and nothing invents a reason — if a dimension was not
 * scored, no sentence about it can exist.
 */
import { DIMENSIONS, LEGACY_CONFIDENCE, SCORING_VERSION, asPercent,
         overallScore, scoreDimension, type DimensionResult } from './scoring';
import { evaluateConstraints, firstFailure,
         type ConstraintContext, type ConstraintResult, type ShoeForConstraints } from './constraints';
import type { RequirementProfile } from './requirements';

export interface CatalogShoe extends ShoeForConstraints {
  productModelId: string;
  brand: string;
  model: string;
  secondaryUses: readonly string[];
  /** product_model column -> value, null when unknown. */
  attributes: Record<string, string | null>;
  /** attribute -> { confidence, source } from shoe_attribute_evidence. */
  evidence: Record<string, { confidence: number; source: string }>;
}

export interface MatchedCandidate {
  productModelId: string;
  brand: string;
  model: string;
  eliminated: boolean;
  eliminationReason: string | null;
  hardConstraints: ConstraintResult[];
  dimensions: DimensionResult[];
  overall: number | null;
  percent: number | null;
  scoredCount: number;
  considerations: string[];
  catalogSnapshot: Record<string, string | null>;
  rank?: number;
}

export function matchShoe(
  profile: RequirementProfile, shoe: CatalogShoe, ctx: ConstraintContext,
): MatchedCandidate {
  const hardConstraints = evaluateConstraints(ctx, shoe);
  const failure = firstFailure(hardConstraints);

  const base = {
    productModelId: shoe.productModelId, brand: shoe.brand, model: shoe.model,
    hardConstraints,
    // The values used, frozen. A later catalog edit must not rewrite this.
    catalogSnapshot: { ...shoe.attributes, category: shoe.category },
  };

  if (failure) {
    // Eliminated candidates are still persisted, so the panel can answer
    // "why NOT this shoe" instead of letting it silently vanish.
    return { ...base, eliminated: true, eliminationReason: failure.detail,
             dimensions: [], overall: null, percent: null, scoredCount: 0, considerations: [] };
  }

  const dimensions = Object.entries(DIMENSIONS).map(([name, spec]) => {
    const ev = shoe.evidence[spec.attribute];
    const shoeValue = name === 'use_case' ? shoe.category : shoe.attributes[spec.attribute] ?? null;
    return scoreDimension(name, spec, {
      requirement: profile[name] ? { value: profile[name].value, source: profile[name].source } : undefined,
      shoeValue,
      shoeSource: ev?.source ?? 'legacy_catalog_row',
      confidence: ev?.confidence ?? LEGACY_CONFIDENCE,
      secondaryUses: shoe.secondaryUses,
    });
  });

  const { overall, scoredCount } = overallScore(dimensions);
  return { ...base, eliminated: false, eliminationReason: null, dimensions,
           overall, percent: asPercent(overall), scoredCount,
           considerations: buildConsiderations(dimensions, ctx) };
}

/**
 * Negative evidence, surfaced deliberately. A recommendation that looks
 * flawless is a recommendation an experienced associate stops trusting.
 */
function buildConsiderations(dims: readonly DimensionResult[], ctx: ConstraintContext): string[] {
  const out: string[] = [];
  for (const d of dims) {
    // <= 0.70 so a single symmetric step qualifies. One step off on cushioning
    // or heel hold is exactly the kind of thing an associate wants flagged, and
    // a strict < 0.70 silently dropped it.
    if (d.known && d.score !== null && d.score <= 0.70) {
      out.push(`${LABEL[d.dimension] ?? d.dimension} is ${describeGap(d)}.`);
    }
    if (d.unknownReason === 'below_confidence_threshold') {
      out.push(`FitOS has limited verified data for this model's ${LABEL[d.dimension] ?? d.dimension}.`);
    }
  }
  if (ctx.sizeAsymmetry !== null && ctx.sizeAsymmetry >= 0.5) {
    out.push('Feet measured different sizes; fitted to the larger foot.');
  }
  return out.slice(0, 4);
}

function describeGap(d: DimensionResult): string {
  return d.score !== null && d.score <= 0.4 ? 'a long way from the fit profile'
       : 'a step away from the fit profile';
}

export const LABEL: Record<string, string> = {
  use_case: 'intended use', cushioning: 'cushioning', support: 'support',
  width_fit: 'width', forefoot_room: 'toe-box room', volume: 'volume',
  heel_hold: 'heel hold', orthotic_compatibility: 'orthotic accommodation',
  flexibility: 'flexibility',
};

/** Rank the survivors; eliminated candidates keep no rank, by constraint. */
export function rankMatches(candidates: MatchedCandidate[]): MatchedCandidate[] {
  const live = candidates.filter((c) => !c.eliminated && c.overall !== null)
    .sort((a, b) => (b.overall as number) - (a.overall as number))
    .map((c, i) => ({ ...c, rank: i + 1 }));
  // Shoes that survived every constraint but lack the data to be scored rank
  // below every scored candidate rather than disappearing.
  const unscored = candidates.filter((c) => !c.eliminated && c.overall === null)
    .map((c, i) => ({ ...c, rank: live.length + i + 1 }));
  return [...live, ...unscored, ...candidates.filter((c) => c.eliminated)];
}

export { SCORING_VERSION };
