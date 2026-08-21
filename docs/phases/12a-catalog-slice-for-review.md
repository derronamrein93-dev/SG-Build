# Phase 12a — migration set, scoring formula, constraint matrix, seed list

**For review. No migration written to `db/migrations/`, nothing run.**

Vocabulary decision recorded: the engine's internal values stay
(`neutral | light_stability | stability | max_support`,
`firm | moderate | plush | max`). Consumer wording is a display-label map only,
and `rules.json` is not re-versioned.

---

## 1 · Exact migration set

Three migrations. Brand table, variant wiring and outcome linkage deferred as
agreed.

### `0012_catalog_taxonomy.sql` — additive columns on `product_model`

All nullable, no defaults. Unknown is the normal state.

```sql
alter table product_model
  add column stack_height_heel_mm      integer,
  add column stack_height_forefoot_mm  integer,
  add column toe_box_width             text,   -- narrow|standard|wide
  add column forefoot_volume           text,   -- low|standard|high
  add column midfoot_volume            text,
  add column heel_width                text,   -- narrow|standard|wide
  add column heel_counter_structure    text,   -- soft|moderate|firm
  add column last_shape                text,   -- straight|semi_curved|curved
  add column cushioning_softness       text,   -- firm|balanced|soft
  add column cushioning_responsiveness text,   -- low|moderate|high
  add column forefoot_cushioning       text,   -- firm|moderate|plush|max
  add column heel_cushioning           text,
  add column stability_type            text,   -- none|guide_rails|medial_post|wide_base|rocker
  add column medial_support            text,   -- none|mild|moderate|strong
  add column torsional_rigidity        text,   -- flexible|moderate|rigid
  add column rocker_geometry           text,   -- none|forefoot|full
  add column forefoot_flexibility      text,   -- stiff|moderate|flexible
  add column torsional_flexibility     text,
  add column fit_length_tendency       text,   -- runs_short|true|runs_long
  add column fit_width_tendency        text,   -- runs_narrow|true|runs_wide
  add column heel_hold                 text,   -- loose|secure|locked
  add column midfoot_hold              text,
  add column toe_box_room              text,   -- shallow|standard|generous
  add column instep_room               text,
  add column orthotic_compatibility    text,   -- poor|fair|good|excellent
  add column depth                     text,   -- standard|extra_depth
  add column outsole_type              text,
  add column upper_material            text,
  add column upper_stretch             text;   -- none|slight|stretch
```

Every value list becomes a `check` constraint of the same shape used for
`reported_concerns` — refuse unknown values, allow null.

**Rollback:** drops exactly those columns. Existing catalog columns untouched.

### `0013_shoe_attribute_evidence.sql` — per-attribute provenance

```sql
create type attribute_source as enum (
  'manufacturer_spec', 'manufacturer_marketing', 'independent_measurement',
  'retailer_provided', 'stride_guide_normalization', 'manual_research',
  'outcome_derived');

create type attribute_review as enum ('unreviewed','accepted','disputed','rejected');

create table shoe_attribute_evidence (
  id               uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_model(id) on delete cascade,
  attribute_name   text not null,
  value_text       text,
  value_numeric    numeric,
  source_type      attribute_source not null,
  source_url       text,
  source_name      text,
  captured_at      timestamptz not null default now(),
  confidence       numeric not null check (confidence >= 0 and confidence <= 1),
  reviewed_by      uuid,
  review_status    attribute_review not null default 'unreviewed',
  superseded_by    uuid references shoe_attribute_evidence(id),
  created_at       timestamptz not null default now()
);

create unique index shoe_attribute_evidence_current
  on shoe_attribute_evidence (product_model_id, attribute_name)
  where superseded_by is null;

create index shoe_attribute_evidence_model on shoe_attribute_evidence (product_model_id);
```

Global like `product_model`, so **no RLS** — it describes shoes, not tenants.
Append-only via `superseded_by`, the same shape as `fitting_feature`. The partial
unique index is what guarantees one current row per attribute.

**Default confidence by source**, applied when a row omits it — proposed, and a
number I would like you to sanity-check:

| Source | Default confidence |
| --- | --- |
| `independent_measurement` | 0.95 |
| `manufacturer_spec` | 0.85 |
| `retailer_provided` | 0.70 |
| `manual_research` | 0.60 |
| `stride_guide_normalization` | 0.55 |
| `manufacturer_marketing` | 0.40 |
| `outcome_derived` | 0.50 |

### `0014_recommendation_candidate.sql` — the persisted explanation

```sql
create table recommendation_candidate (
  id                uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references recommendation(id) on delete cascade,
  organization_id   uuid not null references organization(id) on delete cascade,
  product_model_id  uuid not null references product_model(id),
  rank              integer,                    -- null when eliminated
  eliminated        boolean not null default false,
  overall_score     numeric,                    -- 0..1, null when eliminated
  scoring_version   text not null,
  hard_constraints  jsonb not null default '[]'::jsonb,
  dimensions        jsonb not null default '[]'::jsonb,
  considerations    jsonb not null default '[]'::jsonb,
  catalog_snapshot  jsonb not null default '{}'::jsonb,
  weights_snapshot  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index recommendation_candidate_rec on recommendation_candidate (recommendation_id, rank);
```

