# 05 — ThemePack Architecture

> **Decision:** themes are versioned data packs addressed by a stable semantic
> slot vocabulary, with a three-level fallback chain and typed token catalogs.
> **Status:** proposed. **Reversal cost:** HIGH — the slot vocabulary is a public
> contract with every pack ever authored.

---

## 1. The economics this exists to create

| Artefact | Build cost (rough, relative) | What the player perceives |
| --- | --- | --- |
| A new game (logic + renderer + tests + tuning) | **10 units** | +1 activity |
| A new ThemePack (art + audio + manifest) | **1–2 units** | +N activities, since every game re-skins |
| A seasonal variant of an existing pack | **0.3 units** | "new content" |

With 3 games and 6 themes a parent perceives 18 experiences. That ratio is the
entire content strategy — and it only holds if **no game ever knows which theme
it is running**.

## 2. The hard rule

> A game references a **slot**. It never references a file, a colour, a character
> name, or a theme id. There is no `if (theme == 'dino')` anywhere in the codebase,
> ever, and a lint rule fails the build if a theme id string appears in a game package.

## 3. The slot vocabulary

Slots are namespaced, versioned strings. `ThemeSlot` is a value type, not a raw
string, so a typo is a compile error rather than a missing image at runtime.

```
bg.far / bg.mid / bg.near            parallax layers (near optional)
bg.color.top / bg.color.bottom       gradient fallback if layers are absent

char.guide.idle / .cheer / .point / .think     the theme's companion character
char.guide.vo.<promptKey>                      optional voiced lines

ui.accent.primary / .secondary / .surface / .onSurface
ui.frame.tile / ui.frame.card / ui.button.shape

sfx.pick / sfx.place / sfx.correct / sfx.tryAgain / sfx.roundComplete / sfx.starEarned
music.home / music.play.calm / music.play.upbeat

fx.celebrate.small / .large            particle CONFIGS (json), not images
fx.trail.drag

reward.sticker.<01..08>                the pack's collectible set
reward.badge.themeMastery

tile.<gameId>                          home-screen artwork for each game IN this theme

tokens.<setId>                         a TOKEN CATALOG — see §4
scene.<sceneId>                        a hero image (jigsaw source, find-the-object scene)
```

Every slot carries a **requirement level**: `required`, `recommendedWithFallback`,
or `optional`. `validate_themepack.dart` fails CI if a `required` slot is missing
for any game whose `requiredSlots` include it.

## 4. Token catalogs — the part most theme systems get wrong

A matching game does not need "a picture". It needs **objects with attributes it
can compare**. If the theme only supplies images, the game must hard-code which
image matches which — and the abstraction collapses.

So a ThemePack ships a typed catalog:

```jsonc
// theme_dino/theme.json  (excerpt)
"tokens": {
  "creatures": {
    "matchBy": ["identity", "color", "silhouette"],
    "items": [
      { "id": "trex",   "art": "tokens/trex.webp",   "vo": "vo/trex.opus",
        "attrs": { "color": "green",  "silhouette": "biped", "size": "large",
                   "count": 1, "category": "carnivore" } },
      { "id": "stego",  "art": "tokens/stego.webp",  "vo": "vo/stego.opus",
        "attrs": { "color": "blue",   "silhouette": "quadruped", "size": "large",
                   "count": 1, "category": "herbivore" } }
      // … 16 items minimum for a pack to support Shape Sorter at earlySchool
    ]
  },
  "shapes": { "matchBy": ["shape", "color"], "items": [ /* themed shape set */ ] }
}
```

The game queries semantically:

```dart
final set = theme.tokens('creatures');
final board = set.pickDistinctBy(Attr.color, count: cfg.itemCount, rng: rng);
final bins  = set.distinctValuesOf(Attr.category);      // Shape Sorter's bins
```

**Attribute vocabulary is closed and versioned** (`color`, `shape`, `silhouette`,
`size`, `count`, `category`, `initialSound`). A pack using an unknown attribute
fails validation. A game declares which attributes it needs; a pack that lacks
them simply doesn't offer that game — surfaced at build time, not to the child.

This is what allows Shape Sorter to run as "sort dinosaurs by herbivore/carnivore",
"sort sea creatures by colour", and "sort farm animals by size" with **zero code
difference**.

## 5. Manifest shape

