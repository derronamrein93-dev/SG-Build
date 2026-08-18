# Stride Guide FitOS — Product Blueprint

Blueprint for the **software-only, store-side** Stride Guide product: the fitting
interface an associate runs on a tablet during a live customer fitting, built to
be valuable before the pressure-mapping hardware ships and to absorb that
hardware without a rewrite.

**Status:** **revision 3** — founder red-pen review applied in full, plus the
customer-identity refinement. The prototype built from this blueprint lives in
[`../fitos`](../fitos/README.md).

## Read in this order

| # | Document | What it settles |
| --- | --- | --- |
| 00 | [Revision Log](00-revision-log.md) | All 28 review marks, what changed, and the three decisions still open |
| 01 | [Product Requirements](01-prd.md) | Positioning, product name, personas, scope, success metrics, what not to build |
| 02 | [UX Specification](02-ux-spec.md) | Core flow, the 3-minute time budget, screen-by-screen spec with every field |
| 03 | [Recommendation Engine](03-recommendation-engine.md) | The six-stage recommendation contract, evidence strength, version stamping, guardrails, and 30 authored rules |
| 04 | [Customer Fit Report](04-fit-report.md) | Report structure, delivery, and a complete filled sample |
| 05 | [Data Model](05-data-model.md) | Entities, fields, types, relationships, retention |
| 06 | [Tech Stack & Shoe Data](06-tech-and-data-strategy.md) | MVP stack, production stack, shoe database strategy and moat |
| 07 | [AI Agent Roadmap](07-ai-roadmap.md) | Five-layer architecture, provider independence, phasing |
| 08 | [Design Language](08-design-language.md) | Brand direction, tokens, tablet ergonomics |
| 09 | [Build Plan](09-build-plan.md) | Build sequence, hardware integration, 7-day execution plan |
| 10 | [Day 5 Usability Test](10-day5-usability-test.md) | The unmoderated associate test: scenarios, observer sheet, success and failure criteria |

## The one-paragraph version

Stride Guide FitOS turns an unstructured shoe fitting into a repeatable,
recorded, explainable process. The associate answers a short intake, records
what they observe about the customer's feet, and the system converts that into a
fit profile with a recommended shoe category, support level, cushioning level,
width and insole opportunity — plus the words to say out loud. The customer
leaves with a branded fit report. The store keeps the fit record. When the
pressure platform ships, it fills in the same fields the associate is filling in
by hand today, so the rules, reports and history all carry forward untouched.

## System map

The canonical architecture. Every document in this blueprint implements some
part of this diagram, and the mapping table below says which.

```
                         Organization
                              │
                           Location
                              │
                    ┌─────────┴─────────┐
                    │                   │
                 Customer            Associate
                    │
                    │
              Fitting Session
                    │
        ┌───────────┴────────────┐
        │                        │
 Manual Observations        Sensor Scan
        │                        │
        │                  Raw Capture
        │                        │
        │                 Derivation Engine
        │                        │
        └──────────┬─────────────┘
                   │
          Canonical Fit Features
                   │
          Recommendation Engine
                   │
             Product Needs
                   │
          Catalog / Inventory
                   │
         Ranked Recommendations
                   │
          ┌────────┴─────────┐
          │                  │
       Fit Report          Outcome
                             │
                       Future Visit
                             │
                       Longitudinal
                         Fit History
```

