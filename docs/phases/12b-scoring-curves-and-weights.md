# Phase 12b — scoring curves and the nine weights, for final review

**No production migration run.** The three migrations are staged in
`db/migrations/pending/`, outside the live path that `db/reset.sh` reads, and
were applied and rolled back against a throwaway database. Results in §5.

---

## 1 · Scoring curves

Every ordinal attribute is an index on a short scale. `delta = idx(actual) −
idx(required)`. Positive means the shoe offers *more* than required.

Three curves, defined once as constants, indexed by `min(|delta|, 3)`:

```ts
const SYMMETRIC = [1.00, 0.70, 0.40, 0.15];   // distance is distance
const EXCESS    = [1.00, 0.95, 0.80, 0.60];   // shoe offers MORE than required
const DEFICIT   = [1.00, 0.55, 0.25, 0.05];   // shoe offers LESS than required
```

A **directional** dimension uses `EXCESS` when `delta > 0` and `DEFICIT` when
`delta < 0`. A **symmetric** dimension uses `SYMMETRIC` in both directions.

### Why these numbers

The rule you set is that too much room is generally less problematic than too
little, **but excessive room still costs lockdown**. That is a curve, not a
constant, and the shape has to say all three things:

| Step | Excess | Deficit | Reading |
| --- | --- | --- | --- |
| 0 | 1.00 | 1.00 | Exact requirement is ideal |
| 1 | **0.95** | **0.55** | Slightly roomier is nearly free; one step tight is a real problem |
| 2 | **0.80** | 0.25 | Substantially roomier is a modest penalty — foot moving in the shoe |
| 3+ | 0.60 | 0.05 | Excessive room is genuinely poor; three steps tight is unfittable |

The asymmetry at one step is 0.95 against 0.55 — a shoe that is a size roomier
than ideal stays a strong candidate, a shoe that is a step tight drops below
most of the field. That ratio is the encoded form of "too little room is worse".

`EXCESS` never reaches 0. A shoe that is far too roomy is a poor fit, not a
disqualification — if roominess should ever disqualify, that is a hard
constraint and belongs in §3, not in a curve.

**Symmetric sits between them** (0.70 at one step) because for cushioning or
support there is no free direction: too firm and too soft are both wrong, just
differently.

### Use-case compatibility — replaces membership scoring

Membership scoring was wrong: retail categories overlap far too much for
"same category matches, anything else misses". A neutral running shoe is
frequently the right answer for someone who stands all day, and a taxonomy
label must never rule that out.

`src/lib/catalog/use-case.ts` holds a deterministic asymmetric matrix over the
ten catalog categories, at four levels:

| Level | Score | Meaning |
| --- | --- | --- |
| `PRIMARY` | 1.00 | built for exactly this |
| `STRONG` | 0.85 | different label, genuinely well suited |
| `ADJACENT` | 0.65 | works, with a real trade-off |
| `WEAK` | 0.30 | possible, rarely the right answer |

Unlisted pairs default to **WEAK, never zero** — unusual is not the same as
wrong. Only genuinely incompatible pairs score 0, and that list is deliberately
almost empty: kids footwear against an adult fitting is the only entry.

