# 03 · Recommendation Engine

The engine is the proprietary core. Everything else in FitOS is a well-made
interface around this file.

---

## 1. Architecture

### Two stages, deliberately separated

```
  intake + assessment inputs
            │
            ▼
   ┌────────────────────┐   Stage 1: RULES → FIT PROFILE
   │  Rule evaluation   │   Rules never name a product. They vote, with
   │  (all rules, all   │   weights, on abstract fit attributes.
   │   at once)         │
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐   The fit profile is the durable asset. It is
   │    FIT PROFILE     │   what goes in the report, the history, and the
   │  support: stability│   customer record. It outlives any catalog.
   │  cushion:  plush   │
   │  width:    wide    │
   │  insole:   anti-fat│
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐   Stage 2: PROFILE → PRODUCTS
   │  Catalog matching  │   A filter/rank over the store's shoe data.
   │  (store inventory) │   Swappable, per-store, and allowed to be empty.
   └────────────────────┘
```

**Why this split matters:** inventory changes weekly and varies per store; fit
logic does not. If rules pointed directly at products, every rule would rot every
season and no rule could be shared across stores. Splitting them means the fit
knowledge compounds while the catalog churns — and it means FitOS is useful on
day one in a store that has not imported a single SKU.

### Why rules, not a model

| | Rules | ML model |
| --- | --- | --- |
| Explainable to a skeptical associate | Yes, by construction | No |
| Works with zero training data | Yes | No — and you have zero |
| Deterministic and testable | Yes | No |
| Runs offline in <5ms | Yes | Depends |
| Legally defensible | Yes — you can point at the logic | Hard |
| Tunable by the founder in an afternoon | Yes | No |

A model becomes interesting at ~2,000 recorded outcomes. Until then, 30 good
rules beat a bad model, and the rules generate exactly the labeled data a model
would later need.

---

## 2. Output vocabulary

Every rule votes only on these attributes. This closed vocabulary is what makes
the profile portable to the hardware, the report, and the catalog.

| Attribute | Values |
| --- | --- |
| `support_level` | `neutral` · `light_stability` · `stability` · `max_support` |
| `cushioning_level` | `firm` · `moderate` · `plush` · `max` |
| `width` | `standard` · `wide` · `extra_wide` |
| `volume` | `low` · `standard` · `high` |
| `toe_box` | `standard` · `roomy` · `wide_round` |
| `heel_fit` | `standard` · `secure_narrow` · `structured` |
| `category` | `running_neutral` · `running_stability` · `walking_comfort` · `work_support` · `work_safety` · `hiking` · `casual_comfort` · `orthopedic_friendly` · `court_sport` · `kids` |
| `insole` | `none` · `cushion` · `arch_support` · `heel_cup` · `metatarsal` · `anti_fatigue` |
| `flags` | `size_up_check` · `size_asymmetry` · `removable_insole_required` · `break_in_guidance` · `lacing_guidance` · `rotation_guidance` · `walk_test_required` · `referral_suggested` · `gait_review` *(hardware)* |

Weights: **+3** strong, **+2** moderate, **+1** weak, **−2** contraindicated.

---

## 3. Scoring, confidence, and conflicts

### Scoring

All rules evaluate; matched rules add weights to attribute values; the highest
total per attribute wins. No rule ordering, no early exit — order-independence is
what keeps the engine testable.

### Confidence (0–100)

| Component | Max | Definition |
| --- | --- | --- |
| Input completeness | 40 | 5 points each for: purpose, discomfort area, arch type, width, pronation, wear pattern, standing hours, sizes. |
| Rule agreement | 40 | Margin between the winning value and the runner-up on `support_level` and `cushioning_level`, normalized. Unanimity scores full. |
| Conflict penalty | −20 | −10 per hard conflict (defined below), floored at −20. |