`organization_id` denormalised so RLS is a simple predicate — the same move
`location_customer_access` and `report_view` already use to avoid policy
recursion. `enable` + `force` RLS, select/insert only, no update or delete: an
explanation is a record of what was decided, not a working document.

**Eliminated shoes are stored too**, with `eliminated = true` and the failing
constraint in `hard_constraints`. That is what lets the Why panel answer "why
*didn't* you show me the Ghost" — and it is the only way "no size 11 here" can be
explained rather than the shoe silently vanishing.

`catalog_snapshot` freezes the attribute values used; `weights_snapshot` freezes
the weights and confidences. Together with `scoring_version` they make a
historical explanation reconstructible after the catalog or the weights change.

---

## 2 · Scoring formula

Deterministic, reproducible, no model call.

### Per-dimension score

Ordinal scales compare by index distance:

```
score(d) = 1 − |idx(actual) − idx(required)| / (len(scale) − 1)
```

Boolean dimensions score 1 or 0. Set-membership dimensions (use case) score 1 if
the required use is in `use_case`, else 0.

**Direction matters where it should.** For `toe_box_room`, `forefoot_volume` and
`depth`, *more than required* scores 1.0 rather than being penalised — a roomier
toe box than needed is not a worse fit, and symmetric distance would wrongly
punish it. Every asymmetric dimension is listed in the table below.

### Overall

```
                 Σ  w(d) · conf(d) · score(d)
              d ∈ K
overall  =   ─────────────────────────────────          K = dimensions with a known
                 Σ  w(d) · conf(d)                          shoe attribute
              d ∈ K

overall_pct = round(overall × 100)
```

**Unknown attributes leave both sums.** Not scored zero — scoring a null as zero
would punish a shoe for our own research gap, and would make a well-documented
mediocre shoe beat an excellent one we simply have not measured.

`conf(d)` appears in numerator and denominator, so confidence weights *influence*
rather than applying a penalty. A dimension sourced from marketing copy moves the
result less than one from a spec sheet; it does not drag it down.

**Guard:** if `|K| < 3`, no percentage is shown. The card reads *"limited catalog
data for this model"* and the shoe ranks below every scored candidate. A
percentage computed from one dimension is not a percentage.

### Proposed weights

| Dimension | Weight | Compared against | Asymmetric |
| --- | --- | --- | --- |
| `use_case` | 3 | `use_case[]` | — |
| `cushioning` | 3 | `cushioning_level` | — |
| `support` | 3 | `support_level` | — |
| `width_fit` | 3 | `fit_width_tendency` | — |
| `forefoot_room` | 2 | `toe_box_room` / `toe_box_shape` | more is fine |
| `volume` | 2 | `forefoot_volume`, `midfoot_volume` | more is fine |
| `heel_hold` | 2 | `heel_hold`, `heel_counter_structure` | — |
| `orthotic_compatibility` | 2 | `orthotic_compatibility`, `depth` | more is fine |
| `flexibility` | 1 | `forefoot_flexibility` | — |

Weights are persisted per recommendation in `weights_snapshot`, so changing them
later cannot rewrite history.

### Requirement source precedence — the mechanism

```
1 pressure_measurement   2 foot_measurement       3 associate_observation
4 reported_concern       5 prior_fitting          6 aggregate_outcome
```

`buildRequirementProfile()` takes the **highest-priority source per dimension and
never merges downward**. A dimension established at priority 2 is not
re-weighted by priority 4 — it is unreachable. Each requirement record carries
its source, which is what the Why panel labels as *Measured today* / *Observed
during fitting* / *Customer reported*.

---

## 3 · Hard-constraint matrix

A hard constraint **eliminates** and records why. Everything else is a
preference and can never eliminate.

| # | Constraint | Test | Why hard, not weighted |
| --- | --- | --- | --- |
| H1 | **Size availability** | `size_left/right` within `size_low..size_high` | A size 9 shoe is not a size 11 shoe. No amount of cushioning fixes it. |
| H2 | **Width availability** | required width ∈ `widths_stocked` | A 2E foot in a B last is not a fit, it is a return. |
| H3 | **Stocked here** | `stocked = true` | Cannot sell what is not on the wall. |
| H4 | **Safety toe** | required ⇒ `safety_toe = true` | A workplace requirement, not a preference. |
| H5 | **Removable insole** | orthotic required ⇒ `removable_insole = true` | The orthotic physically does not go in. |
| H6 | **Category exclusion** | `category ∉ excludeCategories` | Wrong tool for the stated purpose. |

**Deliberately NOT hard** — these are preferences today and the current code is
wrong to treat them as fatal:

