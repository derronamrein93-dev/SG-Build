# 02 · UX Specification

Tablet-first, landscape, one-handed, on a sales floor, with a customer watching.
Every decision below follows from those five words.

---

## 1. Interaction laws

These are non-negotiable and apply to every screen.

1. **Tap, don't type.** The keyboard appears exactly twice in the whole flow:
   customer name and phone. Everything else is chips, segmented controls,
   steppers, or toggles. Free-text notes accept voice dictation.
2. **One question per row, one decision per glance.** No multi-column forms. A
   standing associate scans vertically.
3. **Nothing is mandatory except identity and consent.** Any field can be
   skipped; the recommendation degrades gracefully and says so via evidence
   strength.
4. **Autosave always, submit never.** There is no Save button in the fitting
   flow and the word "Save" appears nowhere — but "every tap writes to the
   database" is the wrong implementation. The chain is
   `local optimistic state → debounced write (500–1500ms by field type) → server
   ack → local draft backup`. The UI updates instantly; the network does not
   thrash. A session is `draft` until intake is meaningfully complete, and an
   accidentally opened screen never becomes a historical fitting.
5. **Forward motion is bottom-right.** The primary action sits in the thumb arc
   of a right-handed person holding a tablet at chest height. Back is top-left.
6. **No modal dialogs in the fitting path.** Modals steal focus while a human is
   talking to another human. Use inline expansion and bottom sheets.
7. **The customer may be looking.** No screen shows anything you would not want
   the customer to read. Internal-only content (margin, upsell framing) is
   labeled *For you* and visually recessive.
8. **Never block on the network.** Recommendation, report rendering, and history
   read from local state. Sending is the only online action, and it queues.

## 2. Core user flow

```
                    ┌──────────────────────────────────────────┐
                    │  A. Associate sign-in (once per shift)   │
                    └────────────────────┬─────────────────────┘
                                         ▼
                    ┌──────────────────────────────────────────┐
                    │  1. STORE DASHBOARD                      │
                    │     ▸ New Fitting  ▸ Search  ▸ Follow-ups│
                    └────────────────────┬─────────────────────┘
                                         ▼
              ┌──────────────────────────────────────────────────┐
              │  2. CUSTOMER  — search by phone                  │
              │     found ──────────────► profile + fit history  │
              │     not found ──────────► create (name/phone/consent)
              └────────────────────┬─────────────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │  3. INTAKE  — why are they here                  │
              │     returning customer → prefilled, "still true?"│
              └────────────────────┬─────────────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │  4. FIT ASSESSMENT  — what the associate observes │
              │     (later: the platform fills this in)          │
              └────────────────────┬─────────────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │  5. RECOMMENDATION  — profile, levels, products, │
              │     talking points, evidence strength, why      │
              │     ▸ override any attribute                     │
              └────────────────────┬─────────────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │  6. FIT REPORT  — review → print / email         │
              └────────────────────┬─────────────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │  7. CLOSE  — outcome + schedule follow-up        │
              └────────────────────┬─────────────────────────────┘
                                   ▼
                            back to DASHBOARD
```

**Screens 5–7 are the payoff. Screens 2–4 are cost.** Design pressure goes on
shortening 2–4, never on shortening 5–7.

### The 3-minute budget

A budget only works if it is allocated. This is the allocation, and it is a
testable spec — instrument it and watch the real numbers per screen.

| Step | Budget | Taps | Notes |
| --- | --- | --- | --- |
| 2. Customer | 0:25 | 6–8 | Returning customer: 0:08 (phone → tap the match) |
| 3. Intake | 0:45 | 8–10 | Returning: 0:20 (confirm prefill) |
| 4. Assessment | 1:00 | 10–14 | The longest step; happens while the associate is handling the foot |
| 5. Recommendation | 0:30 | 1–3 | Mostly reading and talking, not tapping |
| 6. Report | 0:15 | 2 | Review, send |
| 7. Close | 0:10 | 2 | Outcome + follow-up |
| **Total** | **2:45** | **~30** | Leaves 15s of slack against the 3:00 target |

Fittings run alongside conversation, not instead of it. If testing shows step 4
exceeding 1:15 in real use, cut fields from step 4 — do not cut step 5 or 6.

---