| Band | Score | UI treatment |
| --- | --- | --- |
| High | ≥ 75 | "Confidence: High" — proceed normally |
| Moderate | 50–74 | Shows the single input that would most improve it |
| Low | < 50 | "Rely on the try-on" + prompt for the two missing inputs. Report still generates; it simply leans on associate notes. |

Never display a percentage. "82% confident" starts an argument no one can win.

### Hard conflicts

Surfaced side by side for the associate to resolve — never silently averaged.

| Conflict | Resolution shown |
| --- | --- |
| `max` cushioning vs `max_support` | "Cushioned stability" — both, and flag the try-on as decisive. |
| `wide` width vs `secure_narrow` heel | Flag as a **heel-to-forefoot mismatch**: fit forefoot, secure heel with lacing; may need a brand known for that last shape. |
| `neutral` vs `stability` support (outward roll + inner wear) | Data disagreement — prompt to re-check the wear pattern. |
| Customer priority `price` vs `max_support` need | Present the insole path as the lower-cost route to support. |

---

## 4. Language guardrails

Enforced in the rule data itself, not left to the associate.

**Banned everywhere** (UI, report, generated text): diagnose, treat, cure,
correct, prevent injury, plantar fasciitis, tendonitis, neuroma, arthritis,
"medically recommended", "orthopedically necessary", "will fix".

**Required substitutions**

| Instead of | Say |
| --- | --- |
| "You have overpronation" | "Your foot tends to roll inward a bit" |
| "This will fix your heel pain" | "Customers with similar patterns often find this more comfortable" |
| "Corrects your arch" | "Supports your arch" |
| "Prevents injury" | "Helps with comfort over long days" |

**Referral routing.** When `referral_suggested` is set, the associate sees:
*"Worth suggesting they check in with a healthcare professional — keep the
conversation on comfort and fit."* The customer report shows only the standard
disclaimer plus one neutral line. FitOS never tells a customer to see a doctor
about a specific condition, and never names one.

**Upsell ethics.** Upsell fields are suppressed entirely when `category = kids`
or when `referral_suggested` is set. Recommending an insole to someone reporting
persistent pain is both bad ethics and bad legal posture.

---

## 5. Rule schema

Rules are **data, not code** — a versioned JSON file, editable without a
deployment pipeline change, diffable in review.

```jsonc
{
  "id": "R-01",
  "name": "Low arch + arch discomfort + inner-edge wear",
  "version": "1.0",
  "when": {
    "all": [
      { "field": "arch_type", "in": ["low"] },
      { "field": "discomfort_area", "includes": "arch" }
    ],
    "any": [
      { "field": "wear_pattern", "in": ["inner_edge"] },
      { "field": "pronation_tendency", "in": ["mild_inward", "strong_inward"] }
    ]
  },
  "then": {
    "support_level":    { "stability": 3 },
    "cushioning_level": { "moderate": 1 },
    "insole":           { "arch_support": 3 }
  },
  "say": "Your arch is on the lower side and the wear on your old shoe backs that up — a shoe with a firmer platform under the arch usually feels steadier by the end of the day.",
  "report": "Your fitting showed a lower arch profile with some inward wear. We recommended a supportive shoe and an arch-support insole for added comfort.",
  "upsell": "arch_support_insole",
  "guard": null
}
```

---

## 6. The rule set (v1 — 30 rules)

Format for each: **Inputs** → **Profile output** · **Say** (associate, spoken) ·
**Report** (customer-facing) · **Upsell** · **Guard**.

### Family A — Arch & alignment

**R-01 · Low arch + arch discomfort + inner wear**
- **Inputs:** `arch_type=low` AND `discomfort_area∋arch` AND (`wear_pattern=inner_edge` OR `pronation∈{mild_inward,strong_inward}`)
- **Output:** support `stability +3` · cushioning `moderate +1` · insole `arch_support +3`
- **Say:** "Your arch sits lower, and the wear on your current shoe backs that up. A shoe with a firmer platform under the arch usually feels steadier late in the day."
- **Report:** "Your fitting showed a lower arch with some inward wear. We recommended a supportive shoe and an arch-support insole for added comfort."
- **Upsell:** Arch-support insole · **Guard:** none

