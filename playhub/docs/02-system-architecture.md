# 02 — System Architecture

> **Decision:** a layered, package-enforced architecture with three isolated
> extension points (games, themes, content) and one authoritative state owner.
> **Status:** proposed. **Reversal cost:** medium — boundaries are cheap to keep
> and very expensive to reintroduce once violated.

---

## 1. Layer diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/playhub          Composition root ONLY                         │
│  • wires packages together   • flavors/brand   • route trees          │
│  • contains almost no logic — if logic appears here, it's misplaced   │
└──────────────────────────────────────────────────────────────────────┘
        │                              │                        │
┌───────▼────────┐          ┌──────────▼─────────┐   ┌──────────▼──────────┐
│  CHILD SHELL   │          │   PARENT SHELL     │   │   GAME RUNTIME      │
│ home, tiles,   │          │ gated; hub, store, │   │ hosts one GameSession│
│ celebration,   │          │ profiles, screen   │   │ enforces pause/quit,  │
│ rest screen    │          │ time, purchases    │   │ owns the HUD & timer  │
└───────┬────────┘          └──────────┬─────────┘   └──────────┬──────────┘
        └───────────────┬──────────────┴────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────┐
│  APPLICATION SERVICES  (core_domain)                                  │
│  ProfileService · StarLedger · AchievementEngine · ScreenTimeGovernor  │
│  RewardService · TaskService · DifficultyDirector · CollectionService  │
│  — all state transitions happen here, nowhere else —                  │
└───────────────────────┬──────────────────────────────────────────────┘
                        │
