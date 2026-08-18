# Stride Guide FitOS — Product Blueprint

Blueprint for the **software-only, store-side** Stride Guide product: the fitting
interface an associate runs on a tablet during a live customer fitting, built to
be valuable before the pressure-mapping hardware ships and to absorb that
hardware without a rewrite.

**Status:** **revision 2** — founder red-pen review applied in full. No code has
been written against this yet; that is deliberate. Approve, or mark it up again,
and then the prototype gets built from it.

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
| Associate | `user` (+ `user_location`) | [05 §4](05-data-model.md#4-user-staff) |
| Customer | `customer`, `consent_record` | [05 §5–§7](05-data-model.md#5-customer) |
| Fitting Session | `fitting_session` | [05 §8](05-data-model.md#8-fitting_session) |
| Manual Observations | `assessment` | [05 §9](05-data-model.md#9-assessment--human-observations) |
| Sensor Scan → Raw Capture | `scan` (immutable) | [05 §11](05-data-model.md#11-scan--raw-capture-hardware-immutable) |
| Derivation Engine | `scan_derivation` (versioned, re-runnable) | [05 §12](05-data-model.md#12-scan_derivation--reprocessable-interpretation) |
| **Canonical Fit Features** | `fitting_feature` + `feature_schema_version` | [05 §10](05-data-model.md#10-the-canonical-fit-feature-model-replaces-the-assessment-schema-is-the-sensor-schema) |
| Recommendation Engine | Rule evaluator, deterministic | [03 §1](03-recommendation-engine.md#the-recommendation-contract) |
| Product Needs | `product_requirements` — stage 3 of the contract | [03 §1](03-recommendation-engine.md#the-recommendation-contract) |
| Catalog / Inventory | `product_model` → `product_variant` → `location_inventory` | [05 §15](05-data-model.md#15-catalog-three-layers) |
| Ranked Recommendations | `recommendation` (immutable, five version stamps) | [05 §13](05-data-model.md#13-recommendation) |
| Fit Report | `report`, `report_view` | [04](04-fit-report.md) · [05 §17](05-data-model.md#17-report-and-report_view) |
| Outcome | `outcome` | [05 §16](05-data-model.md#16-outcome) |
| Future Visit | `follow_up` → next `fitting_session` | [05 §18](05-data-model.md#18-follow_up) |
| Longitudinal Fit History | `assessment_delta` | [05 §14](05-data-model.md#14-assessment_delta--what-changed-since-last-visit) |

**The waist of the diagram is the whole architecture.** Manual observations and
sensor derivation converge on Canonical Fit Features, and everything below that
line is written once and never rewritten when hardware arrives. Everything above
it can change source without disturbing anything below.

### The map is the schema

Both places where the schema previously differed from this drawing have been
changed to match it:

- **Customer is owned by a Location.** `organization_id` rides along for RLS and
  rollups, and `organization.customer_visibility` now defaults to `location` —
  chain-wide recognition is opt-in rather than assumed.
- **Associate is owned by a Location.** `user_location` remains only as an
  exception for staff who genuinely cover two doors; it grants access without
  changing ownership.

Details in [05 §1](05-data-model.md#1-tenancy-organization--location).

## The load-bearing decisions

1. **Tenancy is `organization → location`, never `store`.** The UI says store;
   the database never does. Independent shop, chain, franchise, clinic, mobile
   event — all the same shape. [05 §1](05-data-model.md#1-tenancy-organization--location)
2. **Manual assessment and sensor derivation are two sources feeding one
   canonical feature model.** Not "the assessment schema is the sensor schema" —
   that phrasing would have crippled the platform.
   [05 §10](05-data-model.md#10-the-canonical-fit-feature-model-replaces-the-assessment-schema-is-the-sensor-schema)
3. **Rules decide; language models phrase; ML re-ranks later.** Three systems,
   one wall, five version stamps on every recommendation so any fitting is
   reproducible years later.
   [03 §1](03-recommendation-engine.md#the-wall-between-rules-and-language-models)
4. **WordPress is the CMS, not the runtime.** MyStrideID.com stays WordPress;
   app.MyStrideID.com is FitOS on Supabase.
   [09 §3](09-build-plan.md#3-platform-topology--wordpress-stays-in-its-lane)
5. **Phone numbers are keyed hashes, not searchable strings** — with the
   exact-match trade-off stated out loud.
   [05 §6](05-data-model.md#6-phone-identity--why-hashed-and-what-it-costs)
6. **Name: Stride Guide FitOS**, with Lite/Pro reserved as pricing tiers.
   [01 §3](01-prd.md#3-product-name)
7. **The brand pivots to light** — warm neutral plus deep teal; saturated color
   survives only as sensor-data visualization.
   [08](08-design-language.md)

## Related work in this repo

The marketing landing page lives at the repo root (`index.html`, `assets/`) on
the same branch. It is unchanged by this blueprint, though the design direction
here supersedes its visual language for anything customer- or investor-facing
built next.
