# 22 — Decision Log

Decisions the owner has made, in the order they were settled. Supersedes the
"open decisions" list.

---

## Settled — 25 Aug 2026

| # | Decision | Detail | Docs affected |
| --- | --- | --- | --- |
| D1 | **Flutter + Flame** | Flutter is the application framework; Flame is used **selectively**, only where a game loop earns its place. Do not force Flame into screens where plain Flutter is better. Keep the platform↔module boundary clean so a future game needing heavier rendering is not architecturally trapped | [01](01-tech-stack-decision.md), **[23](23-flame-usage-policy.md)** |
| D2 | **Pricing deferred** | Price-neutral product IDs and entitlement architecture. No price hard-coded anywhere. Hypothesis remains an inexpensive subscription with monthly + annual and possibly lifetime, to be validated later. Pricing is configuration and business logic, not architecture | [08 §3](08-entitlements-and-monetization.md) |
| D3 | **Apple Organization account intended** | The app is to be owned by a business entity. Development proceeds on provisional identifiers; nothing waits on enrolment until distribution | **[24](24-apple-account-and-identifiers.md)** |
| D4 | **Separate repository, immediately** | Independent repo, secrets, environment config, CI/CD, bundle IDs, signing, analytics config, subscription config, App Store config and documentation. Do not destabilise Stride Guide. History preservation is secondary to clean separation. **Show the migration plan before any destructive operation** | **[25](25-repository-migration-plan.md)** |
| D5 | **Name the product** | Ten candidates required; do not anchor on "PlayHub" | **[26](26-naming-candidates.md)** |

## Settled — 26 Aug 2026

| # | Decision | Detail | Docs affected |
| --- | --- | --- | --- |
| D9 | **D-U-N-S obtained** | Kicks-Stand LLC has a D-U-N-S on file. The number is deliberately **not** stored in this public repository; the remaining task is verifying the D&B record's name and address match INBiz | [24 §3.4](24-apple-account-and-identifiers.md) |
| D6 | **Kicks-Stand LLC is the publisher** | The existing Indiana LLC owns and publishes this product. **No new entity.** Supersedes my earlier recommendation — I found no material legal, tax, Apple, liability or branding reason to form one, and App Transfer covers a future spin-out | **[24](24-apple-account-and-identifiers.md)** |
| D7 | **Complete separation despite common ownership** | Brand, repository, bundle ID, infrastructure, **repo-scoped secrets**, analytics and product stay separate. The legal entity and the Apple Team ID are the only shared layers, and the Team ID is shared by construction | [24 §5](24-apple-account-and-identifiers.md), [25](25-repository-migration-plan.md) |
| D8 | **Kite stays provisional** | The brand is not committed until trademark clearance completes. The bundle ID waits on it too, since a bundle ID cannot change after the first build upload | [26](26-naming-candidates.md) |

## Assumed defaults — say the word to change any of them

| # | Assumption | Where |
| --- | --- | --- |
| A1 | Age design centre **3–6**, Tiny mode for 2s, top difficulty band for 7–8 | [21 §2](21-critical-review.md) |
| A2 | Kids Category, age band **"5 and under"** | [14 §1](14-app-store-compliance.md) |
| A3 | MVP games: **Match Pairs, Shape Sorter, Jigsaw** — three different input models | [04 §8](04-game-module-api.md) |
| A4 | MVP themes: **Farm** (free), **Dinosaur**, **Ocean** | [16](16-mvp-scope.md) |
| A5 | **Chores**: schema in the MVP, feature in v1.1 | [21 §7](21-critical-review.md) |
| A6 | **Daily cap on play-earned stars** (~30/day); chores and parent grants uncapped | [09 §4](09-stars-achievements-rewards.md) |
| A7 | **Screen-time and all safety controls stay free**, forever | [08 §4](08-entitlements-and-monetization.md) |
| A8 | **No third-party SDKs at all**, including crash reporting | [13 §3](13-privacy-and-child-safety.md) |
| A9 | Internal codename stays `playhub` until a brand is chosen | [20](20-expensive-decisions.md) |

## Awaiting a decision

| # | Question | Blocks | Recommendation |
| --- | --- | --- | --- |
| Q7 | **Should `SG-Build` stay public?** | Nothing technically — but 27 documents of product strategy, roadmap, pricing analysis and the intended brand name are publicly readable right now | Extract to a **private** repo ([doc 25](25-repository-migration-plan.md)). See [doc 28](28-public-repo-exposure.md) for what is currently exposed and why the brand name is the part that matters |
| Q1 | **Approve the repository migration plan?** | Steps A–E in [doc 25](25-repository-migration-plan.md). Phase 0 continues meanwhile | Approve after the Phase 0 scaffold lands, so the new repo's first commit is a green, tested project |
| Q2 | **Which name?** | The domain, which blocks Apple enrolment, which blocks distribution | **Kite**, alternate **Lantern**, safe harbour **Playgrove** ([doc 26](26-naming-candidates.md)) |
| ~~Q3~~ | ~~Rename Kicks-Stand LLC?~~ | **Closed.** The D-U-N-S is issued against the current name, so renaming is now a multi-week detour rather than a one-week decision. Kicks-Stand LLC is the name Apple gets, and the App Store seller line will read that way ([doc 24 §1](24-apple-account-and-identifiers.md)) |
| Q5 | **Entity website: patch strideguide.co, or register an entity domain?** | Apple enrolment — the current site names no legal entity at all | Option B: register `kicksstand.co` or `kicksstandllc.com` (both appear free) and publish a real corporate one-pager ([doc 24 §3.2](24-apple-account-and-identifiers.md)) |
| Q6 | **Is the LLC's address of record your home?** | It becomes the **publicly published** EU DSA trader address on the App Store product page | Move to a registered-agent or commercial address before enrolling ([doc 24 §1](24-apple-account-and-identifiers.md)) |
| Q4 | Which GitHub owner/org holds the new repo | Migration step A | Personal account now, transfer to the entity's org once it exists |
