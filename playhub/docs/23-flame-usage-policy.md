# 23 — Flame Usage Policy

> **Decision (approved):** Flutter is the application framework. Flame is used
> **selectively**, only where a game loop earns its place. Every screen defaults
> to plain Flutter until proven otherwise.
> **Status:** accepted. **Reversal cost:** low per screen, by design.

---

## 1. The rule

> **Default to Flutter. Reach for Flame only when a screen needs a continuous
> game loop over a mutable scene graph.** If the screen can be expressed as
> widgets reacting to state, it is a widget screen — even if it is inside a game.

Flame is a *renderer for one kind of surface*, not a house style. Using it where
Flutter is better costs us accessibility, hot reload, layout, text handling,
theming, testability and battery — all the things we chose Flutter for.

## 2. Where each is used

| Surface | Implementation | Why |
| --- | --- | --- |
| Home, tiles, profile switcher | **Flutter** | Layout, semantics, transitions, Hero animations. Nothing moves unless the child touches it |
| Parent Hub (all screens) | **Flutter** | Forms, lists, Dynamic Type, VoiceOver. Flame here would be malpractice |
| Onboarding, parent gate, paywall | **Flutter** | Text, input, accessibility |
| Sticker book, collection, reward browser | **Flutter** | Grids, drag-to-arrange, scroll physics — all native strengths |
| Celebration & rest screens | **Flutter + Rive**, optional Flame particle overlay | Composited widget animation is enough; a particle burst may be layered in |
| **Match Pairs** | **Flutter** | Honestly: it's a grid of flip animations. `AnimatedSwitcher` + `Transform` does it better and lighter than a game loop |
| **Shape Sorter** | **Flame** | Continuous drag with inertia, trails, drop-target proximity effects, many simultaneously animating sprites |
| **Jigsaw** | **Flame** | Free-position dragging over a scene, piece z-ordering, snap feedback, per-frame proximity checks |
| Future physics games (stacking, marble run) | **Flame** (+ `flame_forge2d`) | An actual simulation loop |
| HUD over any game (pause, stars, time nudges) | **Flutter**, layered above | The platform owns the HUD; it must not live in the game's scene |

**Note the consequence:** one of the three MVP games doesn't use Flame at all.
That is the policy working, not a gap. It also proves the boundary in the most
useful direction — the platform genuinely does not care how a module renders.

## 3. How the boundary is kept

`GameModule.createSession()` returns a `GameSession` whose only rendering
obligation is `Widget build(BuildContext)`. The platform never learns what is
inside.

```dart
// A Flutter-rendered game
class MatchPairsSession implements GameSession {
  Widget build(BuildContext c) => MatchPairsBoard(state: _state, onTap: _dispatch);
}

// A Flame-rendered game — the ONLY place Flame appears in the type system
class JigsawSession implements GameSession {
  Widget build(BuildContext c) => GameWidget(game: _JigsawGame(...));
}
```

Enforced by CI:

- `flame` is a dependency of **individual game packages only**. It appears in no
  core package's `pubspec.yaml`. `tools/check_boundaries.dart` fails the build if
  it ever does.
- No core type mentions a Flame type. `GameSession` returns a `Widget`.
- Every game's `lib/src/logic/` remains pure Dart — no Flutter, no Flame — so the
  rules of a Flame game are just as testable as a widget game's (doc 04 §3).

## 4. The escape hatch, in case a future game needs more

Because the contract is "return a Widget", a game module can return anything that
renders into one:

| Need | Path | Change to core |
| --- | --- | --- |
| Heavier 2D, physics | Flame + Forge2D | none |
| Custom shaders | `FragmentProgram` in a Flame layer | none |
| Real 3D | `flutter_scene` / an embedded surface | none |
| Something Flutter genuinely can't host | A separate app module, launched and returned from | `GameModule` gains a launch mode — a contained change |

So the answer to "are we trapped if a future game needs sophisticated
rendering?" is: **no, and we'd find out cheaply**, because the trap would be one
package deep rather than woven through the shell.

## 5. Battery consequence

This policy is also the battery policy. Flutter repaints only when something
changes, so the home screen, the Parent Hub, the sticker book and the rest screen
all draw **zero frames at rest**. A Flame `GameWidget` runs a loop, so it exists
only while a Flame-rendered game is on screen, and `pause()` stops its ticker on
backgrounding, on the HUD pause, and during screen-time warnings.

A child idling on the home screen deciding what to play costs nothing. That is a
direct consequence of not making the shell a game.