## 3. Screen A — Associate sign-in *(added; not in the brief)*

**Why it exists:** the tablet is shared. Without knowing who is fitting, you
cannot measure per-associate adoption, attribute overrides, or put a name on the
report — and "Store associate name" as a typed field on every fitting is a
guaranteed source of garbage data.

**Design:** a store-level device login (once, at setup) plus a "who's fitting?"
avatar row shown when the tablet has been idle >30 minutes or at shift change.
Tap your face, optional 4-digit PIN, done. Never a password on the floor.

| Field | Type | Control | Required | Notes |
| --- | --- | --- | --- | --- |
| associate | reference | Avatar tile row | Yes | Sourced from store's associate list |
| pin | string(4) | Numeric pad | Optional per store | Store setting; off by default |

---

## 4. Screen 1 — Store Dashboard

**Purpose:** get an associate into a fitting in one tap, and give the owner a
reason to glance at it. Deliberately **not** an analytics product.

### Layout (landscape, 3 zones)

```
┌───────────────────────────────────────────────────────────────────────┐
│  Northside Running Co.            Thu 14 Aug        [ Denise ▾ ]      │
├──────────────────────────────┬────────────────────────────────────────┤
│                              │  TODAY                                 │
│   ┌───────────────────────┐  │  ┌──────────┬──────────┬────────────┐  │
│   │                       │  │  │ Fittings │ Reports  │ Follow-ups │  │
│   │    + NEW FITTING      │  │  │    14    │    9     │  3 due     │  │
│   │                       │  │  └──────────┴──────────┴────────────┘  │
│   └───────────────────────┘  │                                        │
│                              │  FOLLOW-UPS DUE                        │
│   🔍 Search customer         │  ▸ J. Okafor · 7-day check · [Done]    │
│      name or phone           │  ▸ R. Lindqvist · 90-day rescan        │
│                              │  ▸ T. Alvarez · comfort check          │
│   RECENT FITTINGS            │                                        │
│   ▸ M. Alvarez    2:14 pm    │  ─────────────────────────────────     │
│   ▸ D. Cho        1:52 pm    │  💬 Note something for Stride Guide    │
│   ▸ P. Weber     12:30 pm    │     [ Add pilot feedback ]             │
└──────────────────────────────┴────────────────────────────────────────┘
```

### Elements

