# Phase 12 — Catalog foundation and explainable matching: plan

**Nothing implemented. No migration written, no migration run.** Proposal for
review, per "before implementing broadly, report".

---

## 1 · Audit of the existing catalog

Checked against the live schema, not the design docs.

| | State |
| --- | --- |
| `product_model` | 25 columns, 12 rows. Has category, use_case, support/cushioning level, toe_box_shape, heel_structure, flexibility, volume, drop_mm, weight_g, removable_insole, safety_toe, slip_resistant, waterproof, best_for, avoid_for, msrp. |
| `product_variant` | 8 columns. **0 rows, and zero foreign keys point at it.** It is orphaned. |
| `location_inventory` | Joins `product_model` **directly**, not the variant. Carries `widths_stocked`, `size_low`, `size_high`, `retailer_sku`, `quantity`, `stocked`. |
| RLS | `product_model` / `product_variant` global, no RLS — correct. `location_inventory` `FORCE` RLS — correct. |
| `outcome` | Exists, with `purchased_model_id`, `returned`, `return_reason`, `satisfaction`. A usable foundation. |

**Six real problems, in order of how much they matter.**

**1. Size is not a constraint anywhere.** `rankCandidates()` never looks at
size. A model stocked only in 8–9 can rank first for a measured size 11 foot.
This is exactly the failure the brief names, and it exists today.

**2. Hard and soft are inverted.** The ranking ends with
`.filter(c => c.misses.length === 0)`. Any soft miss — "toe box narrower than
ideal" — **eliminates the shoe entirely**, while a genuinely disqualifying fact
like a missing size passes through unnoticed. Preferences act as constraints and
constraints do not act at all.

**3. Scores cannot become percentages.** Additive integers with no denominator
(max ~17 in practice). "92%" is not derivable from this without inventing a
scale.

**4. Provenance is per-row, not per-attribute.** `data_source`, `verified_at`
and `catalog_version` describe the whole shoe. There is no way to say
"`drop_mm` came from the spec sheet, `toe_box_shape` is our own judgement, and
`heel_counter_structure` is unknown". Confidence-aware explanation is impossible
on this shape.

