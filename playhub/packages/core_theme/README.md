# core_theme

The one thing this package owns: **the contract between game mechanics and
content**.

A game asks for a `ThemeSlot`. A ThemePack supplies one. Neither knows the other
exists. This package is where that vocabulary is defined, validated and resolved,
and it is deliberately pure Dart — it resolves slots to *asset paths*, and the
Flutter layer above loads them.

See `docs/05-themepack-architecture.md`. The slot vocabulary is a public contract
with every pack ever authored: **add, never rename**.
