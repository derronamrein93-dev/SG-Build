# 08 · Design Language

**Reference points:** Apple Health, a Tesla service interface, premium
medical-retail technology, enterprise SaaS with consumer-grade simplicity.

**Anti-references:** gaming dashboard, crypto app, neon startup toy, generic CRM,
medical device software from 2005.

---

## 1. The pivot

The current Stride Guide identity — electric green `#39FF14` on near-black —
reads as gaming hardware. It photographs well on a dark landing page and it works
against every goal of this product:

- A store owner will not put a black-and-lime interface on their sales floor next
  to leather boots and wood shelving.
- A customer reading a lime-on-black report does not think "premium fitting."
- Investor materials in that palette get pattern-matched to consumer gadgets, not
  retail infrastructure.

**Recommendation:** the product moves to a **warm-neutral light** interface with
a single deep teal accent. Electric green is retired as brand chrome and survives
in exactly one place — **sensor data visualization** — where a saturated hot
color is functionally correct and reads as instrumentation rather than decoration.

That split is the whole idea: **the interface is calm; the data is vivid.**

## 2. Palette

### Store Light — the product default

| Token | Hex | Use |
| --- | --- | --- |
| `--surface-base` | `#F7F6F3` | App background. Warm bone, not clinical white — it is what makes the UI feel retail rather than hospital. |
| `--surface-raised` | `#FFFFFF` | Cards, sheets, the report page |
| `--surface-sunken` | `#EFEDE7` | Input wells, inactive segments |
| `--line` | `#E2DFD8` | Hairlines, dividers |
| `--line-strong` | `#CDC9C0` | Input borders, selected outlines |
| `--ink` | `#14181B` | Primary text |
| `--ink-secondary` | `#4E575E` | Labels, supporting text (7.4:1 on base) |
| `--ink-muted` | `#6E7981` | Captions, metadata (4.9:1 on base) |
| `--accent` | `#0F5C5B` | Brand teal — primary buttons, selection, active states |
| `--accent-hover` | `#0B4746` | |
| `--accent-wash` | `#E4EFEE` | Selected chip fill, subtle highlight |
| `--sand` | `#E9E3D6` | Warm fill for secondary emphasis |
| `--success` | `#1F7A5A` | Confirmations |
| `--attention` | `#9A6414` | Flags, "review this" |
| `--alert` | `#A6342B` | Errors only. Never for health content — a red flag next to a customer's foot data reads as a diagnosis. |

### Scan Dark — hardware capture view only

Used on the scan screen when the platform is live, and nowhere else. The contrast
between calm and vivid is the moment the hardware feels impressive.

| Token | Hex |
| --- | --- |
| `--scan-bg` | `#0E1214` |
| `--scan-surface` | `#161C1F` |
| `--scan-line` | `#232B2F` |
| `--scan-ink` | `#F2F4F3` |

### Pressure ramp (data only)

Perceptually ordered, low → high. Deliberately **not** lime:

`#0B2E33` → `#125F66` → `#1E8A80` → `#8FBF7A` → `#E3C97E` → `#E08A3C` → `#FDF3E6`

Deep teal for light load, warm amber-white for peak. Reads as instrumentation,
survives print and projection, and is distinguishable in the most common forms of
color vision deficiency. Always paired with a labeled legend — never color alone.

## 3. Typography

| Role | Face | Notes |
| --- | --- | --- |
| Interface | **Inter** (variable) | Excellent at small sizes on tablets; tabular numerals for every measurement. |
| Report headings | **Source Serif 4** | A serif makes the report read as a *document*. This single choice does more for perceived premium than any other decision in this file. |
| Data / IDs | System mono stack | Report IDs, device serials, timestamps only. |

**Retire Space Grotesk.** Geometric grotesques read technical-playful — the exact
register being moved away from.

| Style | Size / weight | Use |
| --- | --- | --- |
| Display | 34–40px / 600, −0.02em | Screen titles, report header |
| Title | 24px / 600 | Section headings |
| Body-lg | 18px / 400 | Primary reading, question labels |
| Body | 16px / 400 | Default |
| Label | 14px / 500, +0.01em | Field labels |
| Caption | 13px / 400 | Metadata |
| Overline | 12px / 600, +0.10em, uppercase | Section eyebrows — sparingly |

**Minimum 16px for anything an associate reads while standing.** 14px on a tablet
held at arm's length under store lighting is a usability failure, not a density win.

## 4. Space, shape, depth