**R-02 · Low arch, no discomfort**
- **Inputs:** `arch_type=low` AND `discomfort_area∋none`
- **Output:** support `light_stability +2` · cushioning `moderate +1`
- **Say:** "No complaints today — we'll keep a little structure under the arch so it stays that way, without over-correcting anything."
- **Report:** "A lower arch with no current discomfort. We suggested a shoe with light built-in support."
- **Upsell:** none · **Guard:** Do not manufacture a problem. Comfort framing only.

**R-03 · High arch + impact/shock discomfort**
- **Inputs:** `arch_type=high` AND (`discomfort_area∋{ball_of_foot,heel}` OR `current_shoe_problem∋not_enough_cushion`)
- **Output:** support `neutral +3` · cushioning `plush +3` · insole `cushion +2` · flags `walk_test_required`
- **Say:** "Higher arches tend to spread impact across less of the foot, so cushioning does more work for you than structure does."
- **Report:** "Your fitting showed a higher arch. We recommended a neutral, well-cushioned shoe with a flexible feel."
- **Upsell:** Cushioning insole · **Guard:** Avoid rigid stability shoes; note as `−2 max_support`.

**R-04 · High arch + outer-edge wear / outward roll**
- **Inputs:** `arch_type=high` AND (`wear_pattern=outer_edge` OR `pronation=outward`)
- **Output:** support `neutral +3`, `max_support −2` · cushioning `plush +2` · insole `heel_cup +2`
- **Say:** "Your weight is riding along the outside edge. Extra stability posts would push you further that way — cushioning and a well-shaped heel are the better answer."
- **Report:** "Your wear pattern showed more contact along the outer edge. We recommended a cushioned, neutral shoe."
- **Upsell:** Cushioned insole with a heel cup · **Guard:** none

**R-05 · Strong inward roll + knee or shin discomfort**
- **Inputs:** `pronation=strong_inward` AND `discomfort_area∋{knee,ankle}`
- **Output:** support `max_support +3` · category `running_stability +2` · insole `arch_support +2` · flags `gait_review`, `referral_suggested`
- **Say:** "There's a noticeable inward roll. A stability shoe gives that a firmer base — and if the knee keeps bothering you, that's worth a conversation with a professional."
- **Report:** "We fitted you in a shoe with added support based on how your foot loads. Comfort should be your guide as you break it in."
- **Upsell:** none while `referral_suggested` · **Guard:** No causal claim between shoe and knee. Never state the shoe treats the knee.

### Family B — Discomfort location

**R-06 · Heel discomfort + 8+ hours standing**
- **Inputs:** `discomfort_area∋heel` AND `standing_hours=8+`
- **Output:** support `stability +2` · cushioning `plush +3` · insole `heel_cup +3` / `anti_fatigue +2` · heel_fit `structured +2`
- **Say:** "Eight-plus hours is a lot of load on the heel. We want cushioning that lasts the shift and a heel that holds you steady, not just soft foam that bottoms out by two o'clock."
- **Report:** "Long hours on your feet with heel discomfort. We recommended a cushioned, supportive shoe and a heel-comfort insole."
- **Upsell:** Anti-fatigue or heel-cup insole · **Guard:** none

**R-07 · Heel discomfort worst on first steps in the morning**
- **Inputs:** `discomfort_area∋heel` AND `discomfort_timing=first_steps_morning`
- **Output:** support `stability +2` · cushioning `plush +2` · insole `arch_support +3`, `heel_cup +2` · heel_fit `structured +3` · flags `referral_suggested`
- **Say:** "That first-thing-in-the-morning pattern is common. Structured heel support and arch support tend to feel better through the day — and since it's been ongoing, it's worth mentioning to a healthcare professional."
- **Report:** "You mentioned heel discomfort in the morning. We recommended a supportive shoe with a structured heel and an arch-support insole for comfort."
- **Upsell:** Suppressed (referral active) · **Guard:** **Never name a condition.** No "plantar" vocabulary anywhere.

