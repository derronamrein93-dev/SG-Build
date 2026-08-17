# 05 · Data Model

Postgres (Supabase). Every table gets `id uuid pk default gen_random_uuid()`,
`created_at timestamptz default now()`, `updated_at timestamptz`. Those three are
omitted from the tables below.

---

## 1. Entity map

```
  store ──┬── associate ──────────────┐
          │                           │
          ├── customer ── consent_record
          │      │                    │
          │      └──────────┐         │
          │                 ▼         ▼
          ├──────────► fitting ◄──────┘
          │              │
          │              ├── fit_assessment   (1:1)
          │              ├── recommendation   (1:1)
          │              ├── fit_outcome      (1:1, optional)
          │              ├── follow_up        (1:n)
          │              └── scan             (1:n, hardware — reserved)
          │
          ├── store_inventory_item ──► shoe_model (canonical, global)
          └── pilot_feedback
```

**Nine entities were requested. Twelve are specified.** The three additions —
`consent_record`, `fit_outcome`, and the `shoe_model` / `store_inventory_item`
split — each prevent a migration that would otherwise be painful later. Reasons
are given inline.

---

## 2. `store`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| name | text | ✅ | Appears on every report |
| legal_name | text | | For agreements |
| address_line1 / city / region / postal_code / country | text | | Printed on report |
| phone | text | ✅ | Printed on report |
| email | text | ✅ | Report reply-to |
| logo_url | text | | Storage URL; falls back to a name wordmark |
| timezone | text | ✅ | Drives follow-up due dates. Getting this wrong makes reminders fire at 3am |
| size_unit | enum | ✅ | `us` · `uk` · `eu` — default `us` |
| store_type | enum | ✅ | `running` · `comfort` · `work` · `orthopedic` · `sporting_goods` · `independent` · `chain` — biases default categories |
| plan | enum | ✅ | `pilot` · `active` · `paused` |
| settings | jsonb | | PIN requirement, report toggles, default follow-up intervals |

## 3. `associate`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| store_id | uuid fk → store | ✅ | |
| first_name | text | ✅ | Printed on report ("Fitted by Denise") |
| last_name | text | | |
| display_initials | text | | Avatar fallback |
| role | enum | ✅ | `associate` · `manager` · `owner` — gates the performance snapshot |
| pin_hash | text | | Optional, hashed, never plaintext |
| auth_user_id | uuid | | Null for floor staff on a shared tablet; set for managers/owners with real logins |
| active | bool | ✅ | Default true; deactivate rather than delete to preserve attribution |

## 4. `customer`

Holds **identity only**. Fit data lives in `fitting` and its children, referenced
by ID — the separation promised publicly, enforced structurally.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| store_id | uuid fk | ✅ | Customers belong to a store, not to Stride Guide |
| first_name | text | ✅ | |
| last_name | text | ✅ | |
| phone | text | ✅* | **Dedupe key.** Unique per store (partial index where not null) |
| phone_normalized | text | | E.164, generated — match on this, display the other |
| email | text | | Optional by design |
| age_range | enum | | `under_18` … `75_plus` · `undisclosed` |
| is_minor | bool | | Derived; switches consent copy and suppresses upsells |
| notes | text | | Non-fit context ("prefers morning appointments") |
| anonymous | bool | ✅ | True for fittings where the customer declined to be saved; name fields null |
| deleted_at | timestamptz | | Soft delete for erasure requests; children cascade |

\* Not required when `anonymous = true`.

**Index:** `unique (store_id, phone_normalized) where phone_normalized is not null and deleted_at is null`

## 5. `consent_record` *(added)*

**Why separate:** a boolean on `customer` cannot answer "what exactly did they
agree to, when, and who witnessed it." That question gets asked exactly once, by
a lawyer, at the worst possible time. It is three columns of insurance.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| customer_id | uuid fk | ✅ | |
| type | enum | ✅ | `fit_data` · `marketing_email` · `marketing_sms` |
| granted | bool | ✅ | Revocation writes a new row; never update in place |
| text_version | text | ✅ | e.g. `consent-v1.0` — the exact wording shown |
| captured_by_associate_id | uuid fk | ✅ | |
| captured_at | timestamptz | ✅ | |
| method | enum | ✅ | `tablet_checkbox` · `verbal_recorded` · `web_form` |

## 6. `fitting`

