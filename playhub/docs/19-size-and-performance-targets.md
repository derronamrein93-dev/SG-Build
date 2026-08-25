# 19 — Size & Performance Targets

> **Status:** proposed. These are CI-enforced budgets, not aspirations. A pull
> request that exceeds a budget fails.

---

## 1. Install size budget

| Component | Budget | Notes |
| --- | --- | --- |
| Flutter engine + Dart AOT (arm64, stripped) | ~14 MB | fixed cost of the framework |
| App Dart code (all packages) | ~4 MB | logic is small |
| Core assets (fallback art, avatars, UI, fonts) | 6 MB | brand-neutral, always present |
| Core audio (shared SFX, VO, UI sounds) | 5 MB | Opus, mono where possible |
| **Theme pack** — Farm | **8 MB** | hard per-pack cap |
| **Theme pack** — Dino | **8 MB** | |
| **Theme pack** — Ocean | **8 MB** | |
| Game assets (masks, shared shapes) | 2 MB | |
| **Total uncompressed** | **≈ 55 MB** | |
| **App Store download (thinned + compressed)** | **≤ 80 MB** ✅ | target |
| **On-device installed** | **≤ 150 MB** ✅ | including the database and caches |

Reference points: this is comfortably under Apple's cellular-download threshold,
so a parent can install it in a car park while a child waits — which is a real
acquisition moment for this product. Each additional theme costs ~8 MB; at 12
themes we would be ~140 MB and it becomes time to build the downloader (doc 11 §5).

**Enforcement:** `flutter build ipa --analyze-size` runs on every release;
`tools/size_report.dart` fails CI on a >5% increase without an explicit
`size-budget-change` label on the PR, and on any theme pack exceeding 8 MB.

**Asset rules that keep this true:** WebP for raster (not PNG) · Rive for
characters (a vector character is ~40–150 KB versus several MB of sprite sheets)
· Opus for all audio · no bundled video · one variable font subset to Latin ·
`@1x` and `@2x` only (no `@3x`; `@2x` downsampled is indistinguishable on a phone
at these art styles and saves ~35% of the raster budget).

## 2. Performance targets

| Metric | Floor device (iPhone SE 2 / iPad 6th gen) | Modern device |
| --- | --- | --- |
| Cold start → interactive | ≤ 1.5 s | ≤ 0.9 s |
| Warm start | ≤ 0.5 s | ≤ 0.3 s |
| Theme switch | ≤ 400 ms | ≤ 200 ms |
| Game launch (tap tile → playable) | ≤ 800 ms | ≤ 400 ms |
| In-game p50 / p99 frame time | ≤ 10 ms / ≤ 16.6 ms | ≤ 6 / ≤ 12 ms |
| Dropped frames per minute | < 3 | < 1 |
| Peak memory | ≤ 250 MB | ≤ 320 MB |
| Idle memory (home screen) | ≤ 120 MB | ≤ 150 MB |
| Battery, 30 min continuous play | ≤ 8% | ≤ 5% |
| Thermal state after 30 min | never above `.fair` | `.nominal` |
| Database write (a completed round) | ≤ 8 ms | ≤ 4 ms |

## 3. Device support floor

| | Supported |
| --- | --- |
| iOS | 15.0+ *(confirm at Phase 0 against current adoption; each version raised drops a small tail of old iPads that families genuinely still hand to children — this audience skews toward hand-me-down hardware more than almost any other)* |
| Devices | iPhone 8 / SE 2 and newer; iPad 6th gen (2018) and newer |
| Android (v1.2) | Android 8.0+, 2 GB RAM |
| Orientation | both, on both form factors |
| Screen | 4.7" to 12.9" |

**The floor device matters more than usual here.** Children's devices are
hand-me-downs. A product that only feels good on a current iPhone will feel bad
for a large share of the actual audience, so the iPad 6th gen is the reference
device for performance work — not the newest phone in your pocket.

## 4. Quality-tier assignment (initial table)

| Tier | Devices |
| --- | --- |
| LOW | iPhone 8/SE2, iPad 6th–7th gen, any device with ≤ 2 GB RAM, or a failed probe |
| MEDIUM | iPhone XR–12, iPad 8th–9th gen, iPad mini 5 |
| HIGH | iPhone 13 and newer, iPad Air 4+, any iPad Pro |

AUTO resolves to MEDIUM for unknown devices and demotes on a failed probe
(doc 12 §3).

## 5. Non-performance quality bars

- **No visible loading spinner in the child shell, ever.** If something takes
  time, the guide character does something charming while it happens.
- **Every touch produces feedback within 100 ms** — visual, audio, or haptic.
  This is the single strongest driver of "feels expensive" in a children's app.
- **Every animation is interruptible.** A child who taps during a transition is
  never blocked or ignored.
- **Minimum touch target 88×88 dp** in the child shell (well above the 44 pt
  guideline — a 3-year-old's finger is imprecise and their aim is worse when
  excited), 44×44 dp in the Parent Hub.