`toe_box_shape` · `heel_structure` · `cushioning_level` · `support_level` ·
`volume` · `flexibility` · every geometry attribute.

Today's `.filter(c => c.misses.length === 0)` makes all of these eliminating.
That inversion goes.

**Size is measured per foot.** H1 uses the **larger** of `size_left`/`size_right`,
matching the existing fitting rule that the larger foot is fitted. When the two
differ by ≥ 0.5, that appears as a *consideration*, not a constraint.

**H2 depends on a requirement that may be absent.** If width was never measured,
H2 does not apply — an unmeasured foot must not eliminate the whole wall. That is
consistent with unknown leaving the denominator rather than scoring zero.

---

## 4 · Proposed 24-model seed list

**Read this section before approving it.** I want to be exact about what I can
and cannot honestly provide.

I can name real, current product *families* and classify them by category, use
and — as Stride Guide's own judgement — support and cushioning level. I **cannot**
supply stack heights, drops, weights or last shapes from memory with the
reliability this data asset requires. Getting "Ghost, 12 mm drop" wrong once
teaches the engine something false and, worse, teaches it confidently.

So the proposal is:

| What gets seeded | Source recorded | Confidence | Review status |
| --- | --- | --- | --- |
| brand, model family, category, primary use | `manual_research` | 0.60 | `unreviewed` |
| `support_level`, `cushioning_level` (engine vocabulary) | `stride_guide_normalization` | 0.55 | `unreviewed` |
| `safety_toe`, `waterproof`, `slip_resistant` where definitional to the model family | `manual_research` | 0.60 | `unreviewed` |
| **all numeric geometry** — stack, drop, weight | **not seeded** | — | — |
| **all fine geometry** — last shape, heel width, volumes | **not seeded** | — | — |

Every seeded row lands as `review_status = 'unreviewed'`, which the Why panel
surfaces as *limited verified data*. **Model year and version numbers are
omitted**, because those are exactly the detail I would get subtly wrong.

### The list

| # | Brand | Model family | Category | Support | Cushioning |
| --- | --- | --- | --- | --- | --- |
| 1 | Brooks | Ghost | running_neutral | neutral | plush |
| 2 | Brooks | Adrenaline GTS | running_stability | stability | plush |
| 3 | Brooks | Beast | running_stability | max_support | plush |
| 4 | Brooks | Addiction Walker | walking_comfort | max_support | moderate |
| 5 | HOKA | Bondi | running_neutral | neutral | max |
| 6 | HOKA | Clifton | running_neutral | neutral | plush |
| 7 | HOKA | Arahi | running_stability | stability | plush |
| 8 | HOKA | Gaviota | running_stability | max_support | max |
| 9 | ASICS | Gel-Kayano | running_stability | stability | plush |
| 10 | ASICS | Gel-Nimbus | running_neutral | neutral | plush |
| 11 | New Balance | 990 | walking_comfort | light_stability | moderate |
| 12 | New Balance | 928 | walking_comfort | max_support | moderate |
| 13 | New Balance | Fresh Foam 1080 | running_neutral | neutral | plush |
| 14 | Saucony | Guide | running_stability | stability | moderate |
| 15 | Saucony | Triumph | running_neutral | neutral | plush |
| 16 | Altra | Lone Peak | hiking | neutral | moderate |
| 17 | Altra | Torin | running_neutral | neutral | plush |
| 18 | Merrell | Moab | hiking | light_stability | moderate |
| 19 | Dansko | Professional | work_support | max_support | firm |
| 20 | Timberland PRO | Pit Boss | work_safety | max_support | moderate |
| 21 | Skechers Work | Sure Track | work_safety | light_stability | moderate |
| 22 | Birkenstock | Arizona | casual_comfort | light_stability | firm |
| 23 | Vionic | Walker | walking_comfort | stability | moderate |
| 24 | OOFOS | OOriginal | casual_comfort | neutral | max |

Coverage check: 8 neutral / 7 stability / 5 max_support / 4 light_stability;
firm 3 / moderate 10 / plush 9 / max 3; running 9, walking 5, work 3, hiking 2,
casual 3, comfort recovery 1. Enough spread to exercise every comparator and both
directions of every asymmetric dimension.

### What this means for the pilot

With geometry null, roughly 4–5 dimensions are scorable per shoe — above the
`|K| ≥ 3` guard, so real percentages appear, and the Why panel honestly says the
data is thin. **A curation pass with actual spec sheets is a separate task**, and
the schema is built so that pass *raises* confidence rather than replacing
guesses that were already presented as facts.

If you would rather I not seed brand and model names at all until a human has
checked them, say so — I can seed anonymised placeholder models that exercise the
same scoring paths without asserting anything about real products.

---

## 5 · What happens after approval

In order: 0012 → 0013 → 0014, each applied to a scratch database first and
rolled back; then requirement profile, constraints, scorer, explanation
persistence, Why panel, tests, browser golden path, `npm run verify`, bundle
regeneration.

**Stopping here for approval before any schema change.**