| Element | Behavior |
| --- | --- |
| **New Fitting** | Largest target on screen (min 240×120px). One tap → Screen 2 with the phone field focused. |
| **Search customer** | Type-ahead on **name** after 2 characters. **Phone requires the complete number** — lookup runs against a keyed hash, so partial matching is impossible by design ([05 §6](05-data-model.md#6-phone-identity--why-hashed-and-what-it-costs)). Tapping a result opens the customer profile, not a new fitting. |
| **Recent fittings** | Last 8 today. Tap = open that fitting (resume if incomplete, view if complete). An incomplete fitting shows a subtle "in progress" marker — this is how a dropped fitting gets recovered. |
| **Today stats** | Exactly three: fittings, reports sent, follow-ups due. No charts, no trends, no comparisons in v1. |
| **Follow-ups due** | Max 5 shown, each with a one-tap Done and a swipe to snooze. Overdue items sort first. |
| **Pilot feedback** | Persistent, low-emphasis. Opens a bottom sheet (§10). |
| **Store performance snapshot** | One line, owner-role only: *"This week: 68 fittings · 41 reports sent · 12 insole attachments."* Hidden from associate role to keep the floor screen calm. |

**Empty states matter here.** A new store's dashboard shows a 3-step setup card
(add associates → import shoe list → run a practice fitting) instead of zeros.

---

## 5. Screen 2 — Customer (find or create)

**Purpose:** identify the human in under 25 seconds without creating duplicates.

**Design:** search-first, not create-first. The screen opens as a single large
phone/name field. Creation is what happens when search fails, which is the
opposite of most CRM UIs and the reason duplicates get avoided.

### Flow

1. Associate types phone (or name).
2. Matches appear as cards below the field, live.
3. **Match found** → tap → returning-customer confirmation, showing last visit
   date, last recommendation, and *"Continue as returning customer."*
4. **No match** → the field expands into the short create form.

### Fields

| Field | Type | Control | Required | Validation / notes |
| --- | --- | --- | --- | --- |
| phone | string | Numeric keypad, auto-format | Yes* | **Dedupe key, stored as a keyed hash** (HMAC over the E.164 form) plus last-4 for display. Exact full-number match blocks creation and offers the existing record. **No partial search** — the associate types the whole number or searches by name. The plaintext number is retained, encrypted, only where consent to contact exists. |
| first_name | string | Text | Yes | |
| last_name | string | Text | Yes | |
| email | string | Text, `type=email` | No | Skip button adjacent. Required only if sending the report by email — prompted at that moment instead, which is where the customer sees the value. |
| age_range | enum | Chips: Under 18 · 18–29 · 30–44 · 45–59 · 60–74 · 75+ · Prefer not to say | No | Drives no rules in v1; collected for cohort learning. Under 18 triggers guardian-consent copy. |
| shopping_purpose | enum | Chips (see Intake) | No | Captured here if obvious, else on Intake. |
| returning_customer | bool | Auto-derived | — | Derived from record match; never asked. Manual override for "this is a new person with a shared phone." |
| consent_fit_data | bool | Checkbox + inline text | **Yes** | Blocks progress. Stores text version + timestamp + associate. |
| consent_marketing | bool | Checkbox | No | Separate and off by default. Never bundled with the above. |
| user_id | reference | Auto from sign-in | Yes | Not a typed field. Attribution, not a security boundary. |

\* Phone is required to create a *saved* record. Offer **"Fitting without saving
contact"** — an anonymous fitting that produces a printed report and no stored
identity. Some customers will refuse contact details, and the associate must not
be stuck; this converts a dead end into a printed report and a data point.

### Consent — five distinct records, never one checkbox

A single `consent = true` flag cannot answer "what did they agree to, when,
where, under which policy version, and who took it." Each type is captured and
stored separately ([05 §7](05-data-model.md#7-consent_record)), with policy
version, capture method, location, timestamp and capturing user.

| Type | Asked | Required to proceed |
| --- | --- | --- |
| `fit_history_storage` | On the customer screen | **Yes** (or take an anonymous fitting) |
| `receive_report` | At the moment the report is sent | Only to send it |
| `privacy_ack` | Bundled with the first, recorded separately | Yes |
| `marketing_email` | Separate checkbox, default off | No |
| `marketing_sms` | Never bundled; own opt-in, own wording, reserved | No |

**Storage consent, verbatim:**

> I agree that **[Store Name]** may store my fitting information to help with
> future fittings. My information is not sold. I can ask for it to be deleted at
> any time.

**Marketing checkbox, separate and off by default:**

> Send me a copy of my fit report and occasional fitting reminders.

---

## 6. Screen 3 — Intake

**Purpose:** capture *why they are here* in 45 seconds, in the associate's own
natural opening conversation.

**Design principle:** this screen mirrors the questions a good associate already
asks. It should feel like a checklist of their own instincts, not an
interrogation. Order follows the natural conversation: what for → what's wrong →
how much → what you're wearing → what matters most.

### Fields

| # | Field | Type | Control | Required | Options / notes |
| --- | --- | --- | --- | --- | --- |
| 1 | shopping_purpose | enum | Large chips, single select | Yes | Running · Walking · Work · Casual · Orthopedic/comfort · Kids · Sports · Hiking · Standing all day · Other |
| 2 | current_shoe_problem | enum multi | Chips, multi-select | No | Hurts after a while · Never fit right · Worn out · Too tight · Too loose · Heel slips · Rubs/blisters · Not enough support · Not enough cushion · No problem, replacing |
| 3 | discomfort_area | enum multi | **Foot diagram + chips** | No | Heel · Arch · Ball of foot (forefoot) · Toes · Ankle · Knee · Hip/back · No pain. Tapping a zone on a simple foot outline is faster than reading a list and reads as expert to the customer. |
| 4 | discomfort_timing | enum | Chips | No | During activity · After activity · All day · First steps in the morning · Only in certain shoes. *Added:* timing separates fit problems from load problems better than location alone. |
| 5 | activity_level | enum | Segmented | No | Light · Moderate · Active · Very active (with plain-language subcaption, e.g. "Very active — daily training or 10k+ steps") |
| 6 | standing_hours_per_day | enum | Segmented | No | Under 2 · 2–4 · 4–8 · 8+ |
| 7 | current_shoe_brand | string | Type-ahead from shoe DB | No | Free text fallback. Feeds the shoe knowledge base. |
| 8 | current_shoe_model | string | Type-ahead, scoped by brand | No | |
| 9 | current_shoe_age | enum | Chips | No | Under 6 months · 6–12 months · 1–2 years · 2+ years · Unknown |
| 10 | fit_priority | enum ranked | Chips, **pick up to 2** | No | Comfort · Support · Performance · Durability · Style · Price. Capping at 2 forces a real answer and drives the talking points. |
| 11 | previous_return_reason | enum | Chips | No | Never returned · Too small · Too big · Too narrow · Too wide · Uncomfortable · Wrong style · Wore out fast |
| 12 | uses_orthotics | enum | Chips | No | No · Yes, custom · Yes, over-the-counter · Sometimes → if yes, volume/removable-insole logic activates |
| 13 | shoe_wear_concern | enum | Chips | No | Even wear · Outer edge · Inner edge · Heel · Ball of foot · Uneven left vs right · Not sure |
| 14 | notes | text | Textarea + dictation | No | |

### Screen output (right rail, live)

The rail updates as fields are entered — this is what makes it feel intelligent
rather than administrative.

- **Need summary** — one sentence, generated from the inputs.
  *"Work boots for 8+ hour shifts, heel pain by end of day, wants comfort and durability."*
- **Fit risk indicators** — chips, only when triggered: `Previous return`,
  `Orthotic user`, `Pain in 2+ areas`, `8+ hrs standing`, `Shoe over 2 years old`,
  `Left/right size difference`.
- **Suggested associate focus** — up to 3 bullets.
  *"Check heel counter stiffness · Measure both feet seated and standing · Ask about the current boot's break-in."*

### Returning customer variant

Every field prefills from the last fitting, shown greyed with a single control at
the top: **"Anything changed since March?"** → *Nothing's changed* (one tap,
advances) or *Update* (fields become editable). This is the moment P2 the veteran
associate decides the product is worth using.

---

## 7. Screen 4 — Manual Fit Assessment

**Purpose:** record what the associate observes. **This schema is the future
sensor schema** — see [09](09-build-plan.md#6-hardware-integration). Every
field carries a hidden `source` of `manual` today and `sensor` later.

**Design:** two columns — left foot / right foot for the dimensional fields, one
column for the judgment fields. Big steppers for size. Default everything to the
most common value so a fast associate confirms rather than enters.

### Fields

| # | Field | Type | Control | Required | Options / notes |
| --- | --- | --- | --- | --- | --- |
| 1 | size_left | decimal | Stepper, 0.5 increments | Yes | Unit follows store setting (US/UK/EU). |
| 2 | size_right | decimal | Stepper | Yes | **Defaults to size_left.** Differing values auto-raise the `size asymmetry` flag and a talking point. |
| 3 | width | enum | Segmented | No | Narrow · Standard · Wide · Extra wide · Unsure |
| 4 | width_asymmetry | bool | Toggle | No | Appears only if width is set. |
| 5 | arch_type | enum | **Illustrated 3-option picker** | No | Low / flat · Medium · High · Unknown. Pictures, not words — this is the field P3 gets wrong most often. |
| 6 | foot_shape | enum multi | Chips | No | Narrow · Average · Wide · High volume · Low volume |
| 7 | pronation_tendency | enum | Segmented, 5 stops | No | Outward roll · Neutral · Mild inward roll · Strong inward roll · Unknown. **Labeled in plain words, with the clinical term as a subcaption** (supination / neutral / mild pronation / overpronation). |
| 8 | heel_slip_risk | enum | Chips | No | None · Slight · Noticeable |
| 9 | toe_box_issue | enum multi | Chips | No | None · Length tight · Width tight · Depth/volume tight · Toe overlap · Bunion accommodation · Hammer toe accommodation |
| 10 | wear_pattern | enum | Chips (mirrors intake Q13) | No | Prefilled from intake if the associate inspected the old shoe; the associate confirms. |
| 11 | balance_concern | enum | Chips | No | None · Leans inward · Leans outward · Uneven weight L/R · Unsteady |
| 12 | pressure_concern | enum multi | Chips | No | None · Heel · Forefoot · Arch · Outer edge · Big toe joint |
| 13 | recommended_support_level | enum | Segmented | No | **Pre-filled by the engine, editable.** Neutral · Light stability · Stability · Maximum support |
| 14 | recommended_cushioning_level | enum | Segmented | No | Pre-filled. Firm · Moderate · Plush · Max |
| 15 | recommended_category | enum | Chips | No | Pre-filled. |
| 16 | recommended_insole | enum | Chips | No | None · Cushioning · Arch support · Heel cup · Metatarsal · Anti-fatigue |
| 17 | assessment_notes | text | Textarea + dictation | No | |

**Fields 13–17 are the associate's judgment, pre-seeded by the engine as soon as
intake is complete.** Agreement is one tap. Disagreement is one tap plus a
choice, and it is recorded as an override — the single most valuable training
signal the product collects.

### Speed features

- **"Standard fit" button** at the top sets width=Standard, arch=Medium,
  pronation=Neutral, no issues — covering roughly 40% of customers in one tap.
- Fields collapse once answered, showing a compact summary row.
- The whole screen fits without scrolling on a 1024×768 tablet in landscape.

---

## 8. Screen 5 — Recommendation

**Purpose:** convert data into something the associate can *say out loud*.

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  M. Alvarez · Work boots · 8+ hrs standing     Evidence: Strong ●●● │
├───────────────────────────────┬────────────────────────────────────────┤
│  FIT PROFILE                  │  WHAT TO SAY                           │
│  Size    10.5 L / 11 R        │  "Your right foot measures a half size │
│  Width   Wide                 │   larger, so we'll fit the bigger foot  │
│  Arch    Low                  │   and take up space on the left."      │
│  Roll    Mild inward          │                                        │
│  Volume  Standard             │  "On your feet 8+ hours — the outsole  │
│                               │   matters as much as the insole."      │
│  RECOMMENDED                  │                                        │
│  Category    Work / support   │  "That inner-edge wear tells us your   │
│  Support     Stability ●●●○   │   foot rolls in a bit. A supportive    │
│  Cushioning  Plush     ●●●○   │   midsole keeps that from tiring you   │
│  Width       Wide, roomy toe  │   out by hour six."                    │
│  Insole      Anti-fatigue     │                                        │
│                               │  WHY  (tap to expand)                  │
│  [ Adjust ]                   │  ▸ 8+ hrs standing + heel discomfort   │
│                               │  ▸ Low arch + inner-edge wear          │
│                               │  ▸ Wide foot + toe box tightness       │
├───────────────────────────────┴────────────────────────────────────────┤
│  CONSIDER                            AVOID                             │
│  ▸ Brand A Model 4E — wide, PU  │  ▸ Minimalist / low-drop styles      │
│  ▸ Brand B Model W  — stability │  ▸ Narrow-last runners               │
│  ▸ Brand C Model X  — anti-fat. │  ▸ Soft foam without a stable base   │
├────────────────────────────────────────────────────────────────────────┤
│  [ ← Back ]                                    [ Create Fit Report → ] │
└────────────────────────────────────────────────────────────────────────┘
```

### Content rules

| Block | Rule |
| --- | --- |
| **Evidence strength** | Three states only — Strong / Moderate / Limited — each with a one-line reason (*"Limited — arch type and wear pattern unknown"*). Never a percentage: the system is not calibrated against outcomes, and implying statistical certainty about someone's body is both untrue and unwise. Definition in [03 §3](03-recommendation-engine.md#3-evidence-strength-not-confidence). |
| **What to say** | 2–4 talking points, plain spoken English, second person, no jargon. These are quotes an associate can read aloud verbatim without sounding like a robot. |
| **Why** | Collapsed by default, expands to the specific inputs that fired. Must name the input, not the rule ID. |
| **Consider** | Max 3 products, filtered by store inventory when available. Each shows one reason phrase, not a spec dump. |
| **Avoid** | Max 3 characteristics — **shoe types, not brands.** Naming a competitor's product as "avoid" is a liability and an argument with a customer who already owns it. |
| **Adjust** | Opens inline controls for support / cushioning / width / insole. Changing any value re-renders talking points instantly and logs an override with an optional one-tap reason (*Customer preference · My judgment · Not in stock · Budget*). |
| **For you** | Recessive strip: insole attach opportunity, and — if flagged — a referral note (*"Ongoing pain: suggest they check with a healthcare professional."*). Never in the customer report as a recommendation. |

---

## 9. Screen 6 — Customer Fit Report

Full structure and sample: [04 · Customer Fit Report](04-fit-report.md).

**Screen behavior:** a live preview of the actual report, with three actions —
**Print**, **Email**, **Done**. Email is a two-tap path: if no email is on file
the field appears here, which is the right moment because the customer is looking
at their own report and wants a copy.

Two toggles for the associate before sending: *Include associate notes* (on) and
*Include products to consider* (on, and off automatically if nothing was in
stock).

---

## 10. Screen 7 — Close *(bottom sheet, not a screen)*

Ten seconds, two taps, dismissible.

| Field | Control | Notes |
| --- | --- | --- |
| outcome | Chips: Purchased · Purchased something else · Thinking about it · No purchase · Ordered | Feeds the outcome dataset that eventually trains everything. |
| purchased_item | Type-ahead | Only if outcome = purchased. |
| insole_attached | Toggle | The revenue metric. |
| follow_up | Chips: 7 days · 30 days · 90 days · None | Default suggested by purpose (running → 30, work → 90). Writes `follow_up_reason`, `follow_up_due_at`, `follow_up_status` — the full data model, deliberately paired with a **minimal UI**: a due list and a Done button. There are already 10,000 CRMs; the differentiator is fitting intelligence and longitudinal data, so week-one hours do not go here. |

## 11. Global — Pilot feedback sheet

Reachable from every screen via a persistent low-emphasis control.

| Field | Control |
| --- | --- |
| type | Chips: Bug · Confusing · Too slow · Wrong recommendation · Idea · Praise |
| screen | Auto-captured |
| fitting_id | Auto-captured if inside a fitting |
| note | Text + dictation |

Two taps to submit. **"Wrong recommendation" is the highest-value signal in the
pilot** — it should be one tap from the recommendation screen itself, and it must
capture the full input state so the rule can be reproduced.

## 12. Customer profile / fit history *(added; not in the brief)*

Reached from search or from a returning-customer match. This is the screen that
answers *"What do we know about this customer?"* and the one that converts P2.

- Header: name, visits, last visit, current fit profile at a glance.
- **Timeline** of fittings: date, purpose, recommendation, what they bought,
  outcome, follow-up status.
- **What changed** between the two most recent fittings, read from the stored
  `assessment_delta` record ([05 §14](05-data-model.md#14-assessment_delta--what-changed-since-last-visit))
  — structured data computed once at completion, not a visual diff recalculated
  at render time. Shown in plain language (*"Right foot now measured a half size
  larger · Now reports heel discomfort"*), and queryable later for cohort
  analysis. This is the screen longitudinal data exists to produce, and it gets
  materially stronger once scans feed it.
- Actions: Start new fitting (prefilled) · Resend last report · Add note.

## 13. States, errors and edge cases

| Situation | Behavior |
| --- | --- |
| Network drops mid-fitting | Nothing visible changes. A small "saved on this device" indicator appears. Sync resumes silently. |
| Tablet sleeps / app closed | Fitting resumes exactly where it was, from the dashboard's "in progress" marker. |
| Customer declines consent | "Fitting without saving contact" — full workflow, printed report, no stored identity. |
| Under-18 customer | Guardian consent copy replaces the standard text; report addresses the guardian. |
| Two customers share a phone | Match card offers "This is someone else" → creates a linked record. |
| No shoe inventory loaded | "Consider" block hides; recommendation shows characteristics only. The system must be useful with an empty catalog. |
| Conflicting rules fire | Both surfaced, evidence strength drops to Moderate, associate picks. Never silently averaged. |
| Red-flag inputs (severe/persistent pain, numbness, diabetes-related concern) | Recommendation still generates; a referral note appears for the associate; the report shows the standard disclaimer with a "worth discussing with a healthcare professional" line. No diagnosis, no alarm language. |

---

**Next:** [03 · Recommendation Engine](03-recommendation-engine.md)
