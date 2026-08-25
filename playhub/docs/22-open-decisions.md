# 22 — Open Decisions I Need From You

Three are blocking. Six have defaults I will assume unless you say otherwise.

---

## 🔴 Blocking

**1. Engine: Flutter + Flame, or Unity anyway?**
My recommendation and full reasoning: [doc 01](01-tech-stack-decision.md).
This is the one decision that can't be deferred, because every subsequent file
depends on it.

**2. Price point.**
I recommend **$4.99/mo + $29.99/yr, 7-day trial, no lifetime at launch** instead
of your $0.99–$1.99 hypothesis ([doc 08 §5](08-entitlements-and-monetization.md)).
It blocks Phase 0 only because the product IDs are permanent — but the *IDs* are
price-neutral, so if you'd rather decide later, say so and I'll create them
brand- and price-neutral and we settle the number in Phase 6.

**3. Apple Developer account type: Individual or Organization?**
Organization needs a D-U-N-S number and 1–2 extra weeks, so if there's any chance
you'll want a company account, **start that today** — it is the longest-lead item
in the entire project and it blocks the bundle ID, which blocks everything.
I also need the **domain you own** for the reverse-DNS bundle ID.

## 🟡 Defaults I'll assume unless you object

| # | Question | My default |
| --- | --- | --- |
| 4 | Age design centre | **3–6**, with a Tiny mode for 2s and top-band difficulty for 7–8 ([doc 21 §2](21-critical-review.md)) |
| 5 | Kids Category age band | **5 and under** ([doc 14 §1](14-app-store-compliance.md)) |
| 6 | The three MVP games | Match Pairs, Shape Sorter, Jigsaw — chosen for three *different input models* |
| 7 | The three MVP themes | Farm (free), Dinosaur, Ocean |
| 8 | Chore system | Schema in the MVP, **feature in v1.1** |
| 9 | Art sourcing | Placeholder pipeline from day 1; commission real art from Phase 2. I'll write the briefs; you choose marketplace vs freelancer vs studio (~$50–300 vs ~$1.5–4k per theme) |

## Also worth telling me, if you know

- Do you have a Mac available at all? (Not required — CI can do every build — but
  it makes the manual device pass and the first signing setup easier.)
- Is there a launch date or budget ceiling I should be planning against?
- Do you already own a brand name / domain, or is that still open?

---

## What happens on approval

Phase 0 is roughly 95% automatable and I'd start immediately with:

1. Extract `playhub/` into its own repository, history intact
2. Flutter workspace, pinned SDK, every package skeleton with the dependency graph
3. Drift schema v1 + the migration test harness
4. All seven `tools/` scripts, including the placeholder-art generator
5. CI green on Linux: analyze, test, goldens, boundary checks, size budgets
6. `release.yaml` ready for the moment your API key exists

In parallel, your ~2 hours: Apple enrolment, bundle ID, app record, API key
([doc 18 §2](18-automation-vs-manual.md) has the exact clicks).

**I have not started any of it. Nothing is built. Say go — or push back — first.**
