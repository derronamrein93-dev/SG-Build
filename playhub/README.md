# Playhub — architecture package

**Codename:** `playhub` (internal only — never the brand; see [20 — Expensive decisions](docs/20-expensive-decisions.md))
**Product:** a modular mobile entertainment platform for children ages 2–8
**Status:** 🟡 **Architecture proposed — awaiting owner approval. No implementation started.**

> **The promise:** a parent unlocks their phone, opens this app, hands it to their
> child, and walks away for 15 minutes without worrying.

---

## ⚠️ This subtree does not belong in this repository

`SG-Build` is the Stride Guide footwear product. Playhub is an unrelated venture
and shares nothing with it — no code, no data model, no customers, no release
cadence. It lives here only because this branch is where the work was assigned.

**Before Phase 1 begins, extract it.** One command, full history preserved:

```bash
git subtree split --prefix=playhub -b playhub-extract
# then push playhub-extract to a new empty repo as its main branch
```

Reasons this matters: separate CI budgets (Playhub needs paid macOS runners,
Stride Guide does not), separate secrets (App Store Connect keys must not sit in
a repo scoped to a different product), separate issue tracker, and a clean
`git log` for a codebase that will eventually be handed to contractors.

---

## Read in this order

| # | Document | What it settles |
| --- | --- | --- |
| 00 | [Executive Summary](docs/00-executive-summary.md) | The whole recommendation in two pages |
| 01 | [Technology Stack Decision](docs/01-tech-stack-decision.md) | Flutter + Flame over Unity, and exactly why |
| 02 | [System Architecture](docs/02-system-architecture.md) | Layers, boundaries, runtime flow |
| 03 | [Repository Structure](docs/03-repository-structure.md) | Every folder, and the rules CI enforces |
| 04 | [Game Module API](docs/04-game-module-api.md) | The plug-in contract every game implements |
| 05 | [ThemePack Architecture](docs/05-themepack-architecture.md) | How one game becomes twelve products |
| 06 | [Local Data Model](docs/06-data-model.md) | Schema, migrations, integrity, backup |
| 07 | [Child / Parent Separation](docs/07-child-parent-separation.md) | Shells, the parent gate, kiosk behaviour |
| 08 | [Entitlements & Monetization](docs/08-entitlements-and-monetization.md) | Subscription architecture and pricing critique |
| 09 | [Stars, Achievements & Rewards](docs/09-stars-achievements-rewards.md) | The ledger, the economy, the ethics |
| 10 | [Screen Time](docs/10-screen-time.md) | Timing, tamper resistance, the friendly ending |
| 11 | [Offline & Content Delivery](docs/11-offline-and-content-delivery.md) | Bundled now, downloadable later, never broken |
| 12 | [Performance Strategy](docs/12-performance-strategy.md) | Quality tiers, AUTO detection, battery |
| 13 | [Privacy & Child Safety](docs/13-privacy-and-child-safety.md) | The zero-collection position |
| 14 | [App Store Compliance](docs/14-app-store-compliance.md) | Risks, checklist, the Kids Category call |
| 15 | [Testing Strategy](docs/15-testing-strategy.md) | What Claude can verify without a Mac |
| 16 | [Exact MVP Scope](docs/16-mvp-scope.md) | In, out, and the definition of done |
| 17 | [Development Phases](docs/17-development-phases.md) | Sequence, with the changes I recommend |
| 18 | [Automation vs Manual Work](docs/18-automation-vs-manual.md) | Your total manual workload, step by step |
| 19 | [Size & Performance Targets](docs/19-size-and-performance-targets.md) | Hard numbers CI will enforce |
| 20 | [Expensive Decisions](docs/20-expensive-decisions.md) | The twelve things that are costly to undo |
| 21 | [Critical Review](docs/21-critical-review.md) | Where I think your brief is wrong |
| 22 | [Open Decisions](docs/22-open-decisions.md) | **The nine answers I need from you** |

## The one-paragraph version

Build it in **Flutter with Flame**, not Unity — because the deciding constraint is
that Claude writes and maintains the code, and Flutter is 100% plain text that
Claude can compile and test unattended, while Unity's scenes and prefabs are
binary-ish YAML that cannot be authored or verified without a human sitting in
the Editor. The app is a thin shell around three separated layers: **mechanics**
(games, as sandboxed plug-in packages that cannot touch the database, the
network, or navigation), **content** (ThemePacks, which are pure data — a
dinosaur pack and a farm pack are JSON and PNGs, not code), and **the platform**
(profiles, stars, screen time, entitlements) sitting on a local SQLite database
with an append-only star ledger. Everything ships in the binary so it works on
airplane mode, collects **zero** data off-device, and asks the App Store privacy
questionnaire nothing but "Data Not Collected". Ship three excellent games and
three themes; the theme system is what makes it look like twelve.