**R-08 · Forefoot / ball-of-foot discomfort + wide foot**
- **Inputs:** `discomfort_area∋ball_of_foot` AND (`width∈{wide,extra_wide}` OR `foot_shape∋wide`)
- **Output:** width `wide +3` · toe_box `wide_round +3` · cushioning `plush +2` · insole `metatarsal +3`
- **Say:** "The ball of your foot needs room to spread out — a wider toe box plus cushioning right under that area takes the pressure off."
- **Report:** "Your fitting showed a wider forefoot with discomfort at the ball of the foot. We recommended a wider toe box and forefoot cushioning."
- **Upsell:** Metatarsal-support insole · **Guard:** none

**R-09 · Toe discomfort + current shoe too tight**
- **Inputs:** `discomfort_area∋toes` AND (`current_shoe_problem∋too_tight` OR `toe_box_issue∋{length_tight,width_tight,depth_tight}`)
- **Output:** toe_box `roomy +3` · volume `high +2` · flags `size_up_check`, `walk_test_required`
- **Say:** "Let's check length and width before anything else — a lot of toe discomfort is simply half a size or one width away. You want about a thumb's width in front of the longest toe."
- **Report:** "Your current shoes were fitting tight through the toes. We checked sizing and recommended a roomier toe box."
- **Upsell:** none (fix the size first — credibility beats attach rate) · **Guard:** none

**R-10 · Ankle instability**
- **Inputs:** `balance_concern∈{leans_inward,leans_outward,unsteady}` OR `discomfort_area∋ankle`
- **Output:** heel_fit `structured +3` · support `stability +2` · category `hiking +1` (if purpose=hiking) · flags `walk_test_required`
- **Say:** "A firmer heel counter — this back part here — makes a real difference in how steady a shoe feels. Squeeze it and you'll feel the difference between these two."
- **Report:** "We recommended a shoe with a structured heel for a more secure, stable feel."
- **Upsell:** none · **Guard:** No balance/fall-risk claims.

**R-11 · Knee, hip or back discomfort + active**
- **Inputs:** `discomfort_area∋{knee,hip_back}` AND `activity_level∈{active,very_active}`
- **Output:** cushioning `plush +3` · support `stability +2` · flags `gait_review`, `referral_suggested`, `rotation_guidance`
- **Say:** "More shock absorption is a reasonable thing to try. I'd also rotate between two pairs if you're out most days. If it persists, it's worth having someone take a proper look."
- **Report:** "We focused on shock absorption and support for your activity level."
- **Upsell:** Second pair for rotation (comfort framing only) · **Guard:** **No claim** that footwear resolves knee, hip or back discomfort.

**R-12 · Blisters or rubbing**
- **Inputs:** `current_shoe_problem∋rubs_blisters`
- **Output:** heel_fit `secure_narrow +2` · flags `size_up_check`, `lacing_guidance`, `walk_test_required`
- **Say:** "Rubbing is almost always movement — either the shoe is a touch long, or the heel isn't locked in. Let me show you a heel-lock lacing that fixes most of it."
- **Report:** "We checked fit and lacing to reduce movement inside the shoe."
- **Upsell:** Technical socks (low-pressure) · **Guard:** No wound or skin-care advice.

### Family C — Dimensions & fit mechanics

**R-13 · Wide foot in a narrow current model**
- **Inputs:** `width∈{wide,extra_wide}` AND `current_shoe_problem∋too_tight`
- **Output:** width `wide +3` · toe_box `wide_round +2` · category `−2 court_sport`
- **Say:** "You've been in a narrow last. Same size, wider fit — you'll feel the difference immediately, and it isn't about going up a size."
- **Report:** "We recommended a wider fit rather than a longer shoe."
- **Upsell:** none · **Guard:** none

