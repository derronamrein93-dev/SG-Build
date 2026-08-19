# 05 · Data Model

Postgres (Supabase). Every table gets `id uuid pk default gen_random_uuid()`,
`created_at timestamptz default now()`, `updated_at timestamptz`. Those three are
omitted from the tables below.

> **Revision 3.** Customer data restructured as **retailer-scoped relationships
> optionally linked to a separate global `person_identity`**. Identity matching,
> consumer consent and retailer authorization are now three independent
> mechanisms that never collapse into one flag. `person_identity_id` is nullable,
> so MyStrideID can arrive later without migrating a single existing record.
> See [00-revision-log](00-revision-log.md).

---

## 0. Where this sits

This document is the storage layer for the canonical
[system map](README.md#system-map). Read the map first — it is the shape; this is
the shape written down in tables.

The single most important line on that map is where **Manual Observations** and
**Derivation Engine** converge on **Canonical Fit Features**. Everything below
that convergence is written once and survives the hardware; everything above it
can change source without disturbing anything below.

---

## 1. Tenancy: organization → location

**The UI says "store." The database never does.** Every future customer shape —
independent shop, multi-location chain, franchise, running clinic, orthotics
shop, enterprise retailer, mobile fitting event, pop-up — is an `organization`
with one or more `location` records. A single-store retailer is an organization
with one location, and the UI hides the distinction entirely.

```
  person_identity (global, optional, nearly empty)
        │
        │  identity_resolution   ← deliberate, stateful, revocable
        │
  ┌─────┴──────────────────────────┬──────────────────────────────┐
  │                                │                              │
  organization A                   organization B                 …
  │                                │
  ├── location ──┬── user (staff)
  │              ├── device_installation ──► device
  │              └── location_inventory ──► product_variant ──► product_model
  │
  ├── organization_customer ──┬── location_customer_access ──► location
  │            │              └── consent_record
  │            │
  │            └──► fitting_session ──┬── assessment          (1:1, manual)
  │                                   ├── scan                (1:n, immutable)
  │                                   │     └── scan_derivation (1:n, re-runnable)
  │                                   ├── fitting_feature     (1:n, canonical)
  │                                   ├── recommendation      (1:n, immutable)
  │                                   ├── outcome             (1:1, optional)
  │                                   ├── report ── report_view
  │                                   ├── assessment_delta    (1:1)
  │                                   └── follow_up           (1:n)
  │
  └── pilot_feedback
```

**The customer record belongs to the retailer relationship, not to a location
and not to Stride Guide.** Location scoping is an *authorization* concern handled
by `location_customer_access` (§9), which is a stronger mechanism than ownership:
it is grantable, revocable, auditable, and per-location, where a foreign key is
none of those things.

> This supersedes revision 2, which put `customer.location_id` as the owning
> column. Same isolation guarantee, better mechanism — and it is what makes
> optional cross-retailer identity possible without any of it leaking.

---

## 2. Identity, consent, authorization — three independent controls

The load-bearing principle of this document.

| Control | Question | Mechanism |
| --- | --- | --- |
| **IDENTITY** | Is this the same person? | `person_identity` + `identity_resolution` |
| **CONSENT** | Has the person authorized this use? | `consent_record`, scoped to an organization **or** to the person |
| **AUTHORIZATION** | Is this retailer or location allowed to access this? | `location_customer_access`, organization policy, RLS |

**These never collapse into one boolean.** Stride Guide may internally know that
the same person visited Retailer A and Retailer B while Retailer B has no right
whatsoever to see Retailer A's fitting records — and that state must be
representable, not an awkward edge case.

Concretely, the system must be able to hold all three of these at once:

- identity = **verified** (we know it is the same person)
- consent = **granted for portable fit data only**
- authorization = **denied** for Retailer A's transactional records

Matching identity and authorizing data sharing are different acts, performed by
different parties, at different times, and revocable independently.

---

## 3. `organization`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| name / legal_name | text | ✅ / | |
| org_type | enum | ✅ | `independent` · `chain` · `franchise` · `clinic` · `orthotics` · `enterprise` · `events` |
| plan | enum | ✅ | `pilot` · `design_partner` · `active` · `paused` |
| default_customer_access | enum | ✅ | `creating_location` (**default**) · `all_locations` — what access grant a new customer gets. Chain-wide recognition is opt-in |
| identity_participation | enum | ✅ | `none` (**default**) · `resolution_only` · `portable_profile` — whether this retailer participates in MyStrideID identity resolution at all, and how far |
| data_owner_terms_version | text | ✅ | Which data-rights agreement this org signed (open question 10) |
| settings | jsonb | | Org-wide defaults |

## 4. `location`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| organization_id | uuid fk | ✅ | |
| name | text | ✅ | The "store name" on the report |
| address_line1 / city / region / postal_code / country | text | | Printed on report |
| phone / email | text | ✅ | Printed on report; report reply-to |
| logo_url | text | | Falls back to org logo, then a wordmark |
| timezone | text | ✅ | Drives follow-up due dates |
| size_unit | enum | ✅ | `us` · `uk` · `eu` |
| retail_focus | enum[] | ✅ | `running` · `comfort` · `work` · `orthopedic` · `sporting_goods` |
| pos_system | text | | **Phase 0 capture** |
| inventory_source | enum | | `none` · `csv` · `pos_export` · `api` — Phase 0 capture |
| tracks_associate_attribution | bool | | Phase 0 capture |
| network_quality | enum | | `good` · `variable` · `poor` — Phase 0 capture |
| active | bool | ✅ | |

## 5. `user` (staff)

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| location_id | uuid fk | ✅ | Home location |
| organization_id | uuid fk | ✅ | Denormalized for RLS and rollups |
| first_name | text | ✅ | Printed on report ("Fitted by Denise") |
| last_name | text | | |
| role | enum | ✅ | `associate` · `manager` · `owner` · `org_admin` |
| pin_hash | text | | Argon2id |
| auth_user_id | uuid | | Null for floor staff on a shared tablet |
| active | bool | ✅ | Deactivate, never delete — attribution must survive |

`user_location` (join) covers staff who genuinely work two doors: it grants
additional locations without changing the home location.

---

## 6. `person_identity` — global, optional, deliberately almost empty

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| identity_lookup_hash | bytea | ✅ | HMAC over a normalized identifier, **under a separate global key** (§10) |
| identity_key_version | smallint | ✅ | Rotation |
| account_status | enum | ✅ | `shadow` (created by resolution, no account) · `claimed` (MyStrideID account exists) · `closed` |
| auth_user_id | uuid | | Set only when the person actually creates a MyStrideID account |
| created_at | timestamptz | ✅ | |

**What is deliberately not here:** name, phone, email, address, fit data,
purchase history. `person_identity` is a *pointer*, not a profile. A global table
holding contact details for every customer of every retailer would be the most
attractive breach target in the company; this one is close to worthless on its
own, and that is the design.

Names and contact details stay on `organization_customer`, encrypted, under the
retailer relationship where the customer actually gave them.

## 7. `organization_customer` — the retailer relationship

This is what an associate means by "customer." Replaces the previous `customer`
table.

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| organization_id | uuid fk | ✅ | The owning retailer relationship |
| created_at_location_id | uuid fk | ✅ | Where the relationship started |
| **person_identity_id** | uuid fk | | **Nullable, and null is the normal state.** Set only after deliberate, verified resolution |
| local_customer_number | int | ✅ | Per-organization human-readable number ("Customer #472"). Sequence per org |
| first_name / last_name | text | ✅* | Encrypted at rest |
| phone_lookup_hash | bytea | | HMAC under the **organization's own key** (§10) |
| phone_encrypted | bytea | | Only where contact consent exists |
| phone_last4 | text | | Display only |
| phone_key_version | smallint | | |
| email_lookup_hash / email_encrypted | bytea | | Same treatment |
| age_range | enum | | `under_18` … `75_plus` · `undisclosed` |
| is_minor | bool | | Switches consent copy, suppresses upsells |
| identification_method | enum | ✅ | `phone` · `name_dob` · `loyalty_id` · `anonymous` |
| anonymous | bool | ✅ | Fitting without stored identity |
| notes | text | | Retailer's own non-fit context |
| deleted_at | timestamptz | | Soft delete; identity scrubbed, fit records anonymized |

\* Not required when `anonymous = true`.

**Index:** `unique (organization_id, phone_lookup_hash) where phone_lookup_hash is not null and deleted_at is null`

Day 1 runs entirely on this table with `person_identity_id` null throughout:

```
  Organization A
    → organization_customer #472
      → fitting_session, assessment, recommendation, report
```

No global identity required, none implied, nothing to migrate later.

## 8. `identity_resolution` — a stateful layer, not a link table

Calling this a link table would invite exactly the wrong implementation: an
automatic join on matching hashes. **Two identical hashed phone numbers must
never cause two retailers to start sharing a customer's history.**

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| organization_customer_id | uuid fk | ✅ | |
| person_identity_id | uuid fk | ✅ | |
| state | enum | ✅ | `candidate_match` · `verified` · `linked` · `revoked` (absence of a row = `unlinked`) |
| evidence | jsonb | ✅ | What suggested the match — never the raw identifier itself |
| proposed_by | enum | ✅ | `system` · `customer` · `retailer` · `support` |
| verified_by | enum | | `customer_confirmation` · `account_claim` · `support_review` |
| verified_at | timestamptz | | |
| revoked_at / revoked_reason | timestamptz / text | | Revocation is first-class, not a delete |
| state_history | jsonb | ✅ | Append-only transition log |

### The state machine

| State | Meaning | What it permits |
| --- | --- | --- |
| `unlinked` | No relationship asserted. **The default forever.** | Nothing |
| `candidate_match` | The system suspects a match. | **Nothing.** Not visible to any retailer. Not actionable. It is a queue item, not a fact. |
| `verified` | The person confirmed it, or claimed a MyStrideID account. | Sets `organization_customer.person_identity_id` |
| `linked` | Verified **and** the person has authorized a specific use. | Whatever that consent covers, and nothing else |
| `revoked` | The person withdrew. | Nothing; history retained for audit |

**`verified` still authorizes no data flow.** It answers only "same person."
Every actual disclosure requires a separate consent record *and* a separate
authorization check. Those are §2's three controls, kept apart on purpose.

## 9. `location_customer_access` — authorization

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| organization_customer_id | uuid fk | ✅ | |
| location_id | uuid fk | ✅ | |
| access_level | enum | ✅ | `full` · `fit_profile_only` · `none` |
| granted_by_user_id | uuid fk | | Null when granted by org policy at creation |
| granted_at / revoked_at | timestamptz | ✅ / | |
| reason | text | | |

On creation, one row for the creating location, per
`organization.default_customer_access`. A chain enabling cross-door recognition
grants additional rows — an explicit, auditable act rather than a schema
property. RLS reads this table; there is no path around it.

---

## 10. Contact identity — keyed hashes, scoped per organization

```
  502-555-1212
      ↓ normalize
  +15025551212                                   → phone_last4 "1212" (display)
      ↓ HMAC with the ORGANIZATION's key
  organization_customer.phone_lookup_hash        → dedupe within this retailer
      ↓ envelope encryption (only with contact consent)
  phone_encrypted                                → decrypt only to send a report
```

- **HMAC, not bare SHA-256.** The North American phone space is ~10^10; a plain
  hash is a weekend of brute force. A keyed construction makes the rainbow table
  useless without the key.
- **Keys live outside the database** (Vault/KMS), so a dump alone reverses
  nothing.
- **Per-organization keys** — an addition this revision makes, and a necessary
  one. With a single global key, two retailers' rows for the same person produce
  *identical hashes*, which means the platform could silently correlate customers
  across retailers as a side effect of the schema. That would defeat §2 before
  anyone wrote a line of resolution logic. Per-org keys make cross-retailer
  correlation impossible by accident and possible only through the deliberate,
  consented path in §8.
- `person_identity.identity_lookup_hash` uses a **separate global key**, used
  only inside identity resolution and never for retailer-facing lookup.

**UX consequence:** lookup is exact-match only. No partial phone search; the
associate types the full number or searches by name.
([02 §5](02-ux-spec.md#5-screen-2--customer-find-or-create))

## 11. `consent_record`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| **scope** | enum | ✅ | `organization` (given to this retailer) · `person` (given to Stride Guide / MyStrideID) |
| organization_customer_id | uuid fk | | Set when scope = `organization` |
| person_identity_id | uuid fk | | Set when scope = `person` |
| location_id | uuid fk | | Where taken — jurisdiction matters |
| type | enum | ✅ | `fit_history_storage` · `receive_report` · `privacy_ack` · `marketing_email` · `marketing_sms` · `identity_resolution` · `portable_profile_share` |
| granted | bool | ✅ | Revocation writes a **new row**; rows are never updated |
| scope_detail | jsonb | | For `portable_profile_share`: which retailer, which fields, expiry |
| consent_text_version / privacy_policy_version | text | ✅ | |
| method | enum | ✅ | `tablet_checkbox` · `verbal_attested` · `web_form` · `written` · `mystrideid_account` |
| captured_by_user_id | uuid fk | | Null for consents given by the person online |
| captured_at | timestamptz | ✅ | |

Consent given to a retailer and consent given to MyStrideID are different
records with different scopes. A customer agreeing that Store A may keep their
fitting history has **not** agreed to cross-retailer identity resolution, and
neither implies the other.

## 12. Portable vs retailer-owned data

If MyStrideID ever becomes a portable consumer Fit ID, this classification is the
product. Writing it down now costs nothing and prevents the wrong data from
drifting into the portable set later.

| Customer-portable *(person may authorize sharing)* | Retailer-owned *(never portable)* |
| --- | --- |
| Foot measurements and sizes | What they purchased |
| Canonical fit features (arch, width, volume, pronation tendency) | Price paid, discounts, margin |
| Selected scan-derived features | Associate notes |
| Sizing history over time | Store-specific recommendation and talking points |
| Stated preferences and fit priorities | Conversion, returns, outcome records |
| Standardized Fit Profile | Internal merchandising and inventory data |

Two rules that follow:

1. **Portability is a projection, not a transfer.** An authorized share emits a
   computed Fit Profile from the person's records; it never moves or copies a
   retailer's row, and the retailer keeps everything.
2. **Retailer-owned data has no consent path to portability.** It is not a
   permission the customer can grant, because it is not theirs to grant. That
   distinction is what makes participation safe to sell to a retailer.

This is materially stronger than either extreme — "every store owns everything"
or "Stride Guide owns one universal customer record" — and it is the reason a
portable consumer Fit ID could end up worth more than the pressure platform.

---

## 13. `fitting_session`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| **organization_customer_id** | uuid fk | | Null for anonymous fittings |
| **location_id** | uuid fk | ✅ | Where the fitting happened |
| organization_id | uuid fk | ✅ | Denormalized for RLS |
| user_id | uuid fk | ✅ | The fitter |
| status | enum | ✅ | `draft` · `in_progress` · `completed` · `voided` |
| void_reason | enum | | `test` · `mistaken_start` · `customer_withdrew` · `duplicate` |
| visit_number | int | ✅ | Computed at completion, **within this retailer relationship** |
| started_at / completed_at | timestamptz | ✅ / | |
| time_to_recommendation_ms | int | | Measured, not estimated |
| **Intake fields** | | | shopping_purpose, current_shoe_problem[], discomfort_area[], discomfort_timing, activity_level, standing_hours_per_day, current_shoe_brand/model, current_shoe_age, fit_priority[], previous_return_reason, uses_orthotics, shoe_wear_concern, intake_notes |
| need_summary | text | | Generated, stored for reproducibility |
| risk_flags | text[] | | Generated |
| device_id | text | | Tablet identity |
| draft_saved_at / draft_synced_at | timestamptz | | Debounced autosave bookkeeping |
| assessment_schema_version | text | ✅ | |

Only `completed` sessions count as historical fittings.

## 14. `assessment` — human observations

1:1 with the session. One input to the feature model, not the model itself.

`fitting_session_id` · `size_left` / `size_right` · `size_unit` · `width` ·
`width_asymmetry` · `arch_type` · `foot_shape[]` · `pronation_tendency` ·
`heel_slip_risk` · `toe_box_issue[]` · `wear_pattern` · `balance_concern` ·
`pressure_concern[]` · `assoc_support_level` / `assoc_cushioning_level` /
`assoc_category` / `assoc_insole` (the fitter's own call, captured **before** the
engine's output is shown) · `assessment_notes` · `measured_at`.

## 15. The canonical fit feature model

```
  assessment (human observation) ──┐
                                   ├──► fitting_feature (canonical, versioned, provenanced)
  scan_derivation (sensor)      ───┘                    │
                                                        ▼
                                              recommendation engine
```

A human says `arch_type = low`. A sensor produces `medial_pressure_ratio = 0.63`,
a center-of-pressure track, a contact-area map, a load distribution. Forcing
sensor output into the human schema would discard everything that makes the
hardware worth building. Both feed one extensible model instead.

### `fitting_feature`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| fitting_session_id | uuid fk | ✅ | |
| feature_key | text | ✅ | From the versioned dictionary — `arch_type`, `medial_pressure_ratio`, … |
| value_categorical / value_numeric | text / numeric | | |
| unit | text | | `ratio` · `kPa` · `mm` · `pct` |
| **source_type** | enum | ✅ | `manual` · `sensor_derived` · `intake_inferred` · `imported` · `default` |
| **source_record_id** | uuid | | The `assessment` or `scan_derivation` row |
| **algorithm_version** | text | | Sensor only |
| **quality** | numeric | | 0–1 signal quality — a property of the measurement, not of the recommendation |
| **captured_at** | timestamptz | ✅ | |
| **overridden_by_user_id** | uuid fk | | When a human replaces a sensor value |
| **override_reason** | enum | | `disagrees_with_observation` · `poor_capture` · `customer_input` · `other` |
| superseded_by | uuid | | Append-only; corrections supersede |

**Unique:** `(fitting_session_id, feature_key) where superseded_by is null`

### `feature_schema_version`

The dictionary of valid keys, types, units and allowed values, versioned. Rules
declare which version they were authored against. **Additive-only within a major
version** — new features may appear; existing features never change meaning or
lose enum values. That is the compatibility promise, not "rules never change."

## 16. `scan` — raw capture *(hardware; immutable)*

`fitting_session_id` · `device_id` / `device_installation_id` ·
`firmware_version` / `calibration_version` / `hardware_revision` (copied at
capture) · `capture_type` (`static_stance` · `weight_shift` · `walk`) ·
`raw_uri` · `raw_checksum` · `sample_rate_hz` / `frame_count` ·
`total_load_measured` (load cells, captured **simultaneously** with the pressure
matrix) · `capture_quality` · `captured_at`.

**Immutable.** Never overwritten, never edited. Storage is cheap; a customer's
foot at a moment in time is not repeatable.

## 17. `scan_derivation` — reprocessable interpretation

`scan_id` · `algorithm_version` · `derived` (jsonb: peak pressure, contact area,
COP path, medial/lateral ratio, L/R load split, normalized distribution) ·
`quality_metrics` · `is_current` · `derived_at`.

```
  raw scan (immutable) ──► algorithm v1 ──► derivation v1 ──► features
                      └──► algorithm v2 ──► derivation v2 ──► better features
```

Improving the algorithm re-reads history. Every past customer benefits from next
year's math without being re-scanned.

## 18. `recommendation`

Immutable. A change writes a new row.

`fitting_session_id` · `fit_profile` (jsonb) · `flags[]` · **`evidence_strength`**
(`high` · `moderate` · `low`) · `evidence_detail` · **`recommendation_engine_version`**
· **`rule_set_version`** · **`catalog_version`** · **`feature_schema_version`** ·
**`assessment_schema_version`** · `fired_rule_ids[]` · `feature_snapshot` (frozen)
· `talking_points[]` · `rationale` · `products_considered[]` ·
`products_avoided[]` · `overridden` · `override_fields` · `override_reason`.

Those five version stamps are what make an August 2026 recommendation
reproducible after the engine changes in 2027.

## 19. `assessment_delta` — what changed since last visit

`fitting_session_id` · `previous_session_id` · `interval_days` · `changes`
(jsonb: per feature `{feature_key, from, to, direction, magnitude,
source_type_before, source_type_after}`) · `material_change` · `narrative`.

Computed at completion from immutable feature snapshots, so a delta stays stable
even if a later correction supersedes a feature. Scoped **within one retailer
relationship** — a customer's history at Store A does not silently extend into
Store B, whatever identity resolution knows.

## 20. Catalog: three layers

**`product_model`** — global brand knowledge: brand · model · variant ·
model_year · category · use_case[] · support_level · cushioning_level ·
toe_box_shape · heel_structure · flexibility · volume · drop_mm · weight_g ·
**removable_insole** · safety_toe · slip_resistant · waterproof · best_for[] ·
avoid_for[] · msrp · `data_source` · `verified_at` · `catalog_version`.

**`product_variant`** — the sellable thing: `product_model_id` · gender · size ·
width · colorway · upc · manufacturer_sku.

**`location_inventory`** — retailer assortment: `location_id` ·
`product_variant_id` · retailer_sku · retail_price · `stocked` · quantity
(nullable) · `source` · `last_synced_at` · notes.

Quantity is optional; assortment is not. Recommending a width the store does not
carry is the fastest way to lose an associate's trust.

## 21. `outcome`

`fitting_session_id` · `outcome` (`purchased` · `purchased_other` ·
`considering` · `no_purchase` · `ordered`) · `purchased_variant_id` ·
`purchased_size` · `recommended_vs_purchased` · `insole_attached` ·
`insole_type` · `sale_value` · `returned` / `return_reason` / `returned_at` ·
`satisfaction`.

**Entirely retailer-owned** ([§12](#12-portable-vs-retailer-owned-data)). Never
portable, under any consent.

## 22. `report` and `report_view`

The report is a **record**; the page or PDF is a rendering.

`report`: `fitting_session_id` · `organization_customer_id` · `report_version` ·
`template_version` · `access_token_hash` · `expires_at` · `revoked_at` ·
`generated_at` · `emailed_at` · `printed_at` · `content_snapshot`.

`report_view`: `report_id` · `viewed_at` · `user_agent_class` ·
`referrer_class`. No IP, no fingerprint.

Access resolves organization_customer → fitting_session → report_version, which
keeps a future customer-history portal possible. Tokens stored hashed.

## 23. `follow_up`

`organization_id` · `location_id` · `organization_customer_id` ·
`fitting_session_id` · `follow_up_reason` · `follow_up_due_at` ·
`follow_up_status` (`scheduled` · `done` · `snoozed` · `cancelled`) · `channel` ·
`completed_by_user_id` · `response` · `response_note`.

Full model, **minimal UI** — a due list and a Done button. This is not a CRM.

## 24. `device`, `device_installation`, `device_health_event`

Built before hardware ships. Diagnosing a remote unit by flying to it is not a
business model.

**`device`:** serial · hardware_revision · manufactured_at · public_key ·
current_firmware_version · current_calibration_version · status
(`provisioned` · `shipped` · `installed` · `rma` · `retired`).

**`device_installation`:** device_id · organization_id · location_id ·
installed_at · removed_at · host_machine_id. Scans reference the *installation*,
so a device that moves keeps a clean history.

**`device_health_event`:** device_id · event_type (`heartbeat` · `error` ·
`calibration` · `firmware_update` · `self_test`) · firmware_version ·
calibration_version · connectivity · signal_quality · component_status ·
error_code · reported_at.

## 25. `pilot_feedback`

`organization_id` · `location_id` · `user_id` · `fitting_session_id` · `type`
(`bug` · `confusing` · `too_slow` · `wrong_recommendation` · `idea` · `praise`) ·
`screen` · `note` · `input_snapshot` (full feature state for
`wrong_recommendation`) · `status`.

---

## 26. Access, retention, privacy

| Concern | Decision |
| --- | --- |
| Tenancy | RLS on `organization_id` everywhere, **plus** a `location_customer_access` predicate on every customer-scoped read. |
| Cross-retailer | No query path joins two organizations' customer data. Identity resolution runs in an isolated service with its own credentials and its own audit log. |
| Service role | Server-side jobs use a distinct role with explicit, audited grants. Never the anon key. |
| Floor auth | The tablet authenticates as the location; the user is selected. User identity is attribution, not a security boundary. |
| Report links | Token hashed at rest, expiring, revocable, resolving through `report`. |
| Storage | Scan and logo objects carry the same tenant predicates as their rows. |
| PII | Names and contact data live only on `organization_customer`, hashed or encrypted per §10. `person_identity` holds no contact data at all. |
| Analytics | IDs and enums only. No names, phones, notes, report URLs or pressure data. |
| Exports | De-identified by default. Identified export is a separate, logged, role-gated action. |
| Retention | Retained while the organization is active. Erasure scrubs identity, retains anonymized fit records for aggregate learning — stated plainly in the consent text. Revoking identity resolution never deletes a retailer's own records. |
| Audit | `consent_record`, `identity_resolution`, `recommendation`, `scan` and `fitting_feature` are append-only. |


---

## report_view integrity

`report_view` records who opened a customer report and when. Migration 0007 gave
it an `organization_id`, RLS, and an append-only grant — before that it was the
one table where viewing patterns crossed the tenant boundary.

### Why the sweep is gated

The migration found two rows referencing reports that no longer existed, behind a
**validated cascade foreign key** where that should be impossible. The provenance
was never established.

That is the reason the cleanup asks permission. An access log quietly losing rows
is a larger problem than the migration it blocks, and deleting the evidence is
the wrong first move. So 0007 prints the counts, then **stops** if anything
cannot resolve an organization:

```
report_view has 2 row(s) that cannot resolve an organization. Migration stopped.
```

It proceeds only with explicit approval:

```bash
PGOPTIONS="-c fitos.orphan_sweep=approved" psql -f db/migrations/0007_report_view_scope.sql
```

On a database with real fittings, **capture the rows before approving** —
`select id, report_id, viewed_at from report_view where organization_id is null` —
because the sweep is irreversible and the rollback migration cannot restore them.

### Scope is proven, never inferred

Backfill runs only through `report → fitting_session → organization_id`. A row
that cannot be traced that way is left null and hits the gate. Assigning it a
plausible tenant would file one retailer's access record under another's, which
is worse than losing it.

### The preflight is permanent

`report_view_orphan_audit()` stays in the schema, so the same integrity question
can be asked later without running a migration:

```bash
npm run db:preflight
```

It **refuses to run** as a role that does not bypass RLS. Under FORCE RLS —
which applies to the table owner too — an ordinary caller would count only the
rows it can already see and report zero orphans on a database full of them. An
integrity check that inherits the visibility rules it is auditing is worse than
none, because it reads as reassurance.

### Append-only, with one window

After 0007 there is no DELETE grant and no policy naming DELETE, so nothing can
remove an access-log row. The migration's own sweep works only because it runs
before RLS is enabled. A later sweep is therefore a deliberate, documented
operation — disabling RLS, deleting, re-enabling — and not something that can
happen by accident.

### Lifecycle unchanged

- Public `/r/<token>` is still authorized by token hash alone. It writes a view
  row through `fitos_svc` because the viewer is anonymous; the organization comes
  from the resolved fitting session, never from anything the viewer supplies.
- A token that does not resolve logs nothing (`token.test.ts` P13).
- Associate `/fitting/<id>/report` is still tenant-scoped by RLS.
- The log stores `user_agent_class` and `referrer_class` — coarse buckets, never
  a raw user agent, IP, or URL.

---

## Identity peppers

`FITOS_ORG_HASH_SECRET` and `FITOS_IDENTITY_SECRET` are **required**. There is no
fallback, and adding one would be a regression: the previous
`process.env.X ?? 'dev-only-secret'` shape meant a deployment that forgot the
variable ran happily with an HMAC key published in this repository, producing
hashes anyone could recompute, with nothing visibly wrong.

`src/lib/config.ts` rejects a secret that is missing, empty, under 32 characters,
or one of the known placeholders — including the two literal strings that used to
be the defaults. Errors name the variable and never its value, because exception
text reaches logs, error trackers, and pasted screenshots.

**There is no bypass flag.** A `FITOS_ALLOW_DEV_SECRETS`-style escape is exactly
what gets set on a staging box "temporarily" and is still set two years later.
Local development supplies explicit values through `fitos/dev.env`, which
`db/reset.sh` and `npm run test` both source, so the seeded demo customer and the
test suite always agree. `identity.test.ts` ID06 fails if they ever drift.

### Changing a pepper invalidates every hash derived from it

A keyed hash cannot be recomputed from itself. Change `FITOS_ORG_HASH_SECRET` and
every stored `phone_lookup_hash` becomes unmatchable: existing customers are no
longer findable by phone, silently, with the record still present.

| Situation | What to do |
| --- | --- |
| Local, dev, demo | Set the values, then `bash db/reset.sh`. The demo data is rebuilt under the new pepper. |
| Any database with real fittings | **Do not change the pepper.** Rotate — see below. |

### The rotation path, and why `phone_key_version` exists

Rotation is possible only because `phone_encrypted` retains the E.164 alongside
the hash. The path is: decrypt `phone_encrypted`, re-HMAC under the new pepper,
write the new hash and set `phone_key_version = 2`, keeping both versions
resolvable during the cutover.

**Not implemented.** Rotation is an operations task with its own migration,
backfill and verification, and it is deliberately not bundled with fail-fast
validation. `PHONE_KEY_VERSION` in `src/lib/db/identity.ts` is the constant it
will move.

### `PGPASSWORD` — reviewed, deliberately unchanged

`src/lib/db/client.ts` still has `process.env.PGPASSWORD ?? 'fitos'`. It is the
same shape as the pepper defaults and is **lower stakes**: a wrong database
password fails loudly at connection time rather than silently producing valid-
looking output, and the fallback matches a local development role that exists
only on a developer's machine. Making it fail fast would break `db/reset.sh` and
every local workflow for a guard that the connection already provides.

Proposed follow-up, not done here: require `PGPASSWORD` when `NODE_ENV` is
`production`, leaving local development untouched. Recorded so it is a decision
rather than an oversight.

---

## Consent checks

**Consent is read in exactly one place: `hasConsent()` in `src/lib/consent.ts`.
Do not query `consent_record` directly.** `consent.test.ts` CH10 enforces this by
scanning the source tree; adding a file to its allowlist is a deliberate act.

The rule exists because the model has three properties that are each easy to get
wrong once, and impossible to get right consistently across scattered call
sites:

1. **Withdrawal is a new row, not an update.** There is no `revoked_at` and no
   UPDATE grant. "Does consent hold" is therefore "what does the most recent row
   say" — never "does a row exist". A call site that checks `granted = true`
   without ordering will happily honour consent that was withdrawn afterwards.
2. **`captured_at` defaults to `now()`, which is transaction start time.** Two
   rows written in one transaction tie. The chokepoint breaks the tie with
   `granted asc`, so a withdrawal beats a grant at the same instant — the
   fail-closed direction.
3. **Person-scoped rows carry location semantics from migration 0005.** RLS
   limits them to the capturing organization; the helper narrows further to the
   capturing *location*, and a person-scoped row with no location satisfies
   nothing at all. The `person` subject type requires a `locationId`
   structurally, so it is not possible to ask the unsafe question.

Everything fails closed: no row, a withdrawal, a foreign tenant's row (invisible
under RLS), a mismatched location, an unknown customer id.

### Relationship to migration 0005

0005 decides *visibility* — which rows a tenant may see at all. The chokepoint
decides *meaning* — whether the rows it can see amount to active consent. They
are deliberately separate: RLS cannot express "most recent row wins", and the
application must not be the thing standing between one tenant and another's data.

### Capture is not a check

`queries.ts` gates customer creation on the consent checkbox and writes
`consent_record` rows. That is capture. It stays where it is; the chokepoint
covers reads.

### Expiration is not supported

`consent_record` has no expiry column, so `hasConsent()` cannot evaluate one, and
`CONSENT_EXPIRY_SUPPORTED` is exported as `false` to say so out loud. Giving
consent a lifetime needs a schema change plus a predicate in two queries — after
which every caller inherits it, which is the point of having one chokepoint.

---

## Connection model and trust boundaries

Three ways into the database, and they are not interchangeable.

| Path | Role | RLS | Authorization is |
| --- | --- | --- | --- |
| `withTenant` | `fitos_app` | Applies — no BYPASSRLS | The GUCs `app.organization_id` / `app.location_id`, enforced by policy |
| `withService` | `fitos_svc` | **Bypassed** | Whatever the caller enforces. Currently: a token hash, or a test |
| Migrations | `fitos_owner` | Applies — RLS is FORCEd | Not an application path |

`withTenant` opens a transaction, issues `set local role fitos_app`, and sets the
GUCs the policies read. FitOS does **not** connect with a service role and filter
in application code; the database refuses cross-tenant reads whether or not a
call site remembers to ask it to.

### The public report is the one deliberate exception

`/r/<token>` has no session and no tenant context, so RLS has nothing to key on.
`loadReportByToken` hashes the token, matches `report.access_token_hash`, and
checks `revoked_at` and `expires_at`. **The token hash is the authorization
boundary.** It is 24 random bytes, stored only as a SHA-256 digest, and a
fitting session id is not an input to that function and cannot become one.

The constraint that keeps this safe: any query on that path is keyed by the token
hash alone. It must never accept a caller-supplied identifier as a filter or a
join condition, because RLS is not there to catch the mistake.

**Residual risk — timing.** `token.test.ts` P11 proves a foreign tenant receives
*identical results* for a real session id and a fabricated one, so the boundary
withholds existence and not merely content. It does not prove the two take
identical *time*. A timing oracle on report existence is real and is accepted
here rather than overlooked: the mitigation is **rate limiting at the edge** on
`/r/<token>`, not a query change, because constant-time behaviour in Postgres
under a shared connection pool is not something an application query can promise.
Revisit if the report route is ever exposed to untrusted volume.

### If FitOS moves to Supabase, role switching must survive the move

A Supabase client using the service-role key for application queries bypasses
every policy at once — and the isolation suite would still pass, because it tests
the database rather than the client. Whatever connects must arrive as a role
without BYPASSRLS, with the tenant GUCs set from verified JWT claims.

---

**Next:** [06 · Tech Stack & Shoe Data Strategy](06-tech-and-data-strategy.md)