The spine of the product.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| store_id | uuid fk | ✅ | |
| customer_id | uuid fk | | Null for anonymous fittings |
| associate_id | uuid fk | ✅ | |
| status | enum | ✅ | `in_progress` · `completed` · `abandoned` — drives dashboard resume |
| visit_number | int | ✅ | Computed at creation; drives "Visit 2" on the report |
| started_at / completed_at | timestamptz | ✅ / | Difference = the 3-minute metric |
| **Intake fields** | | | |
| shopping_purpose | enum | ✅ | |
| current_shoe_problem | enum[] | | |
| discomfort_area | enum[] | | |
| discomfort_timing | enum | | |
| activity_level | enum | | |
| standing_hours_per_day | enum | | |
| current_shoe_brand / current_shoe_model | text | | Free text tolerated; reconciled to `shoe_model` later |
| current_shoe_age | enum | | |
| fit_priority | enum[] | | Max 2, order preserved |
| previous_return_reason | enum | | |
| uses_orthotics | enum | | |
| shoe_wear_concern | enum | | |
| intake_notes | text | | |
| need_summary | text | | Generated; stored so the report is reproducible |
| risk_flags | text[] | | Generated |
| device_id | text | | Which tablet — useful for debugging a specific store |
| draft_synced_at | timestamptz | | Local-first reconciliation |

**Intake lives on `fitting` rather than in its own table** because it is 1:1,
always created together, and always read together. A separate table buys nothing
and costs a join on the hottest path.

## 7. `fit_assessment`