**R-14 · Orthotic user + volume**
- **Inputs:** `uses_orthotics∈{custom,otc}`
- **Output:** volume `high +3` · flags `removable_insole_required`, `size_up_check`, `walk_test_required` · insole `none +3` (they have one)
- **Say:** "Bring your orthotic — we fit the shoe to it. That means the factory insole has to come out, and sometimes a half size up to make room."
- **Report:** "We fitted your shoes to work with your existing orthotics, using a removable-insole design."
- **Upsell:** **Never** a competing insole · **Guard:** Never modify, trim or comment on a custom orthotic's design.

**R-15 · Low volume foot + heel slip**
- **Inputs:** `foot_shape∋low_volume` AND `heel_slip_risk∈{slight,noticeable}`
- **Output:** heel_fit `secure_narrow +3` · volume `low +3` · flags `lacing_guidance`
- **Say:** "Your foot doesn't fill the shoe vertically, which is why the heel lifts. A narrower heel or a lacing change usually solves it without going down a size."
- **Report:** "We chose a shoe with a more secure heel fit for your foot volume."
- **Upsell:** Volume-adjusting insole · **Guard:** none

**R-16 · Size asymmetry ≥ 0.5**
- **Inputs:** `abs(size_left − size_right) ≥ 0.5`
- **Output:** flags `size_asymmetry`, `walk_test_required` · volume `high +1`
- **Say:** "Your feet are slightly different sizes — that's completely normal. We fit the larger one and take up the extra space on the other side."
- **Report:** "Your feet measured slightly different sizes. We fitted the larger foot for comfort."
- **Upsell:** Volume insole for the smaller side · **Guard:** none

**R-17 · Bunion / toe overlap accommodation**
- **Inputs:** `toe_box_issue∋{bunion,toe_overlap,hammer_toe}`
- **Output:** toe_box `wide_round +3` · width `wide +2` · flags `walk_test_required`
- **Say:** "We want a rounder, softer toe box with no seam sitting right on that spot. Let me check where this shoe's stitching lands on your foot."
- **Report:** "We recommended a rounder, roomier toe box with a soft upper for comfort."
- **Upsell:** none · **Guard:** Accommodation language only. **Never** suggest a shoe corrects a toe position.

**R-18 · Heel slip + standard width**
- **Inputs:** `heel_slip_risk=noticeable` AND `width=standard`
- **Output:** heel_fit `structured +3` · flags `lacing_guidance` · category `−2 casual_comfort` (slip-ons)
- **Say:** "Before we change size, try this lacing — it locks the heel down. If it still lifts, we'll look at a shoe with a narrower heel."
- **Report:** "We adjusted lacing and heel fit to keep your foot secure in the shoe."
- **Upsell:** none · **Guard:** none

### Family D — Use case

**R-19 · Runner + knee discomfort + uneven wear**
- **Inputs:** `purpose=running` AND `discomfort_area∋knee` AND `wear_pattern∈{inner_edge,uneven_lr}`
- **Output:** category `running_stability +3` · support `stability +3` · flags `gait_review`, `rotation_guidance`, `referral_suggested`
- **Say:** "Your wear pattern isn't even, which is worth paying attention to as a runner. A stability shoe is a sensible next step, and when our gait platform is in we can look at this properly."
- **Report:** "Based on your running and your shoe wear pattern, we recommended a stability running shoe."
- **Upsell:** Second rotation pair · **Guard:** No injury-prevention claim. This rule is the clearest hardware upsell hook — mention capability, never promise a date.

**R-20 · Neutral runner + high mileage**
- **Inputs:** `purpose=running` AND `activity_level=very_active` AND `pronation=neutral`
- **Output:** category `running_neutral +3` · cushioning `plush +2` · flags `rotation_guidance`
- **Say:** "At your mileage, foam compresses faster than most people expect. Two pairs in rotation usually last longer than two pairs run back to back."
- **Report:** "We recommended a neutral, cushioned running shoe suited to your mileage."
- **Upsell:** Rotation pair · **Guard:** none

