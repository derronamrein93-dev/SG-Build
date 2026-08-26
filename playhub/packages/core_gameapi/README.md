# core_gameapi

The one thing this package owns: **the plug-in contract every game implements**.

`GameModule` · `GameSession` · `GameEvent` · `GameServices` · `DifficultyProfile`

Note what a game is *not* given: a database, an HTTP client, a `Navigator`, the
entitlement service, the star ledger, or the file system. A game receives a theme,
a difficulty profile and a seeded RNG; it emits events; the platform decides all
consequences.

`GameSession.build` returns a `Widget`, so a module may render with plain Flutter
or with Flame — the platform never learns which. See
`docs/23-flame-usage-policy.md`. **`flame` must never appear in this package's
dependencies**; `tools/check_boundaries.dart` fails the build if it does.
