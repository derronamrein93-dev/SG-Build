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