**R-21 · Work + 8+ hours standing**
- **Inputs:** `purpose=work` AND `standing_hours=8+`
- **Output:** category `work_support +3` · support `stability +2` · cushioning `plush +2` · insole `anti_fatigue +3`
- **Say:** "For a full shift, durability and an anti-fatigue insole matter as much as the shoe. The insole is the cheapest upgrade to how your legs feel at hour eight."
- **Report:** "Long shifts on hard surfaces. We recommended a durable, supportive work shoe with an anti-fatigue insole."
- **Upsell:** Anti-fatigue insole (highest-converting upsell in the set) · **Guard:** none

**R-22 · Walking primary + comfort priority**
- **Inputs:** `purpose=walking` AND `fit_priority∋comfort`
- **Output:** category `walking_comfort +3` · cushioning `plush +2` · support `light_stability +2`
- **Say:** "For walking, a smooth heel-to-toe roll is what you'll notice most. Take a lap on the hard floor, not the carpet — carpet flatters everything."
- **Report:** "We recommended a cushioned walking shoe with a smooth, comfortable stride."
- **Upsell:** Cushioning insole · **Guard:** none

**R-23 · Hiking + ankle concern**
- **Inputs:** `purpose=hiking` AND (`discomfort_area∋ankle` OR `balance_concern≠none`)
- **Output:** category `hiking +3` · heel_fit `structured +3` · support `stability +2` · flags `break_in_guidance`
- **Say:** "A mid-cut with a firm heel will feel more planted on uneven ground. Wear them around the house for a week before a long day out."
- **Report:** "We recommended a supportive hiking shoe with a structured heel, plus break-in time before longer hikes."
- **Upsell:** Hiking socks · **Guard:** No claim about preventing ankle injury.

**R-24 · Kids fitting**
- **Inputs:** `purpose=kids` OR `age_range=under_18`
- **Output:** category `kids +3` · toe_box `roomy +2` · flags `size_up_check`, `walk_test_required`
- **Say:** "We want about a thumb's width of growing room — enough to last, not so much they trip. I'd re-check the size in about three months."
- **Report:** "We fitted with growing room and recommended re-checking size in about three months."
- **Upsell:** **Suppressed** · **Guard:** No insole or orthotic upsell to minors. Follow-up defaults to 90 days (a genuinely useful reminder, and the best retention driver in the whole product).

### Family E — History & behavior

**R-25 · Previous return: too narrow**
- **Inputs:** `previous_return_reason=too_narrow`
- **Output:** width `wide +3` · toe_box `roomy +2` · flags `walk_test_required`
- **Say:** "Last time the width was the issue, so let's start a width up rather than a size up — that's usually the fix."
- **Report:** "We adjusted width based on your previous experience."
- **Upsell:** none · **Guard:** none

**R-26 · Previous return: uncomfortable (unspecified)**
- **Inputs:** `previous_return_reason=uncomfortable`
- **Output:** flags `walk_test_required`, `extended_check_in`
- **Say:** "Since the last pair didn't work out, let's take a bit longer. Walk both of these and tell me what you notice — I'd rather get it right than fast."
- **Report:** "We took extra time on fit and will check in with you shortly after purchase."
- **Upsell:** none · **Guard:** Follow-up forced to 7 days. This rule intentionally **costs** time — a second return is worse than a slow fitting.

**R-27 · Current shoe 2+ years old**
- **Inputs:** `current_shoe_age=2_plus_years`
- **Output:** cushioning `plush +1` · flags `break_in_guidance`
- **Say:** "Foam compresses over time, so a new pair will feel firmer at first even at the same model and size. That's the cushioning working, not the shoe being wrong."
- **Report:** "Your previous shoes were well used. New footwear may feel firmer at first — that's normal."
- **Upsell:** none · **Guard:** none — this is pure expectation-setting, and it prevents returns.