1:1 with fitting. **This schema is the hardware schema** — see
[09](09-build-plan.md#4-hardware-integration-plan).

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_id | uuid fk unique | ✅ | |
| size_left / size_right | numeric(4,1) | ✅ | In the store's `size_unit` |
| size_unit | enum | ✅ | Denormalized — a store can change its setting later |
| width | enum | | `narrow` · `standard` · `wide` · `extra_wide` · `unsure` |
| width_asymmetry | bool | | |
| arch_type | enum | | `low` · `medium` · `high` · `unknown` |
| foot_shape | enum[] | | |
| pronation_tendency | enum | | `outward` · `neutral` · `mild_inward` · `strong_inward` · `unknown` |
| heel_slip_risk | enum | | |
| toe_box_issue | enum[] | | |
| wear_pattern | enum | | |
| balance_concern | enum | | |
| pressure_concern | enum[] | | Manual today, sensor-derived later |
| assoc_support_level / assoc_cushioning_level / assoc_category / assoc_insole | enum | | The associate's own call, captured **before** they see the final recommendation |
| assessment_notes | text | | |
| **source** | jsonb | ✅ | **Per-field provenance:** `{"arch_type":"manual","pressure_concern":"sensor"}`. The single most important column for the hardware transition |
| measured_at | timestamptz | | |

## 8. `recommendation`

Immutable once written. A change writes a new row, so the report always matches
what was actually shown.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_id | uuid fk | ✅ | |
| support_level / cushioning_level / width / volume / toe_box / heel_fit / category / insole | enum | ✅ | The fit profile |
| flags | text[] | | `size_asymmetry`, `referral_suggested`, … |
| confidence_score | int | ✅ | 0–100 |
| confidence_band | enum | ✅ | `high` · `moderate` · `low` |
| fired_rule_ids | text[] | ✅ | Reproducibility |
| rules_version | text | ✅ | e.g. `rules-1.3.0` |
| score_detail | jsonb | | Full attribute tallies — invaluable when an associate says "this is wrong" |
| talking_points | text[] | ✅ | Rendered at generation time |
| rationale | text | ✅ | Customer-facing prose |
| products_considered | uuid[] | | → `store_inventory_item` |
| products_avoided | text[] | | Characteristics, never brand names |
| overridden | bool | ✅ | |
| override_fields | jsonb | | `{"support_level":{"from":"stability","to":"neutral"}}` |
| override_reason | enum | | `customer_preference` · `associate_judgment` · `not_in_stock` · `budget` · `other` |

## 9. `shoe_model` *(canonical, global)* and `store_inventory_item` *(per store)*

**Why split:** fit characteristics of a model are universal and are Stride
Guide's asset; price, stock and SKU are per store and change constantly. One
table would force every store to re-describe the same shoe and would prevent
knowledge from compounding across stores.

### `shoe_model`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| brand | text | ✅ | |
| model | text | ✅ | |
| variant | text | | "GTX", "4E" |
| model_year | int | | |
| category | enum | ✅ | Matches the recommendation vocabulary |
| use_case | enum[] | ✅ | |
| support_level | enum | ✅ | Same scale as recommendations — that alignment is what makes matching trivial |
| cushioning_level | enum | ✅ | |
| width_options | enum[] | ✅ | |
| toe_box_shape | enum | | `tapered` · `standard` · `round_roomy` · `wide_round` |
| heel_structure | enum | | `soft` · `standard` · `structured` |
| flexibility | enum | | `flexible` · `moderate` · `rigid` |
| volume | enum | | `low` · `standard` · `high` |
| drop_mm | int | | |
| weight_g | int | | |
| removable_insole | bool | ✅ | Gates every orthotic recommendation |
| safety_toe | bool | | Work category |
| slip_resistant | bool | | Work category |
| waterproof | bool | | |
| best_for | text[] | ✅ | Plain phrases used verbatim in the UI |
| avoid_for | text[] | ✅ | |
| msrp | numeric(8,2) | | |
| data_source | enum | ✅ | `curated` · `store_csv` · `manufacturer` — trust ranking |
| verified_at | timestamptz | | |

### `store_inventory_item`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| store_id | uuid fk | ✅ | |
| shoe_model_id | uuid fk | ✅ | |
| sku | text | | |
| retail_price | numeric(8,2) | | |
| widths_stocked | enum[] | | Prevents recommending a width the store cannot sell |
| size_range_low / high | numeric(4,1) | | |
| active | bool | ✅ | |
| notes | text | | "House favorite for nurses" |

## 10. `fit_outcome` *(added)*

**Why it exists:** this is the table that turns FitOS from a workflow tool into a
data asset. Without it there is no way to know whether any recommendation was
ever right, and no training set for anything later.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_id | uuid fk unique | ✅ | |
| outcome | enum | ✅ | `purchased` · `purchased_other` · `considering` · `no_purchase` · `ordered` |
| purchased_item_id | uuid fk | | → `store_inventory_item` |
| purchased_size | numeric(4,1) | | |
| insole_attached | bool | ✅ | The revenue metric |
| insole_type | enum | | |
| matched_recommendation | bool | | Computed: did the purchase match the recommended profile |
| returned | bool | | Set later, manually or via follow-up |
| return_reason | enum | | The most valuable field in the entire schema once volume exists |
| satisfaction | enum | | From follow-up response: `great` · `ok` · `not_working` |

## 11. `follow_up`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| store_id / customer_id / fitting_id | uuid fk | ✅ | |
| type | enum | ✅ | `comfort_check_7d` · `check_in_30d` · `rescan_90d` · `growth_check_90d` · `custom` |
| channel | enum | ✅ | `in_store_reminder` · `email` — SMS reserved |
| due_at | timestamptz | ✅ | Computed in store timezone |
| status | enum | ✅ | `scheduled` · `sent` · `completed` · `snoozed` · `cancelled` |
| completed_by_associate_id | uuid fk | | |
| response | enum | | `positive` · `neutral` · `issue` · `no_response` |
| response_note | text | | |

## 12. `pilot_feedback`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| store_id / associate_id | uuid fk | ✅ | |
| fitting_id | uuid fk | | Auto-attached when raised inside a fitting |
| type | enum | ✅ | `bug` · `confusing` · `too_slow` · `wrong_recommendation` · `idea` · `praise` |
| screen | text | ✅ | Auto-captured |
| note | text | | |
| input_snapshot | jsonb | | **Full input state for `wrong_recommendation`** — makes each report a reproducible test case |
| status | enum | ✅ | `new` · `triaged` · `resolved` · `wont_fix` |

## 13. `scan` *(reserved — hardware)*

Specified now, built later, so nothing in v1 contradicts it.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_id | uuid fk | ✅ | A scan is part of a fitting, never standalone |
| device_serial | text | ✅ | |
| capture_type | enum | ✅ | `static_stance` · `weight_shift` · `walk` |
| pressure_matrix | jsonb / storage ref | ✅ | Raw frames go to object storage, not Postgres |
| derived | jsonb | ✅ | Sensor-derived values in the **same vocabulary** as `fit_assessment` |
| quality_score | int | | |
| captured_at | timestamptz | ✅ | |

---

## 14. Access, retention, and privacy

| Concern | Decision |
| --- | --- |
| Multi-tenancy | Row-level security on `store_id` for every table. Enable it on day one — retrofitting RLS across a live schema is miserable. |
| Floor staff auth | The tablet authenticates as the store; the associate is selected, not logged in. Associate identity is attribution, not a security boundary. |
| PII isolation | Names, phone and email live only on `customer`. Fit tables reference `customer_id`. |
| Exports | Default export excludes direct identifiers and emits `customer_ref` instead. Identified export is a separate, logged action. |
| Retention | Fit data retained while the store is active. Customer erasure request → soft delete + identity scrub, preserving anonymized fit records for aggregate learning. Say this plainly in the consent text. |
| Cross-store sharing | Customers are **not** shared between stores, including within a chain, without explicit configuration. Assuming otherwise is a privacy incident waiting to happen. |
| Audit | `recommendation` and `consent_record` are append-only. |

---

**Next:** [06 · Tech Stack & Shoe Data Strategy](06-tech-and-data-strategy.md)
