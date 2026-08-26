# 04 — Game Module API

> **Decision:** games are sandboxed plug-in packages implementing a versioned
> interface, split into a pure logic core and a renderer.
> **Status:** proposed. **Reversal cost:** HIGH once several games exist.
> `GameApiVersion` is pinned and a golden test fails on any change.

---

## 1. Design goals, in priority order

1. A game **cannot** corrupt platform state — no database, no network, no
   navigation, no purchase awareness.
2. A game's rules are **testable without a screen**, so Claude can verify them in
   a Linux container.
3. Difficulty and theme are **injected**, never chosen by the game.
4. Adding a game touches **one line** of the core app.
5. A game that crashes or hangs **degrades to "back to home"**, never to a broken
   app or lost stars.

## 2. The contract

```dart
// packages/core_gameapi/lib/src/game_module.dart
const gameApiVersion = 1;

/// Static, cheap-to-construct description of a game. Loaded at startup for the
/// home screen; must not touch assets or do work.
abstract interface class GameModule {
  GameId          get id;              // stable, forever: 'match_pairs'
  int             get apiVersion;      // must equal gameApiVersion
  GameManifest    get manifest;
  Set<ThemeSlot>  get requiredSlots;   // validated against every ThemePack in CI
  Set<DifficultyKnob> get supportedKnobs;

  GameSession createSession(GameSessionRequest request);
}

class GameManifest {
  final String titleKey;            // localisation key — never a literal
  final String voPromptKey;         // spoken "let's match the shapes!"
  final ThemeSlot tileArtSlot;      // home-screen artwork comes from the THEME
  final AgeBand minAge, maxAge;
  final ContentTier tier;           // free | premium
  final Duration typicalRound;      // used by the screen-time grace window
  final InputModel input;           // tapOnly | drag | dragAndDrop | trace
  final bool supportsPortrait, supportsLandscape;
}
```

```dart
/// One playthrough. Owns no state the platform cares about.
abstract interface class GameSession {
  Stream<GameEvent> get events;
  Widget build(BuildContext context);

  Future<void> pause();     // called on backgrounding, screen-time warning, HUD pause
  Future<void> resume();
  Future<void> requestEndEarly();  // "wrap up gracefully within ~3 seconds"
  Future<void> dispose();

  /// Serialisable enough to survive a crash mid-round. May return null:
  /// resumability is optional, and the platform never depends on it.
  Map<String, Object?>? snapshot();
}

sealed class GameEvent {
  const GameEvent();
}
final class RoundStarted   extends GameEvent { final int roundIndex; }
final class ProgressChanged extends GameEvent { final double fraction; }
/// A positive beat: a correct match, a placed piece. Drives juice + micro-stars.
final class PositiveBeat    extends GameEvent { final BeatKind kind; final Offset? at; }
/// A wrong attempt. The platform NEVER punishes; it feeds the hint ladder.
final class MissedAttempt   extends GameEvent { final int consecutiveMisses; }
final class RoundCompleted  extends GameEvent {
  final int roundIndex;
  final int proposedStars;         // a PROPOSAL. The platform decides. See doc 09
  final GameOutcomeStats stats;    // durations, accuracy, hints used
}
final class SessionFinished extends GameEvent { final SessionSummary summary; }
final class GameFailedInternally extends GameEvent { final Failure failure; }
```

```dart
class GameSessionRequest {
  final ProfileRef profile;          // id + ageBand + accessibility prefs. NO name, NO birthdate
  final DifficultyProfile difficulty;
  final ResolvedTheme theme;         // slot → asset, already resolved & cached
  final QualityTier quality;
  final Random rng;                  // SEEDED. Same seed ⇒ same board ⇒ testable
  final GameServices services;
  final Map<String, Object?>? resumeSnapshot;
}

/// The only capability surface a game gets. Note what is absent.
abstract interface class GameServices {
  AudioBus     get audio;       // play(ThemeSlot) only — cannot load arbitrary files
  Haptics      get haptics;     // respects the parent's haptics setting
  VoiceOver    get voice;       // speak(promptKey) — respects the VO setting
  Ticker       get ticker;      // quality-tier-aware frame ticker
  GameTelemetry get telemetry;  // counters only, local-only sink
  Clock        get clock;       // never DateTime.now()
}
// Absent on purpose: Database. Navigator. HttpClient. EntitlementService.
// StarLedger. FileSystem. Purchases. Sharing. url_launcher.
```