| Box | Implemented by | Spec |
| --- | --- | --- |
| Organization · Location | `organization`, `location` | [05 §1–§3](05-data-model.md#1-tenancy-organization--location) |
| Associate | `user` (+ `user_location`) | [05 §4](05-data-model.md#5-user-staff) |
| Customer | `organization_customer` + `location_customer_access` + `consent_record`, optionally linked to `person_identity` | [05 §6–§11](05-data-model.md#6-person_identity--global-optional-deliberately-almost-empty) |
| Fitting Session | `fitting_session` | [05 §8](05-data-model.md#13-fitting_session) |
| Manual Observations | `assessment` | [05 §9](05-data-model.md#14-assessment--human-observations) |
| Sensor Scan → Raw Capture | `scan` (immutable) | [05 §11](05-data-model.md#16-scan--raw-capture-hardware-immutable) |
| Derivation Engine | `scan_derivation` (versioned, re-runnable) | [05 §12](05-data-model.md#17-scan_derivation--reprocessable-interpretation) |
| **Canonical Fit Features** | `fitting_feature` + `feature_schema_version` | [05 §10](05-data-model.md#15-the-canonical-fit-feature-model) |
| Recommendation Engine | Rule evaluator, deterministic | [03 §1](03-recommendation-engine.md#the-recommendation-contract) |
| Product Needs | `product_requirements` — stage 3 of the contract | [03 §1](03-recommendation-engine.md#the-recommendation-contract) |
| Catalog / Inventory | `product_model` → `product_variant` → `location_inventory` | [05 §15](05-data-model.md#20-catalog-three-layers) |
| Ranked Recommendations | `recommendation` (immutable, five version stamps) | [05 §13](05-data-model.md#18-recommendation) |
| Fit Report | `report`, `report_view` | [04](04-fit-report.md) · [05 §17](05-data-model.md#22-report-and-report_view) |
| Outcome | `outcome` | [05 §16](05-data-model.md#21-outcome) |
| Future Visit | `follow_up` → next `fitting_session` | [05 §18](05-data-model.md#23-follow_up) |
| Longitudinal Fit History | `assessment_delta` | [05 §14](05-data-model.md#19-assessment_delta--what-changed-since-last-visit) |

**The waist of the diagram is the whole architecture.** Manual observations and
sensor derivation converge on Canonical Fit Features, and everything below that
line is written once and never rewritten when hardware arrives. Everything above
it can change source without disturbing anything below.

### How the map maps to the schema

The drawing is the fitting architecture. One layer sits above it and one
mechanism sits beside it:

- **Above:** an optional, global `person_identity` that a retailer's customer
  record may *later* be linked to. Null by default, forever, unless a person
  opts into MyStrideID. Day 1 runs entirely without it.
- **Customer** on the map is `organization_customer` — the **retailer
  relationship**, owned by the organization, numbered per retailer
  ("Customer #472").
- **Beside:** location scoping is an *authorization* grant
  (`location_customer_access`), not an ownership column. Grantable, revocable,
  auditable, per-location — everything a foreign key is not. Default grant is the
  creating location only.
- **Associate** is `user`, owned by a location, with a join table for staff who
  genuinely cover two doors.

```
   person_identity   (global, optional, nearly empty — no contact data)
         │
         │  identity_resolution: unlinked → candidate_match → verified → linked → revoked
         │
   organization_customer ──► location_customer_access ──► location
         │
         └──► fitting_session ──► … the rest of the map
```

**Identity, consent and authorization are three independent controls and never
collapse into one flag.** Knowing two records are the same person authorizes
nothing on its own. Details in
[05 §2](05-data-model.md#2-identity-consent-authorization--three-independent-controls).

## The load-bearing decisions

1. **Tenancy is `organization → location`, never `store`.** The UI says store;
   the database never does. Independent shop, chain, franchise, clinic, mobile
   event — all the same shape. [05 §1](05-data-model.md#1-tenancy-organization--location)
2. **Manual assessment and sensor derivation are two sources feeding one
   canonical feature model.** Not "the assessment schema is the sensor schema" —
   that phrasing would have crippled the platform.
   [05 §10](05-data-model.md#15-the-canonical-fit-feature-model)
3. **Rules decide; language models phrase; ML re-ranks later.** Three systems,
   one wall, five version stamps on every recommendation so any fitting is
   reproducible years later.
   [03 §1](03-recommendation-engine.md#the-wall-between-rules-and-language-models)
4. **WordPress is the CMS, not the runtime.** MyStrideID.com stays WordPress;
   app.MyStrideID.com is FitOS on Supabase.
   [09 §3](09-build-plan.md#3-platform-topology--wordpress-stays-in-its-lane)
5. **Phone numbers are keyed hashes, not searchable strings** — with the
   exact-match trade-off stated out loud.
   [05 §6](05-data-model.md#10-contact-identity--keyed-hashes-scoped-per-organization)
6. **Customer data is a retailer-scoped relationship, optionally linked to a
   separate global identity.** `person_identity_id` is nullable so MyStrideID can
   arrive later with zero migration, and identity resolution never implies
   cross-retailer visibility.
   [05 §6–§9](05-data-model.md#6-person_identity--global-optional-deliberately-almost-empty)
7. **Name: Stride Guide FitOS**, with Lite/Pro reserved as pricing tiers.
   [01 §3](01-prd.md#3-product-name)
8. **The brand pivots to light** — warm neutral plus deep teal; saturated color
   survives only as sensor-data visualization.
   [08](08-design-language.md)

## Related work in this repo

The marketing landing page lives at the repo root (`index.html`, `assets/`) on
the same branch. It is unchanged by this blueprint, though the design direction
here supersedes its visual language for anything customer- or investor-facing
built next.
