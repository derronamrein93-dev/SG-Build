# 01 — Technology Stack Decision

> **Decision:** Build on **Flutter (stable channel) with Flame** for game surfaces.
> **Status:** proposed
> **Reversal cost:** total rewrite. This is decision #1 on the expensive list.
> **Confidence:** high, with three named conditions that would reverse it (§6).

---

## 1. What is actually being built

Before choosing an engine, be honest about the product's composition. Measured in
code and in effort, this is roughly:

| Part | Share of the work | Nature |
| --- | --- | --- |
| Parent Hub (forms, lists, settings, purchases, approvals) | ~30% | Conventional app UI |
| Platform services (profiles, stars, achievements, screen time, persistence, entitlements, content) | ~35% | Business logic + database |
| Child shell (home, tiles, transitions, celebration, rest screen) | ~15% | Animated app UI |
| Game mechanics | ~20% | 2D, sprite-based, no physics, no 3D |

**Only a fifth of this product is a game.** And that fifth is drag-and-drop,
tap-to-match, and snap-to-target — the least demanding category of 2D game there
is. Choosing a heavyweight 3D game engine to build a forms-heavy app with a
sprite layer is the wrong shape.

## 2. Candidates evaluated

| | **Flutter + Flame** | **Unity 6** | **Godot 4** | **Native (SwiftUI+SpriteKit)** | **React Native** |
| --- | --- | --- | --- | --- | --- |
| Everything is plain text | ✅ 100% | ❌ scenes/prefabs are GUID YAML | ⚠️ `.tscn` is text but editor-centric | ✅ | ✅ |
| **Claude can compile & test it unattended** | ✅ on Linux, free | ❌ needs licensed Editor | ⚠️ headless possible, fragile | ❌ needs macOS+Xcode | ✅ |
| Android without a rewrite | ✅ | ✅ | ✅ | ❌ disqualifying | ✅ |
| Forms/settings UI quality | ✅ best in class | ❌ painful | ❌ painful | ✅ | ✅ |
| 2D game feel | ⚠️ good | ✅ best | ✅ very good | ✅ | ❌ |
| 3D, skeletal, heavy physics | ❌ | ✅ | ✅ | ⚠️ | ❌ |
| Cold start on old hardware | ✅ ~0.8–1.2 s | ⚠️ ~2–3 s | ✅ ~1 s | ✅ | ⚠️ |
| Idle battery draw on menus | ✅ repaints only on change | ❌ renders continuously by default | ❌ same | ✅ | ✅ |
| Baseline install size (iOS) | ~20 MB | ~35–45 MB | ~25 MB | ~5 MB | ~15 MB |
| First-party IAP / StoreKit 2 | ✅ `in_app_purchase` | ✅ Unity IAP | ❌ third-party plugins | ✅ | ✅ |
| Accessibility (VoiceOver, Dynamic Type, reduce-motion) | ✅ built in | ❌ weak, manual | ❌ weak | ✅ | ✅ |
| Automated UI/golden tests | ✅ free, fast, on Linux | ⚠️ needs licensed runner | ⚠️ | ⚠️ | ✅ |
| Remote content delivery | ⚠️ build it (simple: zip + manifest) | ✅ Addressables | ⚠️ | ⚠️ | ⚠️ |
| Cheap asset ecosystem | ⚠️ smaller | ✅ Asset Store | ⚠️ | ⚠️ | ❌ |

React Native is eliminated on game feel. Native-only is eliminated by your
Android requirement. Godot is a credible second choice but loses to Flutter on
iOS IAP maturity, accessibility, and app-UI ergonomics — the three areas where
70% of this product lives.

So it is **Flutter vs Unity**, and the tiebreaker is your own constraint #1.

## 3. The Unity problem, stated precisely

Unity's strength is a visual editor. That strength is the exact liability here.

1. **Half a Unity project is not source code.** Scenes, prefabs, ScriptableObject
   assets, animator controllers, and `.meta` files are YAML keyed by 128-bit
   GUIDs and file IDs. An LLM editing that by hand produces plausible-looking
   files that silently break references. There is a workaround — build every
   screen procedurally in C# and forbid hand-authored scenes — but it means
   deliberately abandoning the feature you chose Unity for.
2. **Claude cannot run it.** The environment Claude works in is a Linux container
   with no Unity license, no GPU, and no Editor. Unity's test runner needs a
   licensed installation. So every C# change would be *unverified* until you
   personally open the Editor and press Play. Over a multi-year, Claude-maintained
   codebase, the compounding cost of unverifiable changes is the single largest
   risk to this project — larger than any feature decision in the brief.
3. **You become the build server.** Your brief says you are not an engineer and
   want minimal manual work. Unity's workflow structurally requires a human in
   the Editor. Flutter's does not.
