# 03 — Repository Structure

> **Decision:** a Dart pub-workspace monorepo with hard package boundaries.
> **Status:** proposed. **Reversal cost:** low-medium.

---

## 1. Tree

```
playhub/                                  ← extract to its own repo before Phase 1
├─ .fvmrc                                 pinned Flutter SDK version
├─ pubspec.yaml                           workspace root (resolution: workspace)
├─ analysis_options.yaml                  very_good_analysis + custom rules
├─ melos.yaml                             ✗ not used — pub workspaces replace it
│
├─ apps/
│  └─ playhub/                            the only buildable Flutter app
│     ├─ lib/
│     │  ├─ main.dart                     3 lines: runApp(bootstrap())
│     │  ├─ bootstrap.dart                DI wiring, error zone, Flutter binding
│     │  ├─ brand/brand_config.dart       app name, colours, product IDs, URLs
│     │  ├─ routing/child_routes.dart
│     │  ├─ routing/parent_routes.dart
│     │  └─ registry/game_registry.dart   the ONE file edited to add a game
│     ├─ ios/                             Xcode project, entitlements, Info.plist
│     ├─ android/
│     ├─ assets/core/                     brand-neutral fallback art (see doc 05)
│     └─ test/                            app-level widget + golden tests
│
├─ packages/
│  ├─ core_foundation/                    Clock, Ids, Result, Failure, AppLogger
│  ├─ core_persistence/                   Drift database, DAOs, migrations, backup
│  ├─ core_domain/                        entities + services; NO widgets
│  │   └─ lib/src/{profiles,stars,achievements,rewards,tasks,
│  │                screen_time,difficulty,collection}/
│  ├─ core_theme/                         ThemePack model, slots, resolver, registry
│  ├─ core_gameapi/                       GameModule, GameSession, GameServices
│  ├─ core_ui_kit/                        design tokens + child/parent widgets
│  ├─ core_audio/                         AudioService, buses, ducking, VO queue
│  ├─ core_analytics/                     Telemetry interface + LocalOnlySink
│  ├─ core_entitlements/                  Entitlement model, PurchaseGateway
│  ├─ core_content/                       ContentManifest, pack sources, integrity
│  │
│  ├─ games/
│  │  ├─ game_match_pairs/
│  │  │   ├─ lib/src/logic/               PURE Dart state machine — no Flutter
│  │  │   ├─ lib/src/render/              Flame components + widgets
│  │  │   ├─ lib/game_match_pairs.dart    exports the GameModule
│  │  │   └─ test/                        logic tests run headless on Linux
│  │  ├─ game_shape_sorter/
│  │  └─ game_jigsaw/
│  │
│  └─ themes/
│     ├─ theme_farm/                      assets + theme.json  (ZERO Dart files)
│     ├─ theme_dino/
│     └─ theme_ocean/
│
├─ tools/                                 Dart CLI scripts, all runnable in CI
│  ├─ check_boundaries.dart               fails CI on an illegal import
│  ├─ validate_themepack.dart             every required slot present & valid
│  ├─ gen_placeholder_art.dart            procedural stand-in art for every slot
│  ├─ new_game.dart                       scaffolds a game package + tests
│  ├─ new_theme.dart                      scaffolds a ThemePack + manifest
│  ├─ rebrand.dart                        renames product strings & bundle IDs
│  ├─ size_report.dart                    per-package & per-pack byte budgets
│  └─ audio_optimize.dart                 normalises + encodes audio to Opus/AAC
│
├─ fastlane/                              TestFlight + App Store lanes
├─ .github/workflows/
│  ├─ ci.yaml                             Linux: analyze, test, goldens, boundaries,
│  │                                      themepack validation, size budgets
│  └─ release.yaml                        macOS: build, sign, upload to TestFlight
└─ docs/                                  these documents + ADR header blocks
```

## 2. Rules the structure enforces

1. **`apps/playhub` holds no business logic.** If a file there does anything but
   wire things together, it belongs in a package. Reviewed on every PR.
2. **A game package cannot import persistence, domain, routing, or `http`.**
   Checked mechanically. This is the guarantee that a new game cannot break the
   platform, and that a contractor writing game #7 cannot corrupt the star economy.
3. **A theme package contains no `.dart` file at all.** Checked mechanically.
   Themes are content; the moment a theme needs code, the slot vocabulary is wrong
   and should be extended instead.
4. **No file over ~400 lines**, no `utils.dart`, no `helpers.dart`. Enforced by
   review, warned by a lint.
5. **Every package has a `test/` directory** and its own README stating the one
   thing it owns.

## 3. Adding a game — the whole procedure

```bash
dart tools/new_game.dart --id maze --name "Maze"
# creates packages/games/game_maze with logic/, render/, tests, and a manifest
# … implement GameState + reducer, then the renderer …
flutter test packages/games/game_maze          # runs headless, no simulator
# register it:
#   apps/playhub/lib/registry/game_registry.dart  → add one line
```

**One line changed in the core application.** That is the modularity claim,
stated as a testable fact rather than an aspiration. A CI test asserts that the
registry's declared game IDs exactly match the packages present, so a forgotten
registration fails the build.

## 4. Adding a theme — the whole procedure

```bash
dart tools/new_theme.dart --id pirate --name "Pirate Cove"
dart tools/gen_placeholder_art.dart --theme pirate   # fills every slot with stand-ins
# … drop real art into packages/themes/theme_pirate/assets/ as it arrives …
dart tools/validate_themepack.dart --theme pirate    # slot coverage + budgets
```

**Zero lines changed in the core application** — themes are discovered from a
manifest index. A designer with no engineering support can ship a theme.

## 5. Branching, versioning, releases

- `main` is always releasable; work happens on short-lived branches.
- Conventional Commits, because they generate the changelog and the version bump
  automatically — Claude writes them consistently, which is exactly the kind of
  discipline automation is good at.
- App version = semver; build number = CI run number, monotonic forever.
- **Content version is independent of app version** (doc 11). A theme pack can be
  at v3 while the app is at 1.0.4.
- Every release tags the repo and attaches the size report so regressions in
  install size are visible in the release history.
