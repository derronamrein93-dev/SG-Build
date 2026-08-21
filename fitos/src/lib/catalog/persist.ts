/**
 * Loading the catalog for matching, and persisting the explanation.
 *
 * The persistence rule the whole audit story rests on: **a stored candidate
 * must be explainable from its own row.** No join to a catalog that may have
 * changed, no recomputation, no reading today's weights to explain last
 * March's fitting.
 */
import type { PoolClient } from 'pg';
import type { CatalogShoe, MatchedCandidate } from './match';
import { DIMENSIONS, LABEL_SOURCE, SCORING_VERSION } from './scoring';
import { LABEL } from './match';
import type { RequirementProfile } from './requirements';

/**
 * Every locally stocked shoe, with its attributes and per-attribute provenance.
 *
 * Scoped by the caller's tenant context through RLS on location_inventory --
 * the pilot rule that recommendations only include this store's inventory is
 * enforced by the database, not by this query remembering to filter.
 */
export async function loadCatalogForMatching(
  c: PoolClient, locationId: string,
): Promise<CatalogShoe[]> {
  const { rows } = await c.query(
    `select m.*, i.widths_stocked, i.size_low, i.size_high, i.stocked
       from location_inventory i
       join product_model m on m.id = i.product_model_id
      where i.location_id = $1 and i.stocked`, [locationId]);

  const ids = rows.map((r) => r.id);
  const evidence: Record<string, Record<string, { confidence: number; source: string }>> = {};
  if (ids.length) {
    const { rows: ev } = await c.query(
      `select product_model_id, attribute_name, confidence, source_type
         from shoe_attribute_evidence
        where product_model_id = any($1) and superseded_by is null`, [ids]);
    for (const e of ev) {
      (evidence[e.product_model_id] ??= {})[e.attribute_name] =
        { confidence: Number(e.confidence), source: e.source_type };
    }
  }

  return rows.map((r) => ({
    productModelId: r.id, brand: r.brand, model: r.model,
    category: r.category, secondaryUses: r.use_case ?? [],
    safetyToe: r.safety_toe, removableInsole: r.removable_insole, depth: r.depth ?? null,
    sizeLow: r.size_low === null ? null : Number(r.size_low),
    sizeHigh: r.size_high === null ? null : Number(r.size_high),
    widthsStocked: r.widths_stocked ?? [], stocked: r.stocked,
    attributes: Object.fromEntries(
      Object.values(DIMENSIONS).map((d) => [d.attribute, r[d.attribute] ?? null])),
    evidence: evidence[r.id] ?? {},
  }));
}

/**
 * The strong-match sentences, rendered once from the scored dimensions.
 *
 * A reason cannot exist without a dimension that scored well: the list is a
 * projection of the evidence, so "no explanation reason exists if the
 * underlying match evidence does not exist" is structural rather than checked.
 */
export function buildReasons(candidate: MatchedCandidate): string[] {
  return candidate.dimensions
    .filter((d) => d.known && d.score !== null && d.score >= 0.85)
    .sort((a, b) => (b.weight * (b.score as number)) - (a.weight * (a.score as number)))
    .slice(0, 4)
    .map((d) => {
      const label = LABEL[d.dimension] ?? d.dimension;
      const src = LABEL_SOURCE[d.customerSource ?? ''] ?? 'From this fitting';
      return `${label} matches what was needed (${src.toLowerCase()}).`;
    });
}

export interface PersistInput {
  recommendationId: string;
  organizationId: string;
  requirementProfile: RequirementProfile;
  candidates: readonly MatchedCandidate[];
}

/**
 * Write every candidate that reached evaluation, eliminated ones included.
 *
 * Note what is NOT here: no `?? 0`, no `|| 1`, no coalesce on a score. An
 * eliminated or unscored candidate persists `null`, and the eliminated_shape
 * constraint in 0014 refuses the row if that ever stops being true.
 */
export async function persistCandidates(c: PoolClient, input: PersistInput): Promise<number> {
  let written = 0;
  for (const cand of input.candidates) {
    await c.query(
      `insert into recommendation_candidate
        (recommendation_id, organization_id, product_model_id, rank, eliminated,
         elimination_reason, overall_score, scored_dimension_count, scoring_version,
         hard_constraints, dimensions, considerations, catalog_snapshot,
         weights_snapshot, requirement_snapshot, reasons)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [input.recommendationId, input.organizationId, cand.productModelId,
       cand.eliminated ? null : cand.rank ?? null,
       cand.eliminated, cand.eliminationReason,
       cand.overall,                       // null stays null. Deliberately.
       cand.scoredCount, SCORING_VERSION,
       JSON.stringify(cand.hardConstraints), JSON.stringify(cand.dimensions),
       JSON.stringify(cand.considerations), JSON.stringify(cand.catalogSnapshot),
       JSON.stringify(Object.fromEntries(
         Object.entries(DIMENSIONS).map(([k, v]) => [k, { weight: v.weight, minConfidence: v.minConfidence }]))),
       JSON.stringify(input.requirementProfile),
       JSON.stringify(buildReasons(cand))]);
    written += 1;
  }
  return written;
}

/** Read a stored explanation back. Never recomputes; the row is the answer. */
export async function loadCandidates(c: PoolClient, recommendationId: string) {
  const { rows } = await c.query(
    `select * from recommendation_candidate
      where recommendation_id = $1
      order by eliminated, rank nulls last`, [recommendationId]);
  return rows;
}