4. **Idle battery.** Unity renders continuously. On a static home screen with a
   child deciding what to play, that is wasted GPU and heat. Flutter's UI repaints
   only when something changes; a Flame game loop runs only while a game is open.
   For a product whose promise is "hand the phone over for 20 minutes", this is a
   real, measurable advantage.
5. **Accessibility.** Unity has no meaningful VoiceOver/Dynamic Type story. Apple
   scrutinises accessibility in children's apps. Flutter gives it to you free.

None of this makes Unity a bad engine. It makes Unity the wrong engine for *this*
product built *this* way.

## 4. What Flutter costs us, honestly

I am not going to pretend this is free.

| Cost | Severity | Mitigation |
| --- | --- | --- |
| Flame is far less mature than Unity's 2D stack | Medium | MVP mechanics need sprites, tweens, gestures and particles — all well within Flame 1.x. No physics in the MVP. |
| No Asset Store equivalent for cheap game art | Medium | Art is bought as raw PNG/SVG/Rive from marketplaces and slotted through the theme layer, which is engine-agnostic anyway. |
| Skeletal animation is weaker | Low–Medium | Use **Rive** (best-in-class Flutter runtime, tiny vector files, scales cleanly across quality tiers) for character animation. Lottie as fallback. |
| Remote content delivery must be hand-built | Low | It's a signed JSON manifest plus hash-verified zip downloads — ~400 lines. Simpler than Addressables and easier to reason about. |
| Smaller pool of *game* developers if you hire | Medium | Larger pool of *app* developers. And 80% of this codebase is an app. |
| If you later want true 3D | High | You would rewrite the game layer. See §6. |

## 5. The stack, concretely

| Concern | Choice | Why this one |
| --- | --- | --- |
| Framework | Flutter, stable channel, **pinned via FVM** and recorded in `.fvmrc` | Reproducible builds; CI and local use the identical SDK |
| Renderer | Impeller (iOS default) | Eliminates the shader-compilation jank that plagued Skia |
| Game layer | `flame` | Sprite/component/game-loop primitives; used only inside game packages |
| Monorepo | **Dart pub workspaces** (built into the SDK) | No Melos, no extra tooling, one `pub get` for all packages |
| State | **Riverpod** | Testable without a widget tree; compile-time safe; no `BuildContext` coupling |
| Models | Dart 3 sealed classes + hand-written `toJson`/`fromJson` | Deliberately avoids a second code generator. See note below |
| Database | **Drift** over SQLite (WAL mode) | Typed queries, real migrations, transactions, runs in plain Dart tests on Linux |
| Secrets (parent PIN) | `flutter_secure_storage` (Keychain) + PBKDF2 | PIN hash never in the database |
| Biometrics | `local_auth` | Face ID as the primary parent gate; PIN as fallback |
| Navigation | `go_router`, two disjoint route trees | Structurally prevents child→parent navigation. See doc 07 |
| Audio | `flutter_soloud` behind an `AudioService` interface | Low-latency SFX, mixed buses, swappable |
| Animation | Flutter implicit/explicit animations + **Rive** | Vector, small, quality-tier friendly |
| Purchases | `in_app_purchase` (StoreKit 2) behind `PurchaseGateway` | First-party, no server needed |
| Localisation | `flutter_localizations` + ARB from day 1 | English-only at launch, but no hardcoded strings, ever |
| Lint | `very_good_analysis` + custom boundary lint | Strict by default |

**Note on code generation:** Drift requires `build_runner`. That is the *only*
generator in the project. I am explicitly rejecting `freezed` + `json_serializable`
+ `riverpod_generator` — three more generators, three more failure modes, slower
CI, and worse error messages, in exchange for saving boilerplate that Claude
writes for free anyway. One generator, one command.

## 6. What would reverse this decision

I will change this recommendation if any of these become true:

1. **You want real 3D or physics-driven play** (a marble run, a ragdoll,
   3D character customisation) as a *core* pillar rather than one game. Then
   Unity or Godot.
2. **You intend to hire a game studio** rather than have Claude build it. A
   studio's existing Unity pipeline is worth more than Claude's Flutter velocity.
3. **You license a third-party content SDK that is Unity-only** — some kids'
   character/IP licensors ship Unity packages exclusively.

None of these appear in your brief. If one is actually true, say so in
[22 — Open Decisions](22-open-decisions.md) and I will re-plan before Phase 0.

## 7. Insurance against being wrong

The architecture is designed so that reversing the engine, while expensive,
does not destroy the valuable assets:

- **ThemePacks are engine-neutral** — PNG, WebP, Rive, Opus and JSON. They port
  to any engine untouched.
- **Game logic is a pure Dart state machine** separate from rendering (doc 04).
  Porting a game means rewriting its renderer, not its rules.
- **The data model is plain SQLite.** Any engine can read it.
- **No brand strings, product IDs, or bundle identifiers are embedded in code.**

Worst case, an engine change costs the rendering layer — roughly 20% of the
codebase — not the product.