**Asymmetric on purpose.** A running shoe walks well
(`walking_comfort ← running_neutral` = 0.85, the brief's own example); a walking
shoe runs badly (`running_neutral ← walking_comfort` = 0.65).

**It does not re-judge fit.** A stability running shoe scores 0.85 for a neutral
running need because it is unambiguously a running shoe. Whether its support
suits this foot is the support dimension's job, and penalising it here as well
would count the same fact twice.

**Safety stays with the safety constraint.** `work_safety ← work_support` is
ADJACENT rather than excluded, so a work fitting that does not strictly require
safety footwear can still be served. When safety *is* required, H4 eliminates —
with a reason the associate can read, which a taxonomy exclusion would hide.

`product_model.use_case[]` contributes secondary categories; the best of them
wins, so a shoe built for two jobs is scored on the one that matches.

### Other non-ordinal dimensions

- **Boolean** (`removable_insole` as a preference rather than a constraint):
  1.0 / 0.0.

---

## 2 · The nine weights

`min conf` is the floor an attribute's evidence must clear to participate. Below
it the dimension is treated as **unknown** — it leaves both sums — rather than
being scored on untrustworthy data. That is the mechanism that stops marketing
copy from driving a fit decision.

| # | Dimension | W | Scoring | Min conf | Rationale | Unknown behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `use_case` | **3** | membership | 0.60 | The purpose the customer stated. A shoe for the wrong activity is wrong before any measurement matters. Excluding marketing here because "great for standing all day" is a slogan. | Leaves both sums; `no_value` |
| 2 | `cushioning` | **3** | symmetric | 0.35 | Highest-signal comfort dimension and the one associates discuss most. Marketing admitted at the floor because cushioning claims are at least directionally honest — and its influence is scaled by that low confidence anyway. | Leaves both sums |
| 3 | `support` | **3** | symmetric | 0.60 | Structural. Drives whether the shoe does the job the fit profile asked for. Marketing excluded: "stability" in copy means too many different things. | Leaves both sums |
| 4 | `width_fit` | **3** | **directional** | 0.75 | Near-constraint. When width is a hard constraint (§3) this dimension scores the *tendency* — a shoe that runs narrow in a stocked 2E still fits worse than one that runs true. High floor because a wrong width tendency is a return. | Leaves both sums; H2 may still apply |
| 5 | `forefoot_room` | **2** | **directional** | 0.60 | Where reported concerns most often land, and where excess is genuinely tolerable up to a point. Directional by definition. | Leaves both sums |
| 6 | `volume` | **2** | **directional** | 0.60 | Whole-foot fit. Excess volume is survivable with lacing; deficit is not survivable at all. | Leaves both sums |
| 7 | `heel_hold` | **2** | symmetric | 0.60 | Both directions fail: a loose heel slips, a locked heel rubs. Symmetric on purpose. | Leaves both sums |
| 8 | `orthotic_compatibility` | **2** | **directional** | 0.75 | Only scored when an orthotic is in play. High floor: guessing that a shoe takes an orthotic and being wrong wastes the fitting. Extra depth beyond need is harmless, so directional. | Leaves both sums; H5 may still apply |
| 9 | `flexibility` | **1** | symmetric | 0.35 | Real but secondary, and the attribute most often absent. Lowest weight so it cannot swing a ranking. | Leaves both sums |

Total weight 21. Weights and the confidence used are frozen into
`weights_snapshot` on every candidate, so changing them later cannot rewrite a
historical explanation.

### Two things the table encodes that are easy to miss

**Unknown has two distinct causes**, and the panel says different things for
each: `no_value` (nobody has recorded it) versus `below_confidence_threshold`
(recorded, but from a source too weak for this dimension). Both leave the sums.
Only the second implies the data exists and we chose not to trust it.

**`min conf` is per dimension, not global.** Cushioning at 0.35 accepts a
marketing claim; width at 0.75 does not. That asymmetry is deliberate: being
wrong about cushioning disappoints, being wrong about width causes a return.

---

## 3 · Hard constraints, with your qualifications applied

| # | Constraint | Applies when | Behaviour when data is missing |
| --- | --- | --- | --- |
| H1 | **Size** | Always. FitOS-derived required retail size, driven by the **larger** foot. | If no size measured, H1 does not apply. |
| H2 | **Width** | Customer width **measured** AND shoe width data confidence ≥ 0.75. | Either unknown ⇒ **not applied**. Never eliminates. |
| H3 | **Stocked here** | Pilot mode, always. | — |
| H4 | **Safety toe** | Only when explicitly required by the fitting. | Not required ⇒ not applied. |
| H5 | **Removable insole** | Only when the fitting requires orthotic accommodation. | Not required ⇒ not applied. |
| H6 | **Category exclusion** | Only genuinely incompatible use. Conservative: the exclusion list is limited to pairs that are wrong rather than merely suboptimal. | Empty list ⇒ not applied. |

Foot asymmetry is **preserved as a consideration**, never a constraint: the
larger foot sets the size, and a difference ≥ 0.5 appears in the Why panel under
*Things to consider*.

Everything else — toe box, heel structure, cushioning, support, volume,
flexibility, all geometry — is a weighted dimension and **can never eliminate a
shoe**. Today's `.filter(c => c.misses.length === 0)` does the opposite, and
removing it is the single highest-value line in this phase.

---

## 4 · Provenance defaults, revised

| Source | Default | Ceiling |
| --- | --- | --- |
| `manufacturer_technical_spec` | 0.95 | — |
| `independent_measurement` | 0.92 | — |
| `manual_reviewed_research` | 0.85 | — |
| `retailer_structured_data` | 0.80 | — |
| `stride_guide_normalization` | 0.60 | requires review |
| `manufacturer_marketing_claim` | 0.38 | **≤ 0.40, enforced** |
| `outcome_derived` | 0.50 | reserved, nothing writes it |
| `synthetic_fixture` | 0.90 | test data only |

**Two database constraints rather than two conventions**, both verified biting
on scratch:

```sql
check (source_type <> 'stride_guide_normalization' or review_status <> 'unreviewed')
check (source_type <> 'manufacturer_marketing_claim' or confidence <= 0.40)
```

The first makes it **impossible to label an unreviewed guess as a Stride Guide
normalization** — your point 8, enforced where a convention would not survive a
bulk import. The second stops marketing copy being promoted to specification.

`synthetic_fixture` exists so test data is self-identifying; a test asserts no
fixture-sourced evidence ever attaches to a real catalog model.

---

## 5 · Migration validation on scratch

Applied over the full schema bundle in a throwaway database, then rolled back:

```
base schema ok
  applied 0012_catalog_taxonomy
  applied 0013_shoe_attribute_evidence
  applied 0014_recommendation_candidate

ERROR: violates check constraint "normalization_requires_review"     ← guard bites
ERROR: violates check constraint "marketing_confidence_ceiling"      ← guard bites
ERROR: violates check constraint "eliminated_shape"                  ← guard bites

  rolled back 0014 / 0013 / 0012
taxonomy columns left: 0 · evidence table left: 0 · candidate table left: 0
original catalog columns intact: 7
```

`eliminated_shape` refuses a row that is both ranked and eliminated, so
"why this shoe" and "why not this shoe" cannot drift into inconsistent states.

Files are in `db/migrations/pending/`, which `db/reset.sh` does not read. They
move into `db/migrations/` only on your approval.

---

## 6 · Catalog strategy, revised per point 6

**A · Synthetic fixtures** — test-only, `synthetic_fixture` provenance, built to
cover every comparator, both curve directions, each hard constraint, and the
unknown paths. These make the engine testable without asserting anything about
real shoes.

**B · Real pilot catalog** — real manufacturer and model identities, but **only
attributes that have been verified or deliberately reviewed**. Everything else
null. No geometry, drop, last shape, stack height or fit tendency from memory.

I am **not** seeding 24 real models with classifications now. Waiting for the
pilot retailer's actual 20–30 high-volume models means the first real catalog
rows are ones that matter and can be checked. Until that list exists, the engine
is exercised entirely by fixtures.

---

## 7 · Current-scan-wins, mechanically

`buildRequirementProfile()` groups candidate requirements by dimension, takes the
single highest-priority source, and **discards the rest for that dimension** —
no averaging, no blending, no tie-breaking downward.

```
1 pressure_measurement   2 foot_measurement       3 associate_observation
4 reported_concern       5 prior_fitting          6 aggregate_outcome
```

A `forefoot_room` requirement established at priority 2 is not reachable by
priority 4. A test asserts that adding lower-priority evidence to an otherwise
identical fitting changes nothing about the requirement profile.

---

**Awaiting approval on the curves, the nine weights, and the confidence
defaults. Nothing moves into `db/migrations/` until then.**
