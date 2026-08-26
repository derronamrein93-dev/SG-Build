# 00 — Executive Summary

**Status:** proposed, awaiting approval. Nothing has been built.

---

## 1. The recommendation in one screen

| Question | Answer |
| --- | --- |
| Engine | **Flutter (stable) + Flame** for game rendering. Not Unity. |
| Language | Dart, one language for the whole product |
| State | Riverpod + Dart 3 sealed classes |
| Storage | SQLite via Drift — typed, migrated, transactional, testable on Linux |
| Star economy | **Append-only ledger.** Balance is a `SUM()`, never a mutable field |
| Games | Sandboxed plug-in packages. No DB, no network, no navigation access |
| Themes | Pure data packs. Zero Dart code. A theme is JSON + images + audio |
| Networking in MVP | **None.** Everything ships in the binary |
| Data collected | **None.** "Data Not Collected" on the App Store privacy label |
| Crash/analytics SDKs | **Zero third-party SDKs.** Apple's own App Analytics covers it |
| Purchases | StoreKit 2 via `in_app_purchase`, verified on-device, no server |
| MVP content | 3 polished games × 3 theme packs = 9 perceived experiences |
| Install size target | ≤ 80 MB download, ≤ 150 MB installed |
| Your manual work | ~6 hours total, once, mostly in App Store Connect |

## 2. Why not Unity

Your brief ranks "Claude can produce and maintain as much of the codebase as
possible" as constraint #1. That single constraint decides the engine.

Unity projects are not made of code. They are made of scenes, prefabs and
ScriptableObjects — YAML files full of 128-bit GUIDs and file IDs, authored by
dragging things in a GUI. Claude can write the C# in a Unity project, but it
cannot reliably author the half of the project that isn't C#, and — critically —
it **cannot compile or run a Unity project in the environment it works in**. Every
change would be unverified until you personally open the Unity Editor on a Mac
and look at it. That converts you, a non-engineer, into the build server.

Flutter is the opposite: every artifact is a text file, `flutter test` runs on a
plain Linux container, and Claude can therefore write a change, run the test
suite, see it fail, fix it, and only hand you code that provably works. Over a
year of maintenance that difference is worth more than everything Unity offers a
2D children's app — and what Unity offers here is genuinely small, because
nothing in your game list needs 3D, skeletal animation, or a physics engine.

Full evaluation, including the three conditions under which I'd reverse this
call: [01 — Technology Stack Decision](01-tech-stack-decision.md).

## 3. The architectural spine

Three things are separated on purpose, and nothing else is:

```
MECHANICS          CONTENT              PLATFORM
game_jigsaw        theme_dino           profiles, stars, screen time,
game_match_pairs   theme_ocean          achievements, rewards, tasks,
game_shape_sorter  theme_farm           entitlements, settings
     │                   │                        │
     └──── GameModule API ───── ThemeResolver ────┘
              (a contract, not a base class)
```

- A **game** receives a theme, a difficulty profile, a seeded random number
  generator and a services facade. It emits events. It cannot write to the
  database, open a URL, navigate, or know that subscriptions exist.
- A **theme** is data. `theme_dino` contains no Dart. Adding "Pirate Cove" is a
  folder of assets plus a manifest, validated by a script, shipped without an
  engineer.
- The **platform** owns all state and all consequences. Games *propose* stars;
  the platform decides and records them.

That boundary is the whole product strategy: it is why the 4th game costs a
fraction of the 1st, and why the 12th theme costs a fraction of the 4th game.

## 4. The five things I think you should change

Detailed argument in [21 — Critical Review](21-critical-review.md). Summarised:

1. **$0.99–$1.99/month is too cheap and will hurt you.** Kids-app subscriptions
   cluster far higher. At $1.49 you need ~4× the subscribers for the same revenue
   *and* the price signals low quality to the exact parent you're targeting.
   Recommend **$4.99/mo, $29.99/yr, 7-day trial**, and drop lifetime for now.
2. **Ages 2–8 is two products.** A 2-year-old and an 8-year-old share almost no
   UX. Design the centre at **3–6**, serve 2-year-olds with a simplified mode,
   serve 7–8 with difficulty scaling only. Don't build for the tails.
3. **Cap stars earned from playing.** If more screen time means more stars, your
   reward economy is fighting your core promise. Daily play-star cap, chores
   worth more per minute. This is a correctness issue, not a tuning knob.
4. **Never paywall screen-time limits or any safety control.** Free tier keeps
   every protective feature. Paywalling child safety is the kind of thing that
   gets written about.
5. **Chores ship after launch, not in the MVP.** Build the seams now (cheap),
   build the feature in v1.1. It is the highest-complexity, lowest-certainty
   feature in the brief and it will delay everything behind it.

I also recommend **not shipping any crash-reporting SDK**, which is unusual advice
and is explained in [13 — Privacy](13-privacy-and-child-safety.md). Apple already
gives you crash reports, installs, retention and subscription conversion for free,
with no SDK and no privacy-label consequences.

## 5. Where this stands

The stack, the pricing posture, the Apple account model and the repository split
are settled — see the [Decision Log](22-decision-log.md). Phase 0 is built:
six packages, 91 tests, zero analyzer issues, and the architecture's claims
turned into checks that fail the build ([27 — Phase 0 Status](27-phase-0-status.md)).

Three things now wait on you:

1. **Approve the repository extraction** — the exact commands are in
   [25 — Repository Migration Plan](25-repository-migration-plan.md). Nothing
   destructive runs until you say so.
2. **Pick a name** — [26 — Name Candidates](26-naming-candidates.md). It gates
   the domain, which gates Apple enrolment, which gates distribution.
3. **Start the legal entity and D-U-N-S** — the longest lead time in the whole
   project, and pure paperwork ([24 — Apple Account](24-apple-account-and-identifiers.md)).

Your part of Phase 0 is roughly two hours in App Store Connect once the account
exists, scripted step by step in
[18 — Automation vs Manual](18-automation-vs-manual.md).