## 3. The logic/render split

Every game package is two halves:

```
lib/src/logic/     pure Dart. imports: dart:math, dart:collection, core_gameapi types.
                   MUST NOT import flutter/ or flame/. Checked by CI.
lib/src/render/    Flame components + Flutter widgets. Reads logic, never decides rules.
```

The logic half is a reducer:

```dart
sealed class MatchPairsAction { }
final class CardTapped extends MatchPairsAction { final int index; }
final class FlipTimerElapsed extends MatchPairsAction { }

@immutable
class MatchPairsState {
  final List<CardModel> cards;
  final List<int> faceUp;
  final int matchesFound, misses, hintsUsed;
  final RoundPhase phase;

  MatchPairsState reduce(MatchPairsAction action);   // pure, total, deterministic
}
```

Which makes this an ordinary unit test, runnable on Linux in milliseconds:

```dart
test('a 3x2 board is always solvable and never repeats a pair', () {
  final s = MatchPairsState.initial(config: DifficultyConfig(pairs: 3),
                                    rng: Random(42), tokens: fakeTokens);
  expect(s.cards.length, 6);
  expect(countByPairId(s.cards).values, everyElement(2));
});

test('a mismatch never removes progress', () { ... });
test('after 4 consecutive misses the hint ladder reaches level 3', () { ... });
```

This is the property that makes an LLM-maintained game codebase safe. Rules are
verified without a device; rendering bugs are caught by golden tests.

## 4. Difficulty injection

Games never read the child's age. They receive knob values and honour the ones
they declared support for.

```dart
enum DifficultyKnob {
  itemCount,        // how many objects on screen
  distractorCount,  // how many wrong options
  gridSize,
  snapTolerance,    // forgiveness in logical pixels — LARGER is easier
  sequenceLength,   // pattern/memory length
  revealDuration,   // memory preview time
  rotationEnabled,
  timePressure,     // ALWAYS 0 in the MVP. Reserved, deliberately unused.
  hintDelay,        // seconds of no progress before hint level 1
}

class DifficultyProfile {
  final AgeBand band;                  // toddler | preschool | earlySchool
  final double mastery;                // 0..1, rolling per-child per-game signal
  num knob(DifficultyKnob k);          // resolved value, clamped to the band
}
```

`DifficultyDirector` (in `core_domain`) computes `mastery` from the last N plays
(completion rate, hints used, time vs the band median) and moves it by at most
**±0.08 per session**, clamped to the age band's window. Rules:

- **Difficulty never visibly decreases.** If mastery drops, the *next* session is
  easier; the current one is not downgraded mid-play. A child must never see the
  game get easier in front of them.
- **Bands are floors and ceilings, not suggestions.** A gifted 3-year-old can
  reach the top of the preschool band, never into earlySchool. Cognitive load,
  motor precision and reading ability are band properties, not skill properties.
- **Age band comes from the parent** and can be overridden per profile. If a
  parent sets "4", we do not silently decide the child is really a 6.

### Age band → knob windows (initial values, tuned in playtest)

| Knob | Toddler (2–3) | Preschool (4–5) | Early school (6–8) |
| --- | --- | --- | --- |
| itemCount | 2–4 | 4–9 | 6–20 |
| distractorCount | 0–1 | 1–3 | 2–6 |
| gridSize (memory) | 2×2–2×3 | 3×4 | 4×4–4×6 |
| snapTolerance | 88 dp | 56 dp | 32 dp |
| sequenceLength | 2 | 3–4 | 4–7 |
| revealDuration | 5 s | 3 s | 1.5 s |
| hintDelay | 4 s | 8 s | 15 s |

