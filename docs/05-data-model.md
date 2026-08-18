# 05 · Data Model

Postgres (Supabase). Every table gets `id uuid pk default gen_random_uuid()`,
`created_at timestamptz default now()`, `updated_at timestamptz`. Those three are
omitted from the tables below.

> **Revision 2.** Tenancy moved from `store` to `organization → location`;
> phone identity moved to keyed-hash lookup; provenance made first-class;
> the canonical fit feature model separated from the manual assessment; catalog
> split three ways; device and report entities added. See
> [00-revision-log](00-revision-log.md).

---

## 0. Where this sits

This document is the storage layer for the canonical
[system map](README.md#system-map). Read the map first — it is the shape; this is
the shape written down in tables.

The single most important line on that map is the one where **Manual
Observations** and **Derivation Engine** converge on **Canonical Fit Features**.
Everything below that convergence (§10 onward) is written once and survives the
hardware; everything above it can change source without disturbing anything
below.

---

## 1. Tenancy: organization → location

**The UI says "store." The database never does.** Every future customer shape —
independent shop, multi-location chain, franchise, running clinic, orthotics
shop, enterprise retailer, mobile fitting event, pop-up — is an
`organization` with one or more `location` records. A single-store retailer is
simply an organization with one location, and the UI hides the distinction
entirely.

This is the cheapest decision in the document today and one of the most
expensive to retrofit later.

```
  organization ──┬── location ──┬── user (staff)
                 │              ├── device_installation ──► device
                 │              ├── location_inventory ──► product_variant ──► product_model
                 │              │
                 │              └── customer ── consent_record
                 │                      │
                 │                      └──► fitting_session ──┬── assessment    (1:1, manual)
                 │                             ├── scan                  (1:n, hardware, immutable)
                 │                             │     └── scan_derivation (1:n, re-runnable)
                 │                             ├── fitting_feature       (1:n, canonical + provenance)
                 │                             ├── recommendation        (1:n, immutable versions)
                 │                             ├── outcome               (1:1, optional)
                 │                             ├── report                (1:n) ── report_view (1:n)
                 │                             ├── assessment_delta      (1:1, vs prior session)
                 │                             └── follow_up             (1:n)
                 │
                 └── pilot_feedback
```

**Customer and staff are owned by a location**, per the approved
[system map](README.md#system-map). `organization_id` is carried on both as a
denormalized column — it drives RLS and org-level rollups, and it is what makes
sharing *possible* — but the owning row is the location.

Chain-wide recognition is therefore **opt-in, not the default**:
`organization.customer_visibility` defaults to `location`, and a chain that wants
a customer fitted at one door recognized at another sets it to `organization`.
That ordering is the safer one — a retailer who has not thought about
cross-location customer data does not accidentally get it, and a customer's
expectation ("I gave this to *this* shop") is the default behavior. Open
question 11 in [09 §7](09-build-plan.md#7-open-questions) is now a question about
when to opt in, not about what the schema does.

---

## 2. `organization`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| name | text | ✅ | |
| legal_name | text | | |
| org_type | enum | ✅ | `independent` · `chain` · `franchise` · `clinic` · `orthotics` · `enterprise` · `events` |
| plan | enum | ✅ | `pilot` · `design_partner` · `active` · `paused` |
| customer_visibility | enum | ✅ | `location` (**default**) · `organization` — whether a customer's fit history is visible at sibling locations. Opt-in, not opt-out |
| data_owner_terms_version | text | ✅ | Which data-rights agreement this org signed (see open question 10) |
| settings | jsonb | | Org-wide defaults |

## 3. `location`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| organization_id | uuid fk | ✅ | |
| name | text | ✅ | The "store name" on the report |
| address_line1 / city / region / postal_code / country | text | | Printed on report |
| phone / email | text | ✅ | Printed on report; report reply-to |
| logo_url | text | | Falls back to org logo, then a wordmark |
| timezone | text | ✅ | Drives follow-up due dates |
| size_unit | enum | ✅ | `us` · `uk` · `eu` |
| retail_focus | enum[] | ✅ | `running` · `comfort` · `work` · `orthopedic` · `sporting_goods` — biases default categories |
| pos_system | text | | **Captured in Phase 0.** Free text until integrations exist |
| inventory_source | enum | | `none` · `csv` · `pos_export` · `api` — captured in Phase 0 |
| tracks_associate_attribution | bool | | Captured in Phase 0; affects reporting expectations |
| network_quality | enum | | `good` · `variable` · `poor` — captured in Phase 0; drives offline hardening priority |
| active | bool | ✅ | |

## 4. `user` (staff)

Renamed from `associate` — managers, owners and, later, support staff are the
same entity with a different role.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| **location_id** | uuid fk | ✅ | **Owning location** — staff belong to a door |
| organization_id | uuid fk | ✅ | Denormalized for RLS and org rollups |
| first_name | text | ✅ | Printed on report ("Fitted by Denise") |
| last_name | text | | |
| role | enum | ✅ | `associate` · `manager` · `owner` · `org_admin` |
| pin_hash | text | | Argon2id. Optional per location |
| auth_user_id | uuid | | Null for floor staff on a shared tablet; set for real logins |
| active | bool | ✅ | Deactivate, never delete — attribution must survive |

`user_location` (join table) remains for the **exception**: someone who genuinely
covers two doors. It grants additional locations; it does not change ownership.
Without it, a shared employee needs duplicate records and their attribution
splits in two — which is why the exception exists even though the default is
location-owned.

## 5. `customer`

Identity only. Fit data lives on `fitting_session` and its children.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| **location_id** | uuid fk | ✅ | **Owning location** — where the customer was created |
| organization_id | uuid fk | ✅ | Denormalized for RLS and org rollups; enables opt-in sharing |
| first_name / last_name | text | ✅* | |
| **phone_lookup_hash** | bytea | | **HMAC-SHA256(server_key, E.164).** The only indexed phone representation. See §6 |
| **phone_encrypted** | bytea | | Reversible, envelope-encrypted. Written **only** when consent to contact exists |
| phone_last4 | text | | Display/disambiguation only ("•••-1212") |
| phone_key_version | smallint | | Which HMAC key version produced the hash — makes rotation possible |
| email_lookup_hash | bytea | | Same treatment |
| email_encrypted | bytea | | |
| age_range | enum | | `under_18` … `75_plus` · `undisclosed` |
| is_minor | bool | | Switches consent copy, suppresses upsells |
| notes | text | | Non-fit context |
| identification_method | enum | ✅ | `phone` · `name_dob` · `loyalty_id` · `anonymous` — see open question 9 |
| anonymous | bool | ✅ | Fitting without stored identity |
| deleted_at | timestamptz | | Soft delete; identity scrubbed, fit records anonymized |

\* Not required when `anonymous = true`.

**Index:** `unique (location_id, phone_lookup_hash) where phone_lookup_hash is not null and deleted_at is null`

Dedupe is scoped to the owning location, matching ownership. When
`customer_visibility = 'organization'`, lookup widens to the organization and a
match at a sibling location offers the existing record instead of creating a
second one — the one place the policy field changes behavior an associate can
see.

## 6. Phone identity — why hashed, and what it costs

A phone number is the dedupe key and also the most sensitive identifier in the
system. Storing it in plaintext makes every backup, export and analytics sink a
liability.

```
  502-555-1212
      ↓ normalize
  +15025551212                          → phone_last4 = "1212"  (display only)
      ↓ HMAC-SHA256 with server-side key
  phone_lookup_hash                     → indexed, exact-match lookup
      ↓ envelope encryption (only if contact consent)
  phone_encrypted                       → decrypt only to send a report
```

- **HMAC, not bare SHA-256.** The North American phone space is ~10^10 — a plain
  hash is a weekend of brute force. The keyed construction makes the rainbow
  table useless without the key.
- **The key lives outside the database** (Supabase Vault / KMS env secret), so a
  database dump alone cannot reverse or enumerate the identifiers.
- **`phone_key_version` enables rotation.** Rotating means re-deriving hashes
  from `phone_encrypted`; rows without contact consent cannot be re-derived and
  are re-keyed at next visit. Accept this cost knowingly.

**The UX consequence, stated plainly:** hashed lookup is **exact-match only**.
No partial or prefix search on phone. Screen 2 searches the full number, or by
name, and [02 §5](02-ux-spec.md#5-screen-2--customer-find-or-create) reflects
that. This is a real trade and it is worth making.

## 7. `consent_record`

One row per consent event per type. Never a single `consent = true` boolean.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| customer_id | uuid fk | ✅ | |
| location_id | uuid fk | ✅ | Where consent was taken — jurisdiction matters |
| type | enum | ✅ | `fit_history_storage` · `receive_report` · `marketing_email` · `marketing_sms` · `privacy_ack` |
| granted | bool | ✅ | Revocation writes a **new row**; rows are never updated |
| consent_text_version | text | ✅ | Exact wording shown, e.g. `consent-fit-v1.0` |
| privacy_policy_version | text | ✅ | Policy in force at capture |
| method | enum | ✅ | `tablet_checkbox` · `verbal_attested` · `web_form` · `written` |
| captured_by_user_id | uuid fk | ✅ | |
| captured_at | timestamptz | ✅ | |
| device_id | text | | Which tablet |

Current state is a view over the latest row per `(customer_id, type)`.
`marketing_sms` is separate from every other type and is never bundled into a
single checkbox.

## 8. `fitting_session`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| organization_id / location_id | uuid fk | ✅ | |
| customer_id | uuid fk | | Null for anonymous |
| user_id | uuid fk | ✅ | The fitter |
| status | enum | ✅ | `draft` · `in_progress` · `completed` · `voided` |
| void_reason | enum | | `test` · `mistaken_start` · `customer_withdrew` · `duplicate` |
| visit_number | int | ✅ | Computed at completion |
| started_at / completed_at | timestamptz | ✅ / | |
| time_to_recommendation_ms | int | | The KPI that matters, measured not estimated |
| **Intake fields** | | | shopping_purpose, current_shoe_problem[], discomfort_area[], discomfort_timing, activity_level, standing_hours_per_day, current_shoe_brand/model, current_shoe_age, fit_priority[], previous_return_reason, uses_orthotics, shoe_wear_concern, intake_notes |
| need_summary | text | | Generated, stored for reproducibility |
| risk_flags | text[] | | Generated |
| device_id | text | | Tablet identity |
| draft_saved_at / draft_synced_at | timestamptz | | Debounced autosave bookkeeping |
| assessment_schema_version | text | ✅ | Which intake/assessment schema captured this |

**Only `completed` sessions count as historical fittings.** A `draft` that was
opened by accident never pollutes history, metrics, or the customer's record.

## 9. `assessment` — human observations

1:1 with the session. **This is one input to the canonical feature model, not the
model itself.**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_session_id | uuid fk unique | ✅ | |
| size_left / size_right | numeric(4,1) | ✅ | |
| size_unit | enum | ✅ | Denormalized |
| width / width_asymmetry | enum / bool | | |
| arch_type | enum | | `low` · `medium` · `high` · `unknown` |
| foot_shape | enum[] | | |
| pronation_tendency | enum | | `outward` · `neutral` · `mild_inward` · `strong_inward` · `unknown` |
| heel_slip_risk / toe_box_issue[] / wear_pattern / balance_concern / pressure_concern[] | enum | | |
| assoc_support_level / assoc_cushioning_level / assoc_category / assoc_insole | enum | | The fitter's own call, captured **before** the engine's output is shown |
| assessment_notes | text | | |
| measured_at | timestamptz | | |

## 10. The canonical fit feature model *(replaces "the assessment schema is the sensor schema")*

```
  assessment (human observation) ──┐
                                   ├──► fitting_feature (canonical, versioned, provenanced)
  scan_derivation (sensor)      ───┘                    │
                                                        ▼
                                              recommendation engine
```

A human can say `arch_type = low`. A sensor produces `medial_pressure_ratio =
0.63`, a center-of-pressure track, a contact-area map and a load distribution.
**Forcing sensor output into the human schema would throw away everything that
makes the hardware worth building.** Instead both feed a shared, extensible
feature model.

### `fitting_feature`

One row per feature per session. This table is the recommendation engine's only
input, and its provenance columns are first-class — not a loose JSONB blob.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_session_id | uuid fk | ✅ | |
| feature_key | text | ✅ | From the versioned feature dictionary, e.g. `arch_type`, `medial_pressure_ratio` |
| value_categorical | text | | For enum features |
| value_numeric | numeric | | For measured features |
| unit | text | | `ratio` · `kPa` · `mm` · `pct` |
| **source_type** | enum | ✅ | `manual` · `sensor_derived` · `intake_inferred` · `imported` · `default` |
| **source_record_id** | uuid | | The `assessment` or `scan_derivation` row it came from |
| **algorithm_version** | text | | Derivation algorithm that produced it (sensor only) |
| **quality** | numeric | | 0–1 signal quality / capture confidence — a property of the measurement, not of the recommendation |
| **captured_at** | timestamptz | ✅ | |
| **overridden_by_user_id** | uuid fk | | Set when a human replaces a sensor value |
| **override_reason** | enum | | `disagrees_with_observation` · `poor_capture` · `customer_input` · `other` |
| superseded_by | uuid | | Feature rows are append-only; corrections supersede |

**Unique:** `(fitting_session_id, feature_key) where superseded_by is null`

### `feature_schema_version`

The dictionary of valid `feature_key`s, their types, units and allowed values,
versioned. Rules declare which schema version they were authored against.
**Additive-only within a major version:** new features may be added, existing
features never change meaning or drop enum values. That is the actual
compatibility promise — not "rules never change."

## 11. `scan` — raw capture *(hardware; immutable)*

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_session_id | uuid fk | ✅ | A scan is always part of a session |
| device_id / device_installation_id | uuid fk | ✅ | |
| firmware_version / calibration_version / hardware_revision | text | ✅ | Copied at capture time, never joined live |
| capture_type | enum | ✅ | `static_stance` · `weight_shift` · `walk` |
| raw_uri | text | ✅ | Object storage. Pressure frames + synchronized load-cell series |
| raw_checksum | text | ✅ | Integrity |
| sample_rate_hz / frame_count | int | | |
| total_load_measured | numeric | | Load cells, captured **simultaneously** with the pressure matrix |
| capture_quality | numeric | | |
| captured_at | timestamptz | ✅ | |

**Raw captures are immutable.** Never overwritten, never edited, never deleted
while the customer record lives. Storage is cheap; a customer's foot at a moment
in time is not repeatable.

## 12. `scan_derivation` — reprocessable interpretation

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| scan_id | uuid fk | ✅ | |
| algorithm_version | text | ✅ | |
| derived | jsonb | ✅ | Peak pressure, contact area, COP path, medial/lateral ratio, L/R load split, normalized distribution |
| quality_metrics | jsonb | | Per-metric confidence |
| is_current | bool | ✅ | Exactly one current derivation per scan |
| derived_at | timestamptz | ✅ | |

```
  raw scan (immutable) ──► algorithm v1 ──► derivation v1 ──► features
                      └──► algorithm v2 ──► derivation v2 ──► better features
```

Improving the algorithm re-reads history. Every past customer benefits from
next year's math without being re-scanned — which is only possible because the
raw capture was never discarded.

## 13. `recommendation`

Immutable. A change writes a new row.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_session_id | uuid fk | ✅ | |
| fit_profile | jsonb | ✅ | support_level, cushioning_level, width, volume, toe_box, heel_fit, category, insole |
| flags | text[] | | |
| **evidence_strength** | enum | ✅ | `high` · `moderate` · `low` — see [03 §3](03-recommendation-engine.md#3-evidence-strength-not-confidence) |
| evidence_detail | jsonb | ✅ | Which signals agreed, which conflicted, what was missing |
| **recommendation_engine_version** | text | ✅ | The evaluator |
| **rule_set_version** | text | ✅ | The rule data |
| **catalog_version** | text | ✅ | Product knowledge snapshot used for matching |
| **feature_schema_version** | text | ✅ | Feature dictionary in force |
| **assessment_schema_version** | text | ✅ | Capture schema in force |
| fired_rule_ids | text[] | ✅ | |
| feature_snapshot | jsonb | ✅ | Frozen copy of the features that produced this — reproducibility does not depend on the feature rows staying unchanged |
| talking_points | text[] | ✅ | |
| rationale | text | ✅ | |
| products_considered | uuid[] | | → `product_variant` |
| products_avoided | text[] | | Characteristics, never competitor product names |
| overridden | bool | ✅ | |
| override_fields | jsonb | | `{"support_level":{"from":"stability","to":"neutral"}}` |
| override_reason | enum | | `customer_preference` · `associate_judgment` · `not_in_stock` · `budget` · `other` |

Those five version columns are what make a recommendation from August 2026
reproducible after the engine changes in 2027.

## 14. `assessment_delta` — what changed since last visit

Structured, not recomputed on the fly at render time. Longitudinal change is the
moat; it deserves to be queryable.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_session_id | uuid fk unique | ✅ | The later session |
| previous_session_id | uuid fk | ✅ | |
| interval_days | int | ✅ | |
| changes | jsonb | ✅ | Per feature: `{feature_key, from, to, direction, magnitude, source_type_before, source_type_after}` |
| material_change | bool | ✅ | Passed a per-feature significance threshold |
| narrative | text | | Plain-language summary, generated once and stored |

Computed on session completion from the two immutable feature snapshots, so a
delta is stable even if a later correction supersedes a feature.

## 15. Catalog: three layers

**Global product knowledge and retailer assortment are different datasets** and
must never share a table.

### `product_model` — global, brand-level

Brand · model · variant line · model_year · category · use_case[] ·
support_level · cushioning_level · toe_box_shape · heel_structure · flexibility ·
volume · drop_mm · weight_g · **removable_insole** · safety_toe ·
slip_resistant · waterproof · best_for[] · avoid_for[] · msrp ·
`data_source` (`curated` · `retailer` · `manufacturer`) · `verified_at` ·
`catalog_version`.

Fit attributes use **the same vocabulary as the recommendation output**, so
matching is comparison rather than translation.

### `product_variant` — the sellable thing

`product_model_id` · gender · size · width · colorway · upc · manufacturer_sku.
"Nike Pegasus 43 / Men's / 10.5 / 2E / Black."

### `location_inventory` — retailer assortment

`location_id` · `product_variant_id` · retailer_sku · retail_price ·
`stocked` (bool) · quantity (nullable — presence matters more than count in v1) ·
`source` (`manual` · `csv` · `pos`) · `last_synced_at` · notes.

**Quantity is optional; assortment is not.** Recommending a width the store does
not carry is the fastest way to lose an associate's trust, and that only requires
knowing what is on the wall — not how many.

## 16. `outcome`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_session_id | uuid fk unique | ✅ | |
| outcome | enum | ✅ | `purchased` · `purchased_other` · `considering` · `no_purchase` · `ordered` |
| purchased_variant_id | uuid fk | | |
| recommended_vs_purchased | enum | | `match` · `partial` · `different` — computed |
| insole_attached | bool | ✅ | |
| insole_type | enum | | |
| sale_value | numeric(10,2) | | Optional; many pilots will not share it |
| returned / return_reason / returned_at | bool / enum / ts | | Set later, by follow-up or POS |
| satisfaction | enum | | From follow-up: `great` · `ok` · `not_working` |

## 17. `report` and `report_view`

The report is a **record**, not a file. The PDF or page is a rendering of it.

`report`: `fitting_session_id` · `customer_id` · `report_version` ·
`template_version` · `access_token_hash` · `expires_at` · `revoked_at` ·
`generated_at` · `emailed_at` · `printed_at` · `content_snapshot` (jsonb — what
was actually shown).

`report_view`: `report_id` · `viewed_at` · `user_agent_class` · `referrer_class`.
No IP, no fingerprint.

Access resolves `customer → fitting_session → report_version`, which keeps a
future MyStrideID customer-history portal possible without redesigning anything.
Tokens are stored hashed, so a database read cannot mint a working link.

## 18. `follow_up`

`organization_id` · `location_id` · `customer_id` · `fitting_session_id` ·
`follow_up_reason` (enum) · `follow_up_due_at` · `follow_up_status`
(`scheduled` · `done` · `snoozed` · `cancelled`) · `channel` ·
`completed_by_user_id` · `response` · `response_note`.

Full model now, **minimal UI in week one** — a due list and a Done button. This
is not a CRM and week-one hours should not be spent building one.

## 19. `device`, `device_installation`, `device_health_event`

Built before hardware ships. Diagnosing a remote unit by flying to it is not a
business model.

**`device`:** serial · hardware_revision · manufactured_at · public_key ·
current_firmware_version · current_calibration_version · status
(`provisioned` · `shipped` · `installed` · `rma` · `retired`).

**`device_installation`:** device_id · organization_id · location_id ·
installed_at · removed_at · host_machine_id. Scans reference the *installation*,
so a device that moves between locations keeps a clean history.

**`device_health_event`:** device_id · event_type (`heartbeat` · `error` ·
`calibration` · `firmware_update` · `self_test`) · firmware_version ·
calibration_version · connectivity · signal_quality · component_status (jsonb) ·
error_code · reported_at.

Every scan therefore knows exactly which device, firmware, calibration and
derivation algorithm produced it.

## 20. `pilot_feedback`

`organization_id` · `location_id` · `user_id` · `fitting_session_id` ·
`type` (`bug` · `confusing` · `too_slow` · `wrong_recommendation` · `idea` ·
`praise`) · `screen` · `note` · `input_snapshot` (jsonb — full feature state for
`wrong_recommendation`, making each report a reproducible test case) · `status`.

---

## 21. Access, retention, privacy

| Concern | Decision |
| --- | --- |
| Tenancy | RLS on `organization_id` for every table, plus `location_id` predicates where `customer_visibility = 'location'`. |
| Service role | Server-side jobs use a distinct role with explicit, audited grants. Never the anon key, never a shared "admin" path from client code. |
| Floor auth | The tablet authenticates as the location; the user is selected. User identity is attribution, not a security boundary. |
| Report links | Token hashed at rest, expiring, revocable, resolving through `report` — never a guessable or enumerable ID. |
| Storage | Scan and logo objects carry the same tenant predicates as their rows. A signed URL is scoped and short-lived. |
| PII | Names and contact data live only on `customer`, hashed or encrypted per §6. |
| Analytics | Event payloads carry IDs and enums only. No names, phones, notes, report URLs or pressure data leaves the application boundary. |
| Exports | Default export is de-identified. Identified export is a separate, logged, role-gated action. |
| Retention | Fit data retained while the organization is active. Erasure scrubs identity, retains anonymized fit records for aggregate learning — stated plainly in the consent text. |
| Audit | `consent_record`, `recommendation`, `scan` and `fitting_feature` are append-only. |

---

**Next:** [06 · Tech Stack & Shoe Data Strategy](06-tech-and-data-strategy.md)
