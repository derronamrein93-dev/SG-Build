# 15 — Testing Strategy

> **Decision:** a test pyramid weighted heavily toward pure-Dart logic tests that
> run in seconds on Linux, so Claude can verify its own work without your Mac.
> **Status:** proposed. **Reversal cost:** low, but the value compounds.

---

## 1. Why this matters more than usual here

In a normal project, tests protect against regressions. Here they do something
more specific: **they are the mechanism by which Claude closes its own feedback
loop.** Claude cannot see a simulator. It can run `flutter test`. Every piece of
behaviour that is expressible as a headless test is behaviour Claude can build,
break, notice, and fix unattended. Every piece that isn't becomes work you have
to verify by hand on a device.

This is why the logic/render split in doc 04 exists, why `Clock` is injected
everywhere, and why the RNG is seeded. Those aren't purity for its own sake —
they are what make the product buildable by an agent.

## 2. The pyramid

```
        ┌─────────────────────────────┐
        │  Manual device pass (~1 h)  │   before each release, on real hardware
        ├─────────────────────────────┤
        │  Integration (simulator)    │   ~15 tests, macOS CI, critical flows
        ├─────────────────────────────┤
        │  Golden / widget            │   ~120 tests, Linux, visual + interaction
        ├─────────────────────────────┤
        │  Unit + property (pure Dart)│   ~500 tests, Linux, < 30 s total
        └─────────────────────────────┘
```

## 3. Unit & property tests — the foundation

Run on Linux, no simulator, no license, in seconds.

**Star ledger** (the highest-stakes code in the product)
- balance always equals `SUM(delta)` after any sequence of operations
- *property test*: 10 000 random operation sequences never produce a negative balance
- the same idempotency key inserted twice is a no-op (double-tap, retry, crash-resume)
- approving a request twice moves stars exactly once
- concurrent approve + a new earn in one transaction leaves a consistent balance
- the daily cap holds across a midnight rollover and a DST change

**Screen time** — every scenario in doc 10 §7, driven by `FakeClock`.

**Difficulty director** — mastery converges; never exceeds band ceilings; never
decreases mid-session; a child who fails repeatedly still lands on a solvable board.

**Game logic** — the ten contract tests from doc 04 §7, applied to every game,
plus per-game rules (a jigsaw is always assemblable; a memory board always has
exactly two of each pair; a sorter always has at least one valid item per bin).

**Entitlements** — offline grace expiry; ambiguous states resolve in the
customer's favour; a fake gateway drives every StoreKit state transition.

**Persistence** — migration from every shipped schema version to HEAD, with
fixture databases; balances and row counts preserved; a corrupted DB triggers
restore, not data loss.

**ThemePack** — every bundled pack passes validation; a pack missing a required
slot fails; the fallback chain resolves every slot for a deliberately empty pack.

## 4. Golden & widget tests

Golden (screenshot) tests are unusually valuable in a *visual* product built by an
agent: they turn "did I break the layout?" into a diffable artifact.

- Home screen in each theme × each quality tier × phone/tablet
- Celebration, rest screen, sticker book, reward browser
- Parent Hub: dashboard, screen-time editor, reward editor, paywall
- Accessibility variants: high contrast, larger targets, reduce motion, largest
  Dynamic Type
- Interaction: hold-to-open gate fills and resets on early release; tapping a
  locked tile never navigates to a purchase screen

Goldens are generated on Linux CI only (never locally) so font rendering is
deterministic.

**Structural tests** (these encode the architecture as executable rules):
- `child_routes_are_closed_test` — no child route can reach a parent route
- `no_text_field_in_child_shell_test`
- `no_price_string_in_child_shell_test`
- `game_registry_matches_packages_test`
- `boundary_check_test` — wraps `tools/check_boundaries.dart`
- `no_theme_id_literal_in_games_test`
- `no_direct_datetime_now_test`

## 5. Integration tests (macOS CI, simulator)

Kept few and high-value, because they are slow and cost paid runner minutes:

1. First launch → onboarding → create profile → play a round → earn stars
2. Parent gate: hold + PIN success, wrong PIN lockout, biometric path (mocked)
3. Screen-time limit expires → round completes → celebration → rest → parent override
4. Reward request → parent approves → balance decreases exactly once
5. Purchase premium in the StoreKit test environment → premium themes unlock →
   kill app → still premium; then airplane mode → still premium
6. Restore purchases on a fresh install
7. Airplane mode from cold install: every free game fully playable
8. Kill mid-game → relaunch → banked stars intact, session resumable

`StoreKit Test` `.storekit` configuration files let purchase flows run in CI with
no App Store Connect round trip.

## 6. Manual pass (the honest list of what can't be automated)

Before each release, on a physical iPhone and iPad, roughly an hour:

- audio balance with the device speaker at 30% volume in a noisy room
- haptics feel
- battery and heat over a 30-minute session
- Face ID on a real face (and a real child failing it)
- a genuine 3–6-year-old playing unsupervised for 15 minutes while you watch
  without helping — **this is the single most informative test in the entire
  strategy and no amount of automation replaces it**

## 7. CI

**`ci.yaml` — Linux, on every push (free, ~4 minutes)**
`analyze` → `test` (all packages) → goldens → boundary check → themepack
validation → dependency-allowlist check (fails if a network-capable or
data-collecting package is added) → size budget report

**`release.yaml` — macOS, on tag (paid minutes, kept rare)**
build IPA → integration tests on simulator → `--analyze-size` report → sign →
upload to TestFlight via fastlane

Coverage targets: **`core_domain` ≥ 90%**, `packages/games/*/logic` **100%**,
UI packages untargeted (goldens cover them). Coverage is reported, not gated —
except for the two directories above, where it is gated, because that is where
the family's data lives.