## 5. No failure states — the hint ladder

"No frustrating failure states" cannot mean "nothing ever goes wrong"; it means
**the child always reaches success, with escalating help**, and never sees a
red X, a buzzer, a life lost, or a "you lose" screen.

| Level | Trigger | Behaviour |
| --- | --- | --- |
| 0 | normal play | ambient encouragement only |
| 1 | `hintDelay` elapsed with no progress | the correct target breathes/glows |
| 2 | +1 hint delay, or 3 consecutive misses | a character points; VO gives a nudge |
| 3 | +1 hint delay, or 5 consecutive misses | wrong options fade back; only right ones remain interactive |
| 4 | +1 hint delay, or 7 consecutive misses | the piece drifts home itself, celebrated as a success |

A wrong tap produces a soft bounce, a warm "hmm?" sound and *no* progress loss.
Level 4 is a design commitment: **the child always wins**. Stars earned are
reduced only in the sense that a hint-heavy round gives base stars rather than
bonus stars — never fewer than the base, and the child is never told hints cost
anything.

## 6. Lifecycle, safety, and failure containment

- The **platform** owns pause. The HUD pause button, backgrounding, a screen-time
  warning, and an incoming call all call `pause()`. Games that ignore it are
  caught by a contract test.
- `GameRuntimeScreen` runs the session inside a guarded error zone. A thrown
  exception or a `GameFailedInternally` event → the round is abandoned, already
  banked stars are kept, a friendly character returns the child home, and the
  failure is written to the local log for the Parent Hub diagnostics screen. The
  child never sees an error message.
- A **watchdog**: if a session emits no event for 90 s while the app is
  foregrounded and no input has occurred, the platform offers "still there?" and
  returns home. Prevents a stuck game from silently burning the session timer.
- `snapshot()` is written at each `RoundCompleted`. On a crash, the next launch
  offers to resume. If the snapshot fails to parse, it is discarded silently.

## 7. The contract test suite every game must pass

`core_gameapi` ships `GameModuleContractTests` — a reusable suite. A game package
is not accepted until it passes:

1. `apiVersion == gameApiVersion`
2. Deterministic: identical seed + config ⇒ identical initial state, 100 runs
3. Every declared `requiredSlot` exists in every shipped ThemePack
4. The board is always solvable at every knob value in every band
5. `pause()` stops all timers; no events emitted while paused
6. `dispose()` releases every ticker, stream and image handle (leak check)
7. Never emits more than `manifest.maxStarsPerRound` proposed stars
8. Survives a `resumeSnapshot` from its own `snapshot()` output
9. Zero illegal imports (boundary check)
10. Runs a full round with a `FakeClock` in under 2 s of test time

Ten tests, written once, applied to every future game — including games written
by a contractor.

## 8. The three MVP games

| | **Match Pairs** | **Shape Sorter** | **Jigsaw** |
| --- | --- | --- | --- |
| Mechanic | memory matching | matching + sorting into bins | spatial assembly |
| Input model | tap only | drag & drop | drag with snap |
| Proves | timing, reveal, grid scaling | drag physics, drop targets, categorisation | image slicing, tolerance, progress |
| Toddler | 2×2, 5 s reveal | 2 bins, 3 objects | 2–4 pieces |
| Preschool | 3×4 | 3 bins, 8 objects, sort by two attributes | 6–12 pieces |
| Early school | 4×6 | 4 bins, mixed rules | 16–24 pieces |
| Theme demand | token set + backs | token set with attributes + bins | a themed hero image |

They are chosen to be maximally *different in input model* — tap, drag-to-bin,
drag-to-position — so that three games genuinely prove the framework rather than
three variations proving one path. A fourth game (Counting, Maze or Tracing)
should be added only after the framework has survived these three.
