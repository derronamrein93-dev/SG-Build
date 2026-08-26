# 22 — Decision Log

Decisions the owner has made, in the order they were settled. Supersedes the
"open decisions" list.

---

## Settled — 25 Aug 2026

| # | Decision | Detail | Docs affected |
| --- | --- | --- | --- |
| D1 | **Flutter + Flame** | Flutter is the application framework; Flame is used **selectively**, only where a game loop earns its place. Do not force Flame into screens where plain Flutter is better. Keep the platform↔module boundary clean so a future game needing heavier rendering is not architecturally trapped | [01](01-tech-stack-decision.md), **[23](23-flame-usage-policy.md)** |
| D2 | **Pricing deferred** | Price-neutral product IDs and entitlement architecture. No price hard-coded anywhere. Hypothesis remains an inexpensive subscription with monthly + annual and possibly lifetime, to be validated later. Pricing is configuration and business logic, not architecture | [08 §3](08-entitlements-and-monetization.md) |
| D3 | **Apple Organization account intended** | The app is to be owned by a business entity, and explicitly **not** by the existing Stride Guide / Kicks-Stand business. Development proceeds on provisional identifiers; nothing waits on enrolment until distribution | **[24](24-apple-account-and-identifiers.md)** |
| D4 | **Separate repository, immediately** | Independent repo, secrets, environment config, CI/CD, bundle IDs, signing, analytics config, subscription config, App Store config and documentation. Do not destabilise Stride Guide. History preservation is secondary to clean separation. **Show the migration plan before any destructive operation** | **[25](25-repository-migration-plan.md)** |
| D5 | **Name the product** | Ten candidates required; do not anchor on "PlayHub" | **[26](26-naming-candidates.md)** |

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
| Q1 | **Approve the repository migration plan?** | Steps A–E in [doc 25](25-repository-migration-plan.md). Phase 0 continues meanwhile | Approve after the Phase 0 scaffold lands, so the new repo's first commit is a green, tested project |
| Q2 | **Which name?** | The domain, which blocks Apple enrolment, which blocks distribution | **Kite**, alternate **Lantern**, safe harbour **Playgrove** ([doc 26](26-naming-candidates.md)) |
| Q3 | **Entity jurisdiction and structure** | D-U-N-S → Apple enrolment → all distribution. Longest external lead time in the project | Start today; it is 3–8 weeks of sequential waiting ([doc 24 §1](24-apple-account-and-identifiers.md)) |
| Q4 | Which GitHub owner/org holds the new repo | Migration step A | Personal account now, transfer to the entity's org once it exists |
