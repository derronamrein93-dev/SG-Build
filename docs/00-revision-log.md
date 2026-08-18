# 00 · Revision Log — founder review, revision 2

Every mark from the red-pen review, what changed, and where. Accepted marks are
implemented; two are implemented with a caveat worth reading.

| # | Mark | Resolution | Where |
| --- | --- | --- | --- |
| 1 | Phase 0 gate too rigid | **Accepted.** Gate is now *one committed design partner OR two retailers willing to run structured discovery/usability testing*. Eight operational discovery facts added and modeled as real `location` fields. | [09 §2](09-build-plan.md#2-phase-0--discovery), [05 §3](05-data-model.md#3-location) |
| 2 | WordPress requirement ignored | **Accepted.** Topology stated explicitly: MyStrideID.com = WordPress CMS, app.MyStrideID.com = FitOS, Supabase = backend, thin read-only bridge plugin. "WordPress is the presentation layer, not the application database or core runtime." | [09 §3](09-build-plan.md#3-platform-topology--wordpress-stays-in-its-lane), [06 §0](06-tech-and-data-strategy.md#0-platform-topology--where-wordpress-fits) |
| 3 | `store` → `organization`/`location` | **Accepted, and it propagated widely.** Tenancy is now organization → location → user → customer → fitting_session → assessment → recommendation → outcome. UI still says "store." Customer belongs to the organization with a `customer_visibility` policy field. | [05 §1–§5](05-data-model.md#1-tenancy-organization--location) |
| 4 | RLS test too shallow | **Accepted.** Six-test isolation suite: read, update, enumerate, report-URL walking, storage objects, service-role separation. Day 1 gate. | [09 §4](09-build-plan.md#day-1--tenancy-spine) |
| 5 | Phone dedupe needs hashing | **Accepted.** `phone_lookup_hash` = HMAC-SHA256(server key, E.164), key outside the database, `phone_key_version` for rotation; `phone_encrypted` only where contact consent exists; `phone_last4` for display. Explicitly not bare SHA-256. **Surfaced consequence:** hashed lookup is exact-match only, so phone type-ahead is gone and the UX spec changed accordingly. | [05 §6](05-data-model.md#6-phone-identity--why-hashed-and-what-it-costs), [02 §5](02-ux-spec.md#5-screen-2--customer-find-or-create) |
| 6 | Consent underspecified | **Accepted.** Five distinct types (fit history, receive report, privacy ack, marketing email, marketing SMS), each with policy version, consent-text version, method, location, timestamp, capturing user. Revocation appends, never updates. | [05 §7](05-data-model.md#7-consent_record), [02 §5](02-ux-spec.md#5-screen-2--customer-find-or-create) |
| 7 | "Autosave on every change" is sloppy | **Accepted.** Local optimistic state → 500–1500ms debounce by field type → server ack → local draft backup. Status lifecycle `draft · in_progress · completed · voided` with `void_reason`. | [02 §1](02-ux-spec.md#1-interaction-laws), [05 §8](05-data-model.md#8-fitting_session), [09](09-build-plan.md#day-2--flow) |
| 8 | Don't optimize the wrong metric | **Accepted.** Four measurement layers — workflow, decision, commercial, durability. 3 minutes is demoted to a design constraint. | [01 §8](01-prd.md#8-success-metrics), [09 §5](09-build-plan.md#5-measure-the-system-not-the-stopwatch) |
| 9 | Day 3 validation too weak; need a recommendation contract | **Accepted.** Six-stage contract: observed_features → derived_fit_profile → product_requirements → candidate_products → ranking → explanation, with the explicit rule that `low_arch` never maps straight to a named shoe. Day 3 gate now requires a working retail fitter to review 10 outputs, not founder memory. | [03 §1](03-recommendation-engine.md#the-recommendation-contract), [09](09-build-plan.md#day-3--intelligence-slow-down-here) |
| 10 | Rules/AI wall + missing versioning | **Accepted — this was a real omission.** Five mandatory stamps on every recommendation: `recommendation_engine_version`, `rule_set_version`, `catalog_version`, `feature_schema_version`, `assessment_schema_version`, plus a frozen feature snapshot. Three-system wall (deterministic engine · explanation layer · future ML) stated in both docs. | [03 §1](03-recommendation-engine.md#mandatory-version-stamping), [05 §13](05-data-model.md#13-recommendation), [07](07-ai-roadmap.md) |
| 11 | "Confidence" is a dangerous word | **Accepted.** Renamed **evidence strength**, defined by stated conditions over named primary/secondary signals, three states, no percentage anywhere. Renamed across all documents. | [03 §3](03-recommendation-engine.md#3-evidence-strength-not-confidence) |
| 12 | Report should anticipate customer identity | **Accepted.** Report is a record (`report` + `report_view`) with `report_version`, `template_version`, content snapshot, and `generated_at` / `emailed_at` / `printed_at` / view log. Access resolves customer → session → report_version. Tokens stored hashed. | [04 §2b](04-fit-report.md#2b-the-report-is-a-record-not-a-file), [05 §17](05-data-model.md#17-report-and-report_view) |
| 13 | Keep transactional separate from marketing | **Accepted.** Separate sender identity, templates and suppression; marketing automation deferred to its own subsystem. | [06 §1](06-tech-and-data-strategy.md#1-recommended-mvp-stack), [09](09-build-plan.md#day-4--artifact) |
| 14 | Follow-up UI premature | **Accepted.** Full data model retained (`follow_up_reason`, `follow_up_due_at`, `follow_up_status`), UI cut to a due list and a Done button. | [05 §18](05-data-model.md#18-follow_up), [02 §10](02-ux-spec.md) |
| 15 | "What changed" is important — model it | **Accepted.** `assessment_delta` is now a stored entity computed at completion from immutable feature snapshots, with per-feature from/to/direction/magnitude, a `material_change` flag and a stored narrative. Queryable, not a render-time diff. | [05 §14](05-data-model.md#14-assessment_delta--what-changed-since-last-visit) |
| 16 | Catalog is the wrong abstraction | **Accepted.** Three layers: `product_model` (global knowledge) → `product_variant` (sellable) → `location_inventory` (assortment). Quantity optional, assortment required. | [05 §15](05-data-model.md#15-catalog-three-layers), [06 §3](06-tech-and-data-strategy.md#three-layers-never-one-table) |
| 17 | CSV import priority | **Accepted.** Priority is now decided by Phase 0 discovery fact #2: exportable inventory → CSV import is Day 6 priority #1; otherwise manual seed. | [06 §3](06-tech-and-data-strategy.md#csv-import-priority-is-decided-in-phase-0-not-assumed) |
| 18 | Analytics privacy | **Accepted.** Explicit event allowlist with IDs and enums only; named never-leaves list; session replay off or masked; Sentry body scrubbing; same discipline applied to LLM prompts. | [06 §4](06-tech-and-data-strategy.md#4-analytics-and-error-reporting--privacy-rules), [09](09-build-plan.md#day-5--operations-and-the-real-test) |
| 19 | **"Manual assessment schema is the sensor schema" is wrong** | **Accepted — biggest correction in the review.** Replaced with a canonical fit feature model: manual assessment and sensor derivation are two *sources* feeding one versioned, provenanced feature model that the engine consumes. Sensor-native measurements (pressure matrix, COP, contact area, load distribution, temporal frames) are no longer forced into human-shaped fields. | [05 §10](05-data-model.md#10-the-canonical-fit-feature-model-replaces-the-assessment-schema-is-the-sensor-schema), [09 §6](09-build-plan.md#the-correct-abstraction) |
| 20 | `source` as loose JSONB | **Accepted.** Provenance is first-class columns on `fitting_feature`: `source_type`, `source_record_id`, `algorithm_version`, `quality`, `captured_at`, `overridden_by_user_id`, `override_reason`, append-only with `superseded_by`. | [05 §10](05-data-model.md#fitting_feature) |
| 21 | "Rules unchanged" is aspirational | **Accepted.** Promise restated as **backwards compatibility**: v1 sensor features map into existing canonical features; the dictionary is additive-only within a major version; sensor-native features may extend the model and later rule versions may use them. | [09 §6](09-build-plan.md#the-compatibility-promise-stated-accurately), [05 §10](05-data-model.md#feature_schema_version) |
| 22 | Parallel calibration — keep, and add load-cell normalization | **Accepted.** 100 fittings is the minimum to *look at*; 300–500 before drawing conclusions. Pipeline stated as raw plantar matrix + simultaneous load-cell reading → normalize by measured load → derive features. | [09 §6](09-build-plan.md#integration-steps-weeks-58) |
| 23 | Device identity model needed | **Accepted.** `device`, `device_installation`, `device_health_event`. Every scan records device, firmware, calibration, hardware revision and derivation algorithm. | [05 §19](05-data-model.md#19-device-device_installation-device_health_event) |
| 24 | Raw data must be immutable | **Accepted.** Raw captures immutable with checksum; `scan_derivation` is versioned and re-runnable so algorithm v2 reprocesses old captures and every past customer benefits. | [05 §11–§12](05-data-model.md#11-scan--raw-capture-hardware-immutable) |
| 25 | Device health before hardware ships | **Accepted.** Heartbeat, firmware, calibration date, last scan, error count, signal quality, connectivity, component diagnostics — scaffolded on Day 7 with no hardware attached. | [09 §6](09-build-plan.md#device-health-ships-early--deliberately) |
| 26 | **"Human override = not a medical device" is legally dangerous** | **Accepted and deleted.** Replaced with: maintain intended use as retail footwear-fit guidance; avoid diagnosis/treatment/prevention/clinical claims; human override supports operational control and explainability but is **not** a regulatory safe harbor; regulatory status turns on intended use, claims, functionality, labeling and context. | [09 §6](09-build-plan.md#regulatory-posture), [01 §2](01-prd.md#what-this-is-and-is-not) |
| 27 | Missing business-critical open questions | **Accepted.** Five added (9–13), including the cross-retailer MyStrideID identity question, flagged as the largest on the page because it is a schema decision now and a migration plus renegotiation later. | [09 §7](09-build-plan.md#7-open-questions) |
| 28 | Definition of done needs business metrics | **Accepted.** Split into product/UX, commercial (completion rate 80–90%+, overrides with reason, sale/no-sale, recommended-vs-purchased, return tie-back) and integrity (no cross-tenant leakage, versioned reproducible records, works without AI, works without hardware). | [09 §8](09-build-plan.md#8-definition-of-done-for-v1) |

## Two caveats worth reading

**On mark 5 (phone hashing).** Implemented as specified, and it has a cost the
review did not name: keyed-hash lookup is exact-match only, so partial phone
search disappears from the dashboard and the customer screen. An associate must
type the full number or search by name. Key rotation also requires re-deriving
hashes from `phone_encrypted`, which only exists where contact consent was given
— rows without it get re-keyed at the customer's next visit. Both are acceptable;
neither should be discovered during the pilot.

**On mark 3 (organization/location).** Adopted in full, including `customer`
hanging off `organization` rather than `location`. That choice pre-supposes a
chain wants shared customers across its own doors, which is probably right but is
open question 11 — so it is a policy field (`customer_visibility`), not a
hard-coded assumption.

## Still open, needing a decision from you

1. **Open question 13 — cross-retailer customer identity via MyStrideID.** If the
   answer is yes, `customer` should become a first-class entity above the
   organization, with its own consent, portability and portal, and that shape is
   cheap now and expensive later.
2. **Open question 10 — who owns the fitting record.** Belongs in the design
   partner agreement before the first real fitting.
3. **Domain conflict.** The marketing landing page in this repo declares
   `strideguide.co` as canonical. Decide whether it becomes MyStrideID.com
   content, redirects, or stays a separate brand property.

---

**Back to:** [Blueprint index](README.md)
