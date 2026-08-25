# 12 — Performance & Battery Strategy

> **Decision:** four quality tiers driven by a device table plus a runtime probe;
> 60 fps ceiling (never 120); consistency and battery prioritised over effects.
> **Status:** proposed. **Reversal cost:** low.

---

## 1. Targets (enforced, not aspirational — see doc 19)

| Metric | Target | Floor device |
| --- | --- | --- |
| Cold start → interactive home | ≤ 1.5 s | iPhone SE (2nd gen) / iPhone 8 |
| Warm start | ≤ 0.5 s | " |
| Frame rate in game | 60 fps, **p99 frame time ≤ 16.6 ms** | " |
| Frame rate on menus | event-driven (0 fps at rest) | " |
| Dropped frames per minute of play | < 3 | " |
| Peak memory | ≤ 250 MB | " |
| Battery drain | ≤ 8% / 30 min of continuous play | " |
| Sustained device temperature | no thermal throttling in a 30-min session | " |

**Consistency beats peak.** A stable 45 fps feels better to a child than 60 fps
with a stutter every four seconds, and a phone that stays cool matters more to a
parent than a nicer particle effect. Where the two conflict, we choose the cool,
stable option every time.

## 2. Quality tiers

```dart
class QualitySettings {
  final int    particleBudget;      // max simultaneous particles
  final int    parallaxLayers;      // 1 | 2 | 3
  final bool   blurEffects;         // backdrop blur — expensive on old GPUs
  final bool   softShadows;
  final bool   idleAnimations;      // ambient character motion on menus
  final double textureScale;        // 1.0 | 2.0 asset variant
  final int    targetFps;           // 60, or 30 on LOW for menus
  final bool   riveFullStateMachine;
  final int    maxAnimatedSprites;
}
```

| | LOW | MEDIUM (default) | HIGH |
| --- | --- | --- | --- |
| Particles | 24 | 80 | 200 |
| Parallax layers | 1 | 2 | 3 |
| Blur / soft shadows | off | shadows only | both |
| Idle animations | off (menus static) | on | on + flourishes |
| Textures | `@1x` | `@2x` | `@2x` |
| Menu frame cap | 30 fps | 60 | 60 |
| Rive | simplified | full | full + secondary artboards |

Quality is a *presentation* concern only. **It never changes gameplay** — same
board, same difficulty, same stars. A child on a 2018 iPad and one on a new iPhone
play the identical game.

## 3. AUTO detection

```
1. Device table lookup (device_info_plus → machine identifier)
     known model → tier   (a maintained table, updated per release)
2. Unknown model → heuristic: RAM, core count, OS major version
3. First-launch runtime probe (~3 s, behind the splash character):
     render a representative scene at the candidate tier;
     if p95 frame time > 14 ms → demote one tier and re-probe once
4. Persist the result + a fingerprint (device model + OS version + app version).
   Re-probe only when the fingerprint changes — never on an ordinary launch.
5. Continuous safety net: if p95 frame time exceeds 20 ms for 10 consecutive
   seconds of play, drop one tier at the next screen transition, silently, and
   note it in diagnostics. Never upgrade mid-session (that causes visible pop-in).
```

The parent can always override AUTO with an explicit tier, and the Hub shows what
AUTO chose and why ("Medium — this device handles it comfortably").

## 4. The 120 Hz decision

ProMotion devices can run 120 fps. **We deliberately cap at 60.** Doubling the
frame rate roughly doubles GPU work and materially increases battery drain and
heat, for an improvement no 4-year-old will notice in a tap-and-drag game. The
product promise is *20 undisturbed minutes*, which is a battery-and-heat promise
more than a frame-rate one.

## 5. Concrete techniques

**Rendering**
- Impeller (default on iOS) removes the shader-compile jank that used to cause a
  first-run stutter on every new effect.
- `RepaintBoundary` around independently animating subtrees; a `debugRepaintRainbow`
  audit is part of the pre-release checklist.
- Backgrounds are static images or Rive, never per-frame `CustomPaint` gradients.
- No `Opacity` widgets in animation paths (use `FadeTransition` / `AnimatedOpacity`
  with `RepaintBoundary`); no `ClipPath` in scroll paths.
- Particles are a single `CustomPainter` over a pooled buffer, not N widgets.

**Memory & images**
- Texture atlases per theme; nothing above 2048×2048.
- `precacheImage` on route entry for the current theme's slots only; explicit
  eviction on theme switch and on `didReceiveMemoryPressure`.
- `ImageCache` capped at 64 MB / 120 entries.
- WebP for photographic assets, Rive for characters, SVG never at runtime
  (pre-rasterised at build time by a tool script).

**Audio**
- SFX preloaded into memory (all under ~40 KB each), music streamed.
- Opus ~64 kbps mono for VO, ~96 kbps for music.
- The audio engine is released after 30 s of silence in the background.

**CPU & timers**
- Exactly **one** periodic timer in the whole app (the 1 Hz screen-time tick).
  Everything else is event-driven. No polling, anywhere.
- Game loops run only while a game route is on top and the app is foregrounded.
- Heavy work (jigsaw mask generation, migrations, pack validation) on isolates.

**Startup**
- Deferred component initialisation: audio engine, telemetry and content scanning
  all initialise *after* the first frame.
- The native launch screen is pixel-identical to the app's first frame, so there
  is no flash of white.

## 6. Guarding against regression

- `flutter build ipa --analyze-size` on every release; the size report is attached
  to the tag and CI fails on a >5% jump (doc 19).
- A `flutter drive` performance test on a physical floor device runs before each
  release, asserting p99 frame time and dropped-frame counts through a scripted
  play session.
- A 30-minute soak test measuring battery delta and memory growth (leak detection)
  before each release.
- Every PR runs a widget-level "no unbounded rebuild" test on the home screen.