**R-28 · Custom orthotic user**
- **Inputs:** `uses_orthotics=custom`
- **Output:** volume `high +3` · flags `removable_insole_required`, `size_up_check` · insole `none +3`
- **Say:** "We build the fit around your orthotic. The stock insole comes out, and we check depth so your foot isn't sitting too high in the shoe."
- **Report:** "We selected footwear compatible with your custom orthotics."
- **Upsell:** **Never** · **Guard:** Do not evaluate, adjust or comment on the orthotic itself. Fit the shoe to it, full stop.

### Family F — Priorities & routing

**R-29 · Price priority + support need**
- **Inputs:** `fit_priority∋price` AND `support_level∈{stability,max_support}`
- **Output:** insole `arch_support +2` · flags `value_framing`
- **Say:** "If budget's the constraint, a solid shoe plus a good insole often beats a pricier shoe on its own — and the insole moves to your next pair."
- **Report:** "We balanced support and budget, including an insole option that carries over to future footwear."
- **Upsell:** Insole framed as a **saving**, not an add-on · **Guard:** Never push above stated budget.

**R-30 · Red-flag routing**
- **Inputs:** `notes/intake` indicate numbness or tingling, diabetes-related foot care, persistent discomfort beyond ~6 weeks, or an open sore
- **Output:** category `orthopedic_friendly +3` · toe_box `wide_round +3` · volume `high +2` · flags `referral_suggested`, `seam_free_preferred` · **all upsells suppressed**
- **Say:** "Let's keep this simple and comfortable — roomy, soft, nothing pressing anywhere. Given what you've described, it's worth having a healthcare professional take a look too."
- **Report:** "We focused on a roomy, low-pressure fit for your comfort." *(plus standard disclaimer)*
- **Upsell:** **Suppressed** · **Guard:** **Highest-sensitivity rule in the set.** No diagnosis, no alarm, no product claim. Sell nothing beyond an appropriate shoe. This rule exists to protect the customer and the company simultaneously.

---

## 7. Worked example

**Inputs:** work · standing 8+ · heel discomfort · low arch · wide · mild inward roll · inner-edge wear · size L 10.5 / R 11 · fit priority comfort + durability.

**Rules fired:** R-01, R-06, R-16, R-21

| Attribute | Winner | Tally |
| --- | --- | --- |
| support_level | `stability` | stability 3+2+2 = 7 · max_support 0 |
| cushioning_level | `plush` | plush 3+2 = 5 · moderate 1 |
| width | `wide` | wide 3 |
| insole | `anti_fatigue` | anti_fatigue 3+2 = 5 · arch_support 3 · heel_cup 3 |
| category | `work_support` | work_support 3 |
| flags | `size_asymmetry`, `walk_test_required` | |

**Confidence:** completeness 40/40, agreement 34/40, conflicts 0 → **74 → High**
(borderline; the runner-up insole values are close, so the UI offers the
arch-support insole as a secondary option rather than hiding it).

**Talking points rendered:** R-16's sizing line first (it is the most immediately
useful thing to say while holding the customer's foot), then R-21's shift line,
then R-01's wear-pattern line.

---

## 8. Versioning, tuning, and the feedback loop

- Every rule file has a semantic version. Every `recommendation` record stores
  `rules_version`, so any past recommendation can be reproduced exactly.
- **Overrides are the tuning signal.** An attribute overridden in the same
  direction more than ~20% of the time is a mis-weighted rule, not a stubborn
  associate. Review weekly during the pilot.
- **"Wrong recommendation" feedback** captures the full input state, making each
  report a regression test case.
- Golden test set: 25 hand-labeled fitting scenarios, asserted on every rule
  change. Ten minutes to build, and it stops rule edits from silently breaking
  earlier cases — the single highest-leverage test in the codebase.
- **Rules stay human-authored through the pilot.** Do not let an LLM write or
  reweight rules while the sample size is this small.

---

**Next:** [04 · Customer Fit Report](04-fit-report.md)