```jsonc
{
  "schemaVersion": 1,
  "id": "dino",
  "contentVersion": 3,
  "nameKey": "theme.dino.name",
  "minAppVersion": "1.0.0",
  "tier": "premium",                    // free | premium
  "ageAppropriate": { "min": "toddler", "max": "earlySchool" },
  "palette": { "primary": "#2E7D5B", "secondary": "#E8A33D",
               "surface": "#F6F1E4", "onSurface": "#2A2118" },
  "assets": {
    "bg.far":  { "1x": "bg/far@1x.webp", "2x": "bg/far@2x.webp" },
    "char.guide.idle": { "rive": "char/guide.riv", "artboard": "guide",
                         "stateMachine": "moods" }
  },
  "audio": { "music.play.calm": { "src": "audio/calm.opus", "loop": true, "gain": -6 } },
  "fx": { "celebrate.large": { "low": "fx/celebrate_low.json",
                               "high": "fx/celebrate_high.json" } },
  "tokens": { /* §4 */ },
  "scenes": { "jigsaw.hero.01": { "2x": "scenes/valley@2x.webp", "difficultyMax": 24 } },
  "supports": ["match_pairs", "shape_sorter", "jigsaw"],
  "budgetBytes": 8388608
}
```

## 6. Resolution and fallback

`ThemeResolver.resolve(slot, quality)` walks a three-level chain:

```
1. the active ThemePack
2. the pack's declared `family` default   (e.g. "prehistoric" shared assets)
3. core defaults in apps/playhub/assets/core/   — brand-neutral, always complete
```

**A missing asset is never a crash and never an empty rectangle.** The core layer
guarantees every slot resolves to *something* — a neutral shape, a soft chime, a
grey gradient. Consequences:

- Placeholder-generated art can ship on day 1 and be replaced file-by-file, with
  no code change, exactly as the brief requires.
- A partially-authored pack is playable while it is being made.
- A corrupt downloaded pack degrades gracefully instead of bricking a game.

Resolution is cached per (theme, quality) and warmed on theme switch inside a
short character-led transition, so there is no pop-in.

## 7. Quality tiers inside a pack

One pack serves all tiers, without duplicating content:

| Tier | Backgrounds | Character | Particles | Textures |
| --- | --- | --- | --- | --- |
| LOW | gradient + far layer only | Rive, simplified state machine, 30 fps | `fx.*.low`, ≤ 24 particles | `@1x` |
| MEDIUM | far + mid, parallax | Rive full, 60 fps | `fx.*.high`, ≤ 80 particles | `@2x` |
| HIGH | far + mid + near, parallax + subtle blur | Rive full + idle flourishes | `fx.*.high`, ≤ 200 particles, trails | `@2x` |

Rive is chosen over sprite sheets for characters precisely because one vector file
covers all tiers at a fraction of the bytes.

## 8. Authoring and validation

`tools/validate_themepack.dart` runs in CI on every pack and checks:

1. schema version supported; unknown fields rejected (not ignored — typos die here)
2. every `required` slot present for every game in `supports`
3. token catalogs meet each supported game's minimum item count and attributes
4. every referenced file exists, decodes, and has correct dimensions/format
5. audio is Opus/AAC, mono where appropriate, peak-normalised, under duration caps
6. total pack size ≤ `budgetBytes` (default 8 MB) — a hard CI failure
7. palette contrast ratios meet WCAG AA against the surface colour
8. no file name collisions across `@1x`/`@2x`
9. `minAppVersion` is not newer than the current app version

`tools/gen_placeholder_art.dart` produces a complete, coherent stand-in pack:
procedurally generated flat-vector shapes in the pack's palette, simple
synthesised audio tones, and a generic guide character. Every slot filled, every
budget respected, so development is never blocked on an artist and the first
milestone is playable in the theme's *colours* even before a single asset exists.

## 9. Seasonal and variant packs

A pack may declare `extends: "dino"` and override a subset of slots. A Halloween
Dino pack is then ~15 files instead of 120, inherits the token catalog, and needs
no new validation rules. Seasonal packs may also declare an `activeWindow` so
they appear only in a date range — evaluated against the injected `Clock`, and
**never** used to create urgency or FOMO in the child UI. Out-of-window packs
simply aren't listed; nothing counts down at a five-year-old.
