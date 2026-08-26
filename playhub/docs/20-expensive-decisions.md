# 20 — Decisions That Become Expensive to Change

> Ranked by cost of reversal. Everything above the line should be settled before
> Phase 0 ends; everything below can be revisited during development.

---

## Tier 1 — effectively irreversible

| # | Decision | Why it's expensive | Recommendation | Locked by |
| --- | --- | --- | --- | --- |
| 1 | **Bundle ID** | **Cannot change once a build has been uploaded** — it even survives an app transfer. Getting it wrong means a new App Store listing and the loss of all reviews, ratings and ranking history | Root it in the **product's** domain, never the entity's: `co.<brand>.app`, not `com.kicksstand.*`. Blocked on brand clearance, not on enrolment | before first upload |
| 2 | **IAP product IDs** | Permanent in App Store Connect. Cannot be renamed or reused | `premium.monthly`, `premium.annual`. No brand, no price, no year in the string | Phase 0 |
| 3 | **The legal entity's name at D-U-N-S time** | A D-U-N-S must match the exact registered name. Renaming the LLC afterwards means re-registering and re-verifying with Apple — weeks | **Settled: Kicks-Stand LLC publishes.** The open question is only whether to rename it first ([doc 24 §1](24-apple-account-and-identifiers.md)) | before D-U-N-S |
| 4 | **Kids Category + age band** | Changeable, but the band drives every content and UX decision, and leaving the Kids Category after launch reads as a downgrade to parents | "5 and under" (doc 14 §1) | Phase 0 |
| 5 | **Collecting no data** | You can start collecting later, but the "Data Not Collected" label and the trust it buys can only be spent once. Adding an SDK later is a visible privacy-label change parents can see | Stay at zero for the MVP | Phase 0 |

## Tier 2 — expensive but survivable

| # | Decision | Why | Recommendation | Locked by |
| --- | --- | --- | --- | --- |
| 6 | **Engine (Flutter)** | A rewrite of the rendering layer; content and data survive (doc 01 §7) | Flutter + Flame | Phase 0 |
| 7 | **ThemeSlot vocabulary + token attribute set** | A public contract with every pack ever authored; renaming a slot invalidates all of them | Version it (`schemaVersion`), add-only, never rename. Get §3–4 of doc 05 right before the second pack exists | Phase 2 |
| 8 | **`GameModule` API** | Every game implements it; breaking it means touching all of them | Version it; freeze after game 3 proves it | Phase 4 |
| 9 | **Star ledger shape & earn rates** | Families build expectations around what an ice cream costs. Halving earn rates post-launch feels like theft to a seven-year-old | Append-only ledger from day one; rates in one constants file; only ever adjust *upward* after launch | Phase 3 |
| 10 | **Database schema + UUIDv7 / `updated_at` / tombstones** | Retrofitting sync-ready identity onto live family data is a migration nobody enjoys | Include them from row one — they cost nothing now | Phase 0 |
| 11 | **The free/premium line** | Removing something from the free tier post-launch generates one-star reviews | Free = all games + 1 theme. Sell themes, never safety (doc 08 §4) | Phase 6 |
| 12 | **Localisation architecture** | Retrofitting string extraction across a finished app is days of tedious, error-prone work | ARB keys from the first string, English-only at launch | Phase 0 |

## Tier 3 — cheap to change, but decide early anyway

| # | Decision | Recommendation |
| --- | --- | --- |
| 13 | Price point | $4.99/mo, $29.99/yr — App Store price testing makes this genuinely reversible |
| 14 | Which games ship first | Match Pairs, Shape Sorter, Jigsaw (three distinct input models) |
| 15 | Difficulty knob values | Data in one file; tune from playtests |
| 16 | Art style | Pick a direction before commissioning theme #2, so packs feel like one product |
| 17 | Achievement list | Data-driven; add freely |
| 18 | Quality-tier device table | Update every release |

## The rebranding checklist

Because the name is temporary, the codebase treats the brand as **configuration**:

- Product name appears **only** in `brand/brand_config.dart` and the ARB files as
  `{appName}` — never a literal in any other file. A CI check enforces this.
- Bundle ID and product IDs are brand-neutral (Tier 1).
- Package and directory names use the internal codename `playhub`, which is not
  the brand and never shown to a user.
- App icon, launch screen and palette are flavor assets, swapped by
  `tools/rebrand.dart`.
- The App Store display name is metadata and changes with a submission.

**Cost of a full rebrand at any point before launch: ~1 hour.** After launch: the
same, plus a store-listing update. That is the correct answer to your requirement
and it costs nothing to maintain.

## The questions still open

1. **Rename Kicks-Stand LLC, or keep the name?** Decide before requesting a
   D-U-N-S — after is expensive ([doc 24 §1](24-apple-account-and-identifiers.md)).
2. **Which domain carries the entity's website** for Apple enrolment —
   strideguide.co patched to name the LLC, or a new entity domain?
3. **Which brand**, so the product domain and bundle ID can be settled
   ([doc 26](26-naming-candidates.md))?

Settled since: the stack ([doc 01](01-tech-stack-decision.md)), pricing deferral
([doc 08](08-entitlements-and-monetization.md)), and the publisher
([doc 24](24-apple-account-and-identifiers.md)).
