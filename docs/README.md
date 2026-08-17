# Stride Guide FitOS — Product Blueprint

Blueprint for the **software-only, store-side** Stride Guide product: the fitting
interface an associate runs on a tablet during a live customer fitting, built to
be valuable before the pressure-mapping hardware ships and to absorb that
hardware without a rewrite.

**Status:** draft for approval. No code has been written against this yet — that
is deliberate. Approve or redline the blueprint, then the prototype gets built
from it.

## Read in this order

| # | Document | What it settles |
| --- | --- | --- |
| 01 | [Product Requirements](01-prd.md) | Positioning, product name, personas, scope, success metrics, what not to build |
| 02 | [UX Specification](02-ux-spec.md) | Core flow, the 3-minute time budget, screen-by-screen spec with every field |
| 03 | [Recommendation Engine](03-recommendation-engine.md) | Scoring architecture, confidence, guardrails, and 30 authored rules |
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

## Three decisions worth arguing about before build

1. **Name: Stride Guide FitOS.** "Lite" and "Pro" describe price tiers, not
   products, and "Retail" says nothing. FitOS says system-of-record, which is
   what this has to become. Reasoning in [01-prd](01-prd.md#3-product-name).
2. **Rules decide, language models phrase.** The recommendation path stays
   deterministic and offline-capable. LLMs generate wording, never the
   recommendation. Reasoning in [03](03-recommendation-engine.md#why-rules-not-a-model)
   and [07](07-ai-roadmap.md).
3. **The brand pivots to light.** The electric-green-on-black look reads gaming,
   not premium retail. The blueprint moves the product UI to a warm-neutral light
   theme and keeps the green strictly as sensor-data color. Reasoning in
   [08-design-language](08-design-language.md).

## Related work in this repo

The marketing landing page lives at the repo root (`index.html`, `assets/`) on
the same branch. It is unchanged by this blueprint, though the design direction
here supersedes its visual language for anything customer- or investor-facing
built next.
