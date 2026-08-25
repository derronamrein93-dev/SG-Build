# 16 — Exact MVP Scope

> **Status:** proposed. This is the contract for v1.0. Anything not listed as IN
> is OUT, and adding to it requires explicitly removing something else.

---

## 1. IN — v1.0

### Core shell
- Splash → home in ≤ 1.5 s on the floor device
- Child home: large game tiles (artwork from the active theme), a theme-appropriate
  guide character, sticker book entry, reward entry, profile switcher
- No reading required anywhere in the child shell; every action is a picture, an
  animation, and an optional spoken prompt
- Celebration screen, rest screen, "ask a grown-up" locked-content card
- Full portrait + landscape on phone and iPad

### Profiles
- Up to 2 free / 6 premium; nickname, avatar from a bundled set, age band,
  preferred theme, accessibility toggles (reduce motion, high contrast, larger
  targets, left-handed, voice on/off)
- Adaptive difficulty per profile per game, with a manual override

### Games — three, fully polished
1. **Match Pairs** (memory) — tap-only, 2×2 → 4×6
2. **Shape Sorter** (matching + sorting) — drag to bins, 2 → 4 bins, single- and
   two-attribute rules
3. **Jigsaw** — drag with snap, 2 → 24 pieces

Each with: three age bands, the five-level hint ladder, no failure state, a
seeded-deterministic board, and the ten-test contract suite passing.

### Themes — three, complete
**Farm Adventure** (free), **Dinosaur World**, **Ocean World** (premium) — each
with backgrounds, a guide character, a token catalog of ≥ 16 tagged items, a full
sound set, music, particle configs, 8 stickers, and per-game tile art.

### Progression
- Append-only star ledger, daily play cap, balance UI a 4-year-old can read
- 14 achievements with celebration, badges, confetti and sound
- Sticker book: 24 stickers (8 per theme), arrangeable

### Parent Hub
- Gate: 3-second corner hold + Face ID / Touch ID, PIN fallback, device-passcode
  recovery
- Dashboard with pending-approval badge
- Children: create / edit / delete profiles
- Screen time: enable, session limit, daily limit, break length, warnings, override
- Sound: master / music / SFX / voice / mute
- Display: quality AUTO / LOW / MEDIUM / HIGH with an explanation of AUTO's choice
- **Reward store** (premium): create, edit, activate/deactivate, reorder rewards;
  approve/decline requests; reward history; manual star grants with a note
- Subscription: paywall, purchase, restore, manage, current status
- Privacy: plain-language summary, what's stored, export/delete-all
- Diagnostics: version, quality tier, log export, database integrity check
- Guided Access explainer card

### Platform
- 100% offline; zero network calls; zero third-party SDKs
- Monthly + annual subscription, 7-day trial, Family Sharing, 30-day offline grace
- Backup export/import as a single file
- Localisation-ready (English only at launch, no hardcoded strings)
- VoiceOver, Dynamic Type and Reduce Motion support in the Parent Hub

## 2. OUT — explicitly not in v1.0

| Deferred | Why | When |
| --- | --- | --- |
| **Chore / task system** | Highest complexity per unit of validated demand; the schema and services exist but no UI ships | v1.1, ~4 weeks after launch |
| Games 4–10 | Three excellent beats ten mediocre — your own instruction | v1.1+, one per release |
| Themes 4–12 | Prove the pack pipeline with three first | continuous after launch |
| Downloadable content packs | Everything fits in the binary | when doc 11 §5 triggers |
| Lifetime purchase | See doc 08 §5 | if the price test justifies it |
| Android release | Architecture supports it; QA and store work don't fit v1.0 | v1.2 |
| Cloud sync / accounts | Destroys the "collects nothing" position for modest value | probably never; backup file covers the need |
| WATCH / CREATE / LEARN modules | Nav seam only | separate product decision |
| Ads | Not in a kids MVP | evaluate only with contextual, human-reviewed, Kids-compliant inventory |
| Push notifications | No permission requested | maybe a parent-only reminder in v1.2 |
| Multiple languages | Infrastructure ready, translation not | v1.2 |
| Room decoration / avatar accessories | Collectible schema supports them | v1.1 |

## 3. Definition of done for v1.0

- [ ] All CI gates green: analyze, ~500 unit tests, ~120 goldens, boundaries,
      themepack validation, size budget
- [ ] Eight integration tests passing on simulator
- [ ] Performance targets met on an iPhone SE (2nd gen) and a 2019 iPad
- [ ] 30-minute soak: no crash, no leak, ≤ 8% battery, no thermal throttle
- [ ] Every placeholder asset replaced with final art
- [ ] Three real children aged 3, 5 and 7 each complete a 15-minute unassisted
      session; a 3-year-old reaches a game within 10 seconds without help
- [ ] Five parents set up the app and configure a screen-time limit in under
      2 minutes without instructions
- [ ] Full compliance checklist (doc 14 §3) complete
- [ ] TestFlight with ≥ 15 families for ≥ 2 weeks with no P1 bugs

## 4. Rough effort

Not a promise, and it assumes Claude does the implementation with you reviewing:

| Phase | Elapsed (part-time review cadence) |
| --- | --- |
| 0 — foundation, CI, tooling | ~1 week |
| 1 — shell, profiles, gate, settings | ~2 weeks |
| 2 — theme engine + placeholder art pipeline | ~1.5 weeks |
| 3 — game 1 polished | ~2 weeks |
| 4 — games 2 & 3 | ~2.5 weeks |
| 5 — stars, achievements, collection | ~1.5 weeks |
| 6 — reward store | ~1 week |
| 8 — screen time | ~1 week |
| 9 — subscriptions | ~1 week |
| 10 — polish, a11y, compliance, art integration, submission | ~3 weeks |
| | **≈ 16–17 weeks** |

The two schedule risks are **real art** (external dependency, start commissioning
during Phase 2) and **App Review** (budget two rejection cycles).