- **4pt grid.** Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64.
- **Radius:** 10px cards and sheets · 8px inputs, buttons and chips · 999px only
  for status pills. Restrained, as specified — no soft-toy rounding.
- **Depth:** borders do the work. One shadow level for raised sheets
  (`0 4px 16px rgba(20,24,27,.08)`). No glassmorphism, no gradients beyond a
  barely-there surface wash, no glow.
- **Density:** generous. A screen with eight fields and real whitespace beats a
  screen with sixteen fields and none — the associate is standing up.

## 5. Components

| Component | Spec |
| --- | --- |
| **Chip (primary input)** | 56px tall, 8px radius, `--surface-raised` on `--line-strong`; selected → `--accent-wash` fill, `--accent` border, `--accent` text **plus a check glyph** so selection never depends on color. |
| **Segmented control** | Full-width, max 5 segments, 56px tall. More than 5 becomes chips. |
| **Stepper (sizes)** | Large −/+ targets (56×56) flanking a tabular numeral. Never a dropdown; never a keyboard. |
| **Primary button** | `--accent` fill, white text, 56px tall, bottom-right. One per screen. |
| **Level indicator** | Four dots, filled to level. Same visual in UI and report — one idea, rendered once. |
| **Evidence badge** | Text + dot, three states (Strong / Moderate / Limited). Never a percentage, never a gauge — both imply calibration the system does not have. |
| **Foot diagram** | Simple line outline with tappable zones (heel / arch / forefoot / toes). Anatomically plausible, never anatomically detailed — detail pushes it toward medical. |
| **Card** | White, 1px `--line`, 10px radius, 16–24px padding. |
| **Bottom sheet** | Used instead of modals throughout the fitting flow. |

## 6. Tablet ergonomics

1. **56px minimum touch targets** in the fitting flow (44px is the accessibility
   floor; 56px is the standing-up-while-talking floor).
2. **Thumb arc:** primary actions bottom-right; destructive actions nowhere near it.
3. **No hover-dependent information** — hover does not exist on the device that
   matters.
4. **Glare tolerance:** high-contrast text, no light-grey-on-white hierarchy.
   Store lighting is bright, uneven, and often directly overhead.
5. **One-handed operation:** the other hand is holding a shoe. Nothing requires
   two-finger gestures, drag, or precise targeting.
6. **Landscape 1024×768 is the design canvas.** Portrait is supported, not
   optimized.
7. **No text input in the flow** beyond name and phone (see [02 §1](02-ux-spec.md#1-interaction-laws)).

## 7. Motion

- 150ms for state changes, 200ms for sheets and transitions, `ease-out`.
- No bounce, no spring, no attention-seeking animation. Motion confirms; it never
  performs.
- The one expressive moment in the whole product: the **pressure map render** on
  the scan screen once hardware ships. Everything else stays quiet so that lands.
- Full `prefers-reduced-motion` support.

## 8. Voice

| Do | Don't |
| --- | --- |
| "Your foot rolls inward slightly." | "Subject exhibits pronation." |
| "Most people find this more comfortable on long shifts." | "This will fix your pain." |
| "We fitted the larger foot." | "Bilateral asymmetry accommodated." |
| Plain, second person, calm, specific | Clinical, salesy, or exclamatory |

No exclamation marks in the product. No emoji in customer-facing output. Numbers
are stated with the precision actually available and no more.

## 9. Brand assets

| Asset | Direction |
| --- | --- |
| Wordmark | Keep "STRIDE GUIDE," reset in Inter with tighter tracking than the current lockup. Retire the lime chevron mark. |
| Symbol | An abstract footprint or stride arc in a single teal weight — legible at 20px on a report footer, which is its most common size. |
| Co-branding | Store logo dominant on customer artifacts; Stride Guide discreet. |
| Imagery | Real feet, real shoes, real stores, natural light. No stock photography, no 3D renders, no floating product shots. If there is no real photography yet, use none — the interface is the imagery. |
| Existing landing page | The current dark/lime site stays live for now. Reskinning it to this system is a post-pilot task, and it should happen before any investor conversation so the story is coherent. |

## 10. Accessibility floor

- 4.5:1 for all text; 3:1 for UI boundaries and graphical objects.
- Never color alone — every selected, flagged or level state carries a glyph,
  label or shape.
- Full keyboard path for the laptop/owner case; visible focus rings everywhere.
- Labels on every input; no placeholder-as-label anywhere.
- Report meets the same bar in print: the disclaimer is never grey-on-grey.

---

**Next:** [09 · Build Plan](09-build-plan.md)
