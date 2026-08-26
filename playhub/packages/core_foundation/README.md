# core_foundation

The one thing this package owns: **primitives with no opinions**.

`Clock` · `Ids` · `Result` / `Failure` · `AppLogger`

It depends on nothing. Nothing here knows about games, themes, the database, or
Flutter. If a type here needs to import something, it is in the wrong package.
