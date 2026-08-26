# 17 — Development Phases

> **Status:** proposed. This modifies your suggested sequence in four places,
> each justified below.

---

## 1. Changes I recommend to your sequence

| # | Change | Reason |
| --- | --- | --- |
| 1 | **Move screen time from Phase 8 to Phase 1.** | It is the product promise, it touches app lifecycle and session accounting, and retrofitting session ownership into three finished games is far more expensive than building games inside an existing session model. It is also the feature most likely to need real-family tuning, so it needs the most calendar time in front of testers. |
| 2 | **Merge Phase 5 (stars/achievements) into Phase 3.** | The first game is not "polished" until completing a round produces stars, a celebration and a sticker. Building a game without its reward loop means building the feel twice. |
| 3 | **Move chores (Phase 7) out of the MVP entirely.** | See doc 16. Build the schema in Phase 6 (a few hours) and the feature after launch, when you know whether anyone wants it. |
| 4 | **Start commissioning real art in Phase 2, not Phase 10.** | Art has a multi-week external lead time and is the #1 schedule risk. The placeholder pipeline exists precisely so art can arrive asynchronously; use that. |

## 2. The phases

### Phase 0 — Foundation *(≈1 week, ~95% automatable)*
Extract the repo · Flutter workspace + pinned SDK · all package skeletons with
the dependency graph · Drift schema v1 + migration test harness · `Clock`,
`Failure`, `AppLogger`, `Result` · **all seven `tools/` scripts** · CI on Linux ·
`release.yaml` skeleton · brand config + flavors · this documentation committed.
**Exit:** `flutter test` is green on an empty app; a boundary violation fails CI;
`gen_placeholder_art.dart` produces a complete pack.
**You do:** Apple Developer enrolment, bundle ID, App Store Connect record, API key.

### Phase 1 — Shell, profiles, gate, settings, **screen time** *(≈2 weeks)*
Two route trees + the closure test · onboarding · profiles · avatar set · parent
gate (hold + biometric + PIN + recovery) · Parent Hub dashboard · audio & quality
settings persisted · `ScreenTimeGovernor` with the full ending sequence, using a
stub "game" · backup export/import.
**Exit:** a parent can set a 15-minute limit and watch a stub session end
gracefully, survive a kill, and be overridden.

### Phase 2 — Theme engine *(≈1.5 weeks)*
Slot vocabulary · `ThemeResolver` + three-level fallback · token catalogs ·
manifest schema + validator · quality-tier asset variants · placeholder generator
producing three complete packs · theme switching with transitions.
**Exit:** switching themes visibly re-skins the entire shell, and a deliberately
broken pack fails CI with a useful message.
**Start here:** brief and commission real art for Farm, Dino and Ocean.

### Phase 3 — Game 1 + the reward loop *(≈2 weeks)*
`GameModule`/`GameSession` finalised · `GameRuntimeScreen` + HUD · contract test
suite · **Match Pairs** end to end · difficulty director · star ledger ·
achievements · celebration · sticker book.
**Exit:** a real child plays Match Pairs in three themes at three difficulties and
earns stars that survive a force-quit.
**This is the milestone that validates the entire architecture.** If the game API
is wrong, it is wrong here — cheaply — rather than after three games exist.

### Phase 4 — Games 2 & 3 *(≈2.5 weeks)*
**Shape Sorter** (drag & drop, categorisation) then **Jigsaw** (spatial, snap).
Any change forced into `core_gameapi` by these two is a design signal to act on
immediately.
**Exit:** each game added ≤ 1 line to the core app; all contract tests pass; the
theme packs required no per-game special cases.

### Phase 5 — Reward store *(≈1 week)*
Reward CRUD · child browsing · request flow · two-phase approval · history ·
manual grants · task schema (no UI).
**Exit:** the double-approval and insufficient-balance property tests pass.

### Phase 6 — Subscriptions *(≈1 week)*
`EntitlementService` + StoreKit gateway · feature-flag gating throughout · paywall
(Parent Hub only) · restore · offline grace · StoreKit test configs · sandbox pass.
**Exit:** premium themes lock/unlock correctly across purchase, cancel, expire,
restore and 30 days offline.

### Phase 7 — Art integration & polish *(≈2 weeks, overlapping)*
Replace placeholders pack by pack · animation and transition polish · sound
design · haptics · VO recording · accessibility pass · golden re-baseline.

### Phase 8 — Hardening & submission *(≈2 weeks)*
Performance on floor devices · soak tests · compliance checklist · privacy policy
· store metadata and screenshots · review notes · TestFlight beta with 15 families
· fix · submit.

### Post-launch
v1.1 chores + game 4 + theme 4 · v1.2 Android + localisation · then a steady
cadence of one theme per release and one game per two releases.

## 3. Phase gates

No phase starts until the previous phase's **exit criterion** is demonstrably met
— shown by a green CI run and, from Phase 3 onward, a video of a real child using
it. The exit criteria are deliberately behavioural rather than "the code is
written", because the failure mode of an agent-built codebase is code that exists
and doesn't work together.