**5. Nothing about a recommendation is reconstructible.**
`recommendation.products_considered` is `uuid[]` — ids only. No per-shoe score,
no dimensions, no reasons. The auditability requirement ("why did FitOS
recommend this shoe at that time?") **cannot be answered today**, even
approximately.

**6. Brand is free text.** "Brooks", "brooks" and "Brooks Running" are three
brands. Fine at 12 models, not at 150.

`product_variant` being orphaned is not a seventh problem so much as an
unfinished intention — the three-layer split was designed and never wired up.

---

## 2 · Proposed canonical model

Additive throughout. Nothing dropped, nothing renamed.

```
shoe_brand ──< product_model ──< product_variant ──< location_inventory
                    │                                      (org/location scoped)
                    └──< shoe_attribute_evidence   (provenance, one row per attribute)
```

- **`shoe_brand`** — new, global. `id, name, normalized_name (unique), website,
  active`. `product_model.brand_id` added nullable and backfilled from the
  existing text; `product_model.brand` **stays** so nothing breaks mid-flight.
- **`product_model`** — extended with the geometry/fit taxonomy in §3. Every new
  column nullable. A partially-known shoe is the normal case.
- **`product_variant`** — kept as designed, finally used: `location_inventory`
  gains a nullable `product_variant_id`. Model-level inventory keeps working for
  the pilot; variant-level becomes available the moment a retailer file arrives.
  **Not** a rewrite of the inventory join.
- **`location_inventory`** — unchanged except that one nullable column, plus
  `size_low`/`size_high` finally being *used*.

**Why model-level inventory survives the pilot.** With 50–150 curated models and
no retailer export, `widths_stocked` + a size range answers "is this fittable
here" correctly. Variant rows are the right destination for a real SKU feed, and
the nullable FK is what lets that arrive without redesign.

---

## 3 · Attribute taxonomy

Grouped as the brief proposes; **every column nullable**.

| Group | Columns |
| --- | --- |
| Geometry | `stack_height_heel_mm`, `stack_height_forefoot_mm`, `toe_box_width`, `forefoot_volume`, `midfoot_volume`, `heel_width`, `heel_counter_structure`, `last_shape` (`drop_mm`, `toe_box_shape`, `volume` already exist) |
| Cushioning | `cushioning_softness`, `cushioning_responsiveness`, `forefoot_cushioning`, `heel_cushioning` |
| Support | `stability_type`, `medial_support`, `lateral_support`, `torsional_rigidity`, `rocker_geometry` |
| Flexibility | `forefoot_flexibility`, `torsional_flexibility` (`flexibility` exists as longitudinal) |
| Fit | `fit_length_tendency`, `fit_width_tendency`, `heel_hold`, `midfoot_hold`, `toe_box_room`, `instep_room`, `orthotic_compatibility`, `depth` |
| Construction | `outsole_type`, `upper_material`, `upper_stretch` |

**Normalized scales, machine value and label held separately** — the pattern
already used for concerns and consent:

```
cushioning_level : minimal | low | moderate | high | maximum
support_level    : neutral | guided | stability | maximum_stability
toe_box          : tapered | standard | roomy | wide_round | anatomical
```

Existing `product_model.support_level` and `cushioning_level` already carry the
engine's four-value vocabulary. **Mapping the two scales is a migration decision
that needs your call** — see §11.

---

## 4 · Provenance architecture

```sql
shoe_attribute_evidence (
  id, product_model_id, attribute_name, value_text, value_numeric,
  source_type,          -- manufacturer_spec | manufacturer_marketing
                        -- | independent_measurement | retailer_provided
                        -- | stride_guide_normalization | manual_research
                        -- | outcome_derived
  source_url, source_name, captured_at,
  confidence,           -- 0.0-1.0
  reviewed_by, review_status,   -- unreviewed | accepted | disputed | rejected
  superseded_by         -- append-only, same pattern as fitting_feature
)
```

**The current value stays denormalised on `product_model`; evidence is the
trail.** Ranking touches every stocked shoe on every fitting — a join per
attribute per shoe would make that query pathological. So the model row holds
the current best value, and evidence answers *where did that come from and how
much do we trust it*. `superseded_by` makes it append-only, matching
`fitting_feature`.

**Confidence enters scoring** (§6): a dimension backed by
`manufacturer_marketing` at 0.4 contributes less, and the Why panel discloses it.

**Unknown stays unknown.** No default value, no inference from a sibling
attribute, no "probably standard". A null attribute is *omitted from the score
denominator*, never scored zero — scoring it zero would silently punish shoes we
simply have not researched.

---

## 5 · Inventory model

Unchanged in shape; corrected in use.

- Pilot: recommendations restricted to `location_inventory` where
  `stocked = true` for the **current location**, enforced by the existing RLS.
  Test 4 and 5 in the brief are already structurally true and will be asserted.
- Matching identifiers, in precedence order for a future importer: UPC/GTIN →
  `manufacturer_style_code` → brand + model + version + gender + width + size →
  manual review queue. Schema supports all four; **no importer built this
  phase.**
- Enterprise: nothing built. The organization boundary already exists on
  `location_inventory`, so a future cross-location query is a policy change, not
  a redesign.

---

## 6 · Match-scoring architecture

Three stages, all deterministic.

**Stage 1 — hard constraints (eliminate, never score).**

| Constraint | Why hard |
| --- | --- |
| Measured size within `size_low..size_high` | A size 9 shoe is not a size 11 shoe |
| Required width in `widths_stocked` | Ditto |
| `stocked = true` at this location | Cannot sell it |
| Safety toe when the purpose requires it | Workplace requirement |
| Removable insole when an orthotic must fit | Physical |
| Category on the exclusion list | Wrong tool |

A failed hard constraint removes the shoe and records *which* constraint failed,
so "no size 11" can be explained rather than the shoe silently vanishing.

**Stage 2 — weighted dimensions**, each scored 0..1:

`width_fit · forefoot_room · volume · cushioning · support · stability ·
heel_hold · flexibility · orthotic_compatibility · use_case · pressure_response`

**Stage 3 — overall score:**

```
overall = Σ(weight × score × confidence) / Σ(weight × confidence)
```

over *known* dimensions only. Unknown attributes leave the sum entirely, which
is what makes the percentage honest and what stops a data gap from masquerading
as a poor fit. The denominator is why a real percentage exists at all.

### Current scan must win — the mechanical encoding

Every requirement carries its source, and sources have a fixed precedence:

```
1 pressure_measurement   2 foot_measurement       3 associate_observation
4 reported_concern       5 prior_fitting          6 aggregate_outcome
```

`buildRequirementProfile()` takes **the highest-priority source per dimension
and never merges downward**. A `forefoot_width` requirement established by
measurement cannot be modified by a reported concern or by historical data —
not down-weighted, *not reachable*. That is the difference between a convention
and a mechanism, and it is what makes Scenario C pass structurally rather than
by tuning.

---

## 7 · Hard constraints vs weighted preferences

Stated once, in code, as two separate lists — `HARD_CONSTRAINTS` and
`SCORED_DIMENSIONS` — with a test asserting no attribute appears in both. Today's
inverted behaviour (§1, problem 2) disappears because misses stop being fatal
and constraints start being enforced.

---

## 8 · Explanation model

Persisted, not regenerated:

```sql
recommendation_candidate (
  id, recommendation_id, product_model_id, rank, overall_score,
  hard_constraints jsonb,   -- [{constraint, passed, detail}]
  dimensions jsonb,         -- the evidence records below
  considerations jsonb,     -- negative evidence, surfaced deliberately
  catalog_snapshot jsonb    -- attribute values AS THEY WERE
)
```

Each dimension record is exactly the shape the brief specifies — requirement,
customer_source, customer_value, shoe_attribute, shoe_value, shoe_source, score,
confidence, type. The Why panel renders these into retail language; **no model
call, no generated prose.** The engine decides, the UI explains.

`catalog_snapshot` is what answers "why did FitOS recommend this in March"
after the catalog changes. Frozen at generation, same discipline as
`feature_snapshot` and `content_snapshot`.

**Safety:** explanation strings pass through the existing `violatesGuardrails`
lexicon. Customer-reported requirements render as "Customer reported…",
never as measured findings — the boundary Phase 11 established.

---

## 9 · Pilot catalog population

50–150 models across specialty running, comfort, work, walking, orthopedic —
**no fabricated specifications**. Every attribute we cannot source stays null and
shows as "limited data" rather than becoming a confident claim.

Realistically, hand-researching 120 models with sourced provenance is 6–10 hours
of *human* work, not something I should invent. **My proposal: seed ~24 models
with honest, sparse attributes and correct provenance records, enough to exercise
every scoring path, and treat the full curation as a separate data task with its
own review.** Fabricating 120 shoes' worth of geometry would poison the moat this
phase exists to build.

---

## 10 · Outcome capture

`outcome` already holds most of it. Additions: `recommendation_candidate_id` so
an outcome points at the specific ranked candidate, plus `override_reason` as an
enum on the candidate when the associate picks something else. **No learning
loop, no retraining, no aggregate influence on ranking.** Outcomes accumulate as
evidence and change nothing yet.

---

## 11 · Migration plan, and the two decisions I need

Six additive migrations, each reversible and separately testable:

| | |
| --- | --- |
| 0012 | `shoe_brand`, `product_model.brand_id` nullable + backfill |
| 0013 | Attribute taxonomy columns, all nullable |
| 0014 | `shoe_attribute_evidence` |
| 0015 | `location_inventory.product_variant_id` nullable |
| 0016 | `recommendation_candidate` |
| 0017 | `outcome.recommendation_candidate_id` |

Nothing destructive. Existing RLS, org boundaries, quick intake, concerns,
report generation, identity architecture, golden paths and mutation guards
untouched — and re-verified.

**Decision 1 — the two scales disagree.** The engine's vocabulary is
`support_level: neutral | light_stability | stability | max_support` and
`cushioning_level: firm | moderate | plush | max`. The brief proposes
`neutral | guided | stability | maximum_stability` and
`minimal | low | moderate | high | maximum`. These are different scales, and
`rules.json` votes in the existing vocabulary. Options: keep the engine's
vocabulary and treat the brief's as display labels (**my recommendation** — zero
rule churn); or migrate the vocabulary and re-version all 30 rules. This is not
my call to make quietly.