┌────────────┬──────────┴─────────┬────────────┬───────────┬───────────┐
│core_persist│ core_theme         │core_entitle│core_audio │core_content│
│ Drift/SQLite│ packs + resolver  │StoreKit 2  │SoLoud     │manifests   │
└────────────┴────────────────────┴────────────┴───────────┴───────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────┐
│  core_foundation — Clock, Ids, Result, AppLogger, Failure taxonomy    │
│  (depends on nothing)                                                 │
└──────────────────────────────────────────────────────────────────────┘

        ╔══════════════════════════════════════════════════════╗
        ║  EXTENSION POINTS — additive, no core changes needed  ║
        ║  packages/games/*    implement GameModule             ║
        ║  packages/themes/*   pure data, zero Dart             ║
        ║  future: content packs downloaded at runtime          ║
        ╚══════════════════════════════════════════════════════╝
```

## 2. The dependency rules (enforced by CI, not by discipline)

| Package | May depend on | May **never** depend on |
| --- | --- | --- |
| `core_foundation` | nothing | everything |
| `core_gameapi` | `core_foundation` | persistence, domain, UI, app |
| `packages/games/*` | `core_gameapi`, `core_ui_kit`, `flame` | persistence, domain, entitlements, router, `http` |
| `packages/themes/*` | *nothing — contains no Dart* | — |
| `core_domain` | foundation, persistence, theme | any widget library, any game |
| `apps/playhub` | everything | — |

`tools/check_boundaries.dart` parses every `pubspec.yaml` plus every `import` and
fails CI on a violation. This is the single most important piece of tooling in the
repo: it is what keeps "modular platform" true in month 18 rather than only in
month 1.

## 3. Runtime flow — a child taps a game tile

```
1. Tile tap
   └─ ChildShell asks EntitlementService.isUnlocked(gameId, themeId)
        ├─ locked  → gentle "ask a grown-up" card, a padlock, NO price, NO buy button
        └─ unlocked ↓
2. ScreenTimeGovernor.canStartSession()
        ├─ blocked → rest screen
        └─ ok ↓
3. GameLaunchCoordinator builds a GameSessionRequest:
        profileId, ageBand, DifficultyProfile (from DifficultyDirector),
        resolved ThemePack, QualityTier, seeded Random, GameServices facade
4. GameRegistry.resolve(gameId).createSession(request)
5. GameRuntimeScreen hosts the session, subscribes to its event stream,
   renders the HUD (pause, star count, time nudges) OUTSIDE the game's control
6. Game emits GameEvent.completed(score, proposedStars, telemetry)
7. GameRuntimeScreen forwards to core_domain, which — in ONE transaction —
        writes a game_play row
        appends star_ledger entries (idempotency key = playId)
        evaluates achievements and appends any unlocks
        updates the mastery signal used by DifficultyDirector
8. Celebration screen plays from platform-owned assets; collectibles awarded
9. Return to home
```

**The rule that makes this safe:** step 7 is the only place state changes. The
game proposed a number; the platform decided it, capped it, deduplicated it, and
recorded it. A buggy or malicious game module cannot corrupt the economy.

## 4. Boundary contracts

Four interfaces carry the whole architecture. Everything else is an
implementation detail that can be rewritten in an afternoon.

| Contract | Lives in | Stability requirement |
| --- | --- | --- |
| `GameModule` / `GameSession` | `core_gameapi` | Versioned. Breaking it breaks every game. Doc 04 |
| `ThemeSlot` vocabulary | `core_theme` | Versioned. Breaking it breaks every pack. Doc 05 |
| Drift schema | `core_persistence` | Migrations only, never destructive. Doc 06 |
| `ContentManifest` | `core_content` | Versioned; old apps must ignore unknown fields. Doc 11 |

Each of these is on the expensive-to-change list (doc 20) and each gets a
`SCHEMA_VERSION` constant plus a golden test that fails loudly if it changes.

## 5. Cross-cutting services

- **`Clock`** — every time-dependent behaviour (screen time, daily rollovers, task
  schedules, entitlement grace periods) takes an injected `Clock`. Tests use a
  `FakeClock`. There is no direct `DateTime.now()` call anywhere outside
  `SystemClock`. A lint rule enforces it. This is what makes screen time testable.
- **`Failure` taxonomy** — a sealed hierarchy (`StorageFailure`, `ContentFailure`,
  `PurchaseFailure`, `IntegrityFailure`). No exception escapes to the child UI;
  the child shell's worst case is a friendly character shrugging and returning
  home. Failures are logged locally and shown in full only inside the Parent Hub's
  diagnostics screen.
- **`AppLogger`** — ring buffer in memory plus a rotating local file, capped at
  1 MB. Never leaves the device. Exportable by the parent as a support file.
- **`Telemetry`** — an interface with a local-only sink in the MVP. Doc 13.

## 6. Threading and isolates

Flutter is single-threaded by default; jank in a children's app reads as
"broken". Anything that could exceed ~4 ms runs off the UI isolate:

- image decoding (Flutter does this natively off-thread),
- jigsaw piece mask generation → `Isolate.run`,
- database migrations and the first-launch content scan → background isolate with
  a splash character animating meanwhile,
- ThemePack manifest parsing and validation → background isolate,
- hash verification of downloaded packs (post-MVP) → background isolate.

## 7. Startup sequence (budgeted)

| Step | Budget | Notes |
| --- | --- | --- |
| Flutter engine + first frame | ~400 ms | Native splash matches the app background exactly, so there is no flash |
| Open DB, run pending migrations | ≤ 150 ms | Migrations that could exceed this show a progress character |
| Load settings + active profile | ≤ 30 ms | Single indexed query |
| Resolve quality tier (cached) | ≤ 5 ms | Full probe only on first launch / after upgrade |
| Warm the active ThemePack's home-screen assets | ≤ 300 ms | Only home-screen slots; game assets load at launch time |
| Interactive home screen | **≤ 1.5 s total on an iPhone SE (2nd gen)** | Enforced by an integration test |

Profile selection is *not* on the startup path: the app resumes the last active
profile and offers a switcher, because a 3-year-old should not have to choose
who they are before playing.

## 8. What is deliberately absent

- **No backend.** No accounts, no server, no sync, no remote config in the MVP.
  Every one of those adds privacy surface, compliance burden, operating cost, and
  an offline failure mode, for zero MVP value.
- **No dependency injection framework** beyond Riverpod.
- **No plugin/scripting runtime for games.** Games are compiled-in packages. A
  runtime script engine would let you ship games without an app update, but it
  invites App Store §2.5.2 problems in a children's app and is not worth it.
- **No ECS.** Flame's component tree is sufficient for tap-and-drag games.
