# tools

| Script | What it guarantees |
| --- | --- |
| `check_boundaries.dart` | The architecture is real. A game package that imports the database fails the build |
| `validate_themepack.dart` | Every shipped ThemePack serves every game it claims |

Run everything CI runs:

```bash
dart run playhub_tools:check_boundaries
dart run playhub_tools:validate_themepack
```

Still to come in Phase 2: `gen_placeholder_art`, `new_game`, `new_theme`,
`rebrand`, `size_report`.