**Decision 2 — scope.** Everything above is roughly a week. The *smallest
coherent slice* that delivers the milestone is:

> **0013 + 0014 + 0016, plus hard constraints, weighted scoring with a real
> percentage, the persisted explanation, and the Why panel.**

That fixes the size bug, un-inverts hard/soft, makes scores mean something,
makes recommendations auditable, and ships the Why button. `shoe_brand`,
variants and outcome linkage can follow without rework.

---

## 12 · Tests

All 16 from the brief plus the 12 explainability assertions, notably: a size-11
foot never sees a size-9 shoe; a reported bunion with a measured standard
forefoot does not produce a wide recommendation (Scenario C); two customers with
the same concern and different measurements get different results (the brief's A
vs B); an unknown attribute produces no positive claim; the score breakdown
reconciles arithmetically with the overall; and a stored explanation does not
change when catalog values change afterwards.

Plus one browser golden path: new customer → intake → concerns → measurements →
catalog-driven recommendations → open **Why?** → select → complete → report.

---

## 13 · Deliberately deferred

Machine learning, collaborative filtering, "people like you", cross-store
enterprise inventory and its UX, manufacturer APIs, scraping, MyStrideID, home
scanner, hardware ingest, BLE, the retailer CSV importer, automatic enrichment,
cross-retailer data sharing, comparison-mode UI (the data shape supports it; the
screen is not built).

---

**Stop here for review.** Two decisions above need your answer before I write a
migration.
