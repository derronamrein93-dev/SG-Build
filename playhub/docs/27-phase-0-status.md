# 27 — Phase 0 Status

> **Status:** foundation built, compiled and tested. Verified against
> **Flutter 3.47.1 / Dart 3.13.1** on Linux, with no Mac, no simulator and no
> Apple account.

---

## 1. What CI proves on every push

```
✓ dart format --set-exit-if-changed
✓ flutter analyze --fatal-infos          0 issues
✓ dart run playhub_tools:check_boundaries
✓ dart run playhub_tools:validate_themepack
✓ flutter test                           91 tests, all passing
✓ dart run playhub_tools:check_coverage
    core_persistence/dao   85.6%  (floor 85%)
    core_entitlements      92.2%  (floor 80%)
    core_theme             83.3%  (floor 75%)
    core_foundation        81.9%  (floor 80%)
```

Total wall time on this machine: about 45 seconds. That is the loop Claude
closes on its own — write, run, see it fail, fix, hand over something that
works. It is the entire reason for choosing Flutter (doc 01).

## 2. Packages built

| Package | Owns | Tests |
| --- | --- | --- |
| `core_foundation` | `Clock`, `Ids` (UUIDv7), `Result`/`Failure`, `AppLogger` | 15 |
| `core_theme` | Slot vocabulary, `ThemePack`, token catalogs, resolver, validator | 21 |
| `core_gameapi` | `GameModule`/`GameSession`, events, difficulty, services, **the reusable contract suite** | 12 |
| `core_persistence` | Full Drift schema (17 tables), migration strategy, `StarLedgerDao` | 15 |
| `core_entitlements` | `Feature`, `Entitlement`, `PurchaseGateway`, `FakeGateway` | 12 |
| `apps/playhub` | Composition root, `BrandConfig`, route trees, `GameRegistry` | 16 |
| `tools` | boundary checker, themepack validator, coverage gate | — |

## 3. The architectural claims, now executable

Each of these was a paragraph in the architecture. They are now tests that fail
the build:

| Claim | Enforced by |
| --- | --- |
| A game cannot touch the database, the network or navigation | `check_boundaries` — verified to exit 1 on an injected violation |
| A ThemePack contains no code | `check_boundaries` + `validate_themepack` |
| `flame` appears only in a game package that needs a loop | `check_boundaries` (doc 23) |
| A game's rules are testable without a screen | `check_boundaries` rejects `flutter`/`flame` under `logic/` |
| No `if (theme == 'dino')` anywhere | `check_boundaries` scans game sources for theme literals |
| No child route can reach a parent route | `route_separation_test` |
| No brand string, bundle ID or team ID outside `BrandConfig` | `no_hardcoded_identifiers_test` |
| **No price, currency or store product ID anywhere** | `no_hardcoded_identifiers_test` |
| No analytics, crash or ad SDK, ever | `check_boundaries` + `no_hardcoded_identifiers_test` |
| Adding a game is one line | `game_registry_test` compares the registry to the packages on disk |
| The star balance can never go negative | property test, 2,000 random operations |
| A retry, double-tap or crash-resume never double-awards | `idempotency_key UNIQUE` + tests |
| Two concurrent redemptions cannot overdraw | concurrency test |
| Play stars are capped daily; chores are not | `star_ledger_test` |
| Premium survives 29 days offline and lapses at 31 | `entitlement_service_test` |
| A store error never downgrades a paying customer | `entitlement_service_test` |
| Every theme slot resolves, even for an empty pack | `theme_resolver_test` |
| A four-year-old never faces a countdown | `timePressure` is 0 in every band, at every mastery |

## 4. Deliberately not built yet

`core_domain` services (Phase 1) · `core_ui_kit` beyond tokens (Phase 1) ·
`core_audio`, `core_content`, `core_analytics` (Phases 1–2) · the iOS and
Android platform folders (Phase 1, generated) · the three games (Phases 3–4) ·
the three ThemePacks (Phase 2) · `gen_placeholder_art`, `new_game`, `new_theme`,
`rebrand`, `size_report`, `apply_identity` (Phases 2 and 7).

The migration test harness has its strategy and its `beforeOpen` pragmas in
place; the fixture databases arrive with schema v2, since v1 has nothing to
migrate from.

## 5. Notes worth keeping

- **Generated code is not committed.** `*.g.dart` is ignored and CI runs
  `build_runner` before analysing, so a diff shows the change that matters.
- **`prefer_initializing_formals` is off**, with the reason recorded in
  `analysis_options.yaml`: it fires on `: _field = namedParam` and its suggested
  fix would make the parameter unusable by callers.
- **`core_gameapi` depends on `flutter_test`** as a real dependency, not a dev
  dependency, because `lib/testing.dart` ships the contract suite that every
  game package imports.
- **The dependency table in doc 02 was corrected** during the build:
  `core_gameapi` also depends on `core_theme` (for `ThemeSlot`) and on `flutter`
  (for `Widget`). Both are intentional and both are inside the boundary rules.

## 6. Next

Phase 0 finishes with the repository extraction, which is the one thing that
needs your approval: [doc 25](25-repository-migration-plan.md). Phase 1 then
begins in the new repository — shell, profiles, parent gate, settings and
screen time.
