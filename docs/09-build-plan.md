# 09 · Build Plan

Solo founder, limited budget, PCB arriving in 1–2 weeks, pilot stores to win.

---

## 1. Build sequence

Ordered by dependency and by how early each step can be shown to a real store.

| Phase | Scope | Outcome |
| --- | --- | --- |
| **0 · Decide** | Approve this blueprint. Lock name, palette, and two pilot stores. | No ambiguity enters the build |
| **1 · Spine** | Schema + project skeleton + a fitting record that persists | A fitting exists end to end, ugly but real |
| **2 · Flow** | Intake → Assessment screens with autosave and resume | The 3-minute path is walkable |
| **3 · Intelligence** | Rules engine + golden tests + Recommendation screen | The product becomes *the product* |
| **4 · Artifact** | Fit report: screen, print, email link | The customer-visible payoff exists |
| **5 · Operations** | Dashboard, search, fit history, follow-ups, pilot feedback | A store can actually run on it |
| **6 · Catalog** | 120 curated shoe models + matching + CSV import | "Consider / avoid" gets real |
| **7 · Pilot** | Seed data, deploy, onboard two stores, weekly feedback loop | Learning starts |

**Build order rule:** every phase ends with something demonstrable to a store
owner. Never spend two consecutive days on work with nothing to show.

---

## 2. The 7-day execution plan

Assumes ~8–10 focused hours per day. Each day has one deliverable and one gate.

### Day 0 — Decisions (2 hours, before building)

- [ ] Approve or redline this blueprint
- [ ] Confirm product name (**Stride Guide FitOS** recommended)
- [ ] Confirm the design pivot to light + teal
- [ ] **Get two pilot stores to verbally commit** — do this first; it changes what you build
- [ ] Ask each: what's on your wall, what POS do you use, what's your worst return reason
- [ ] Set up Supabase, Vercel, and the repo

**Gate:** two stores committed. If zero stores commit, stop building and go sell —
a product with no pilot is a hobby.

### Day 1 — Spine

Schema from [05](05-data-model.md) as SQL migrations · RLS on every table ·
Next.js + Tailwind skeleton with the [08](08-design-language.md) tokens ·
store/associate seed · associate picker · create a `fitting` and persist it.

**Deliverable:** tap New Fitting → a row appears in Postgres.
**Gate:** RLS verified — a second store's rows are invisible. Fix this today or
never.

### Day 2 — Flow

Customer search/create with phone dedupe + consent capture · Intake screen (all
14 fields, chips) · Assessment screen (all 17 fields) · autosave on every change
· local draft persistence · resume from dashboard.

**Deliverable:** a complete fitting captured end to end, no recommendation yet.
**Gate:** time yourself through it. If intake + assessment exceeds 2:00 with
practice, cut fields now — not later.

### Day 3 — Intelligence

Rules as JSON ([03](03-recommendation-engine.md)) · evaluator + scoring +
confidence + conflicts · **25-scenario golden test set** · Recommendation screen
with profile, levels, talking points, why, confidence · override capture.

**Deliverable:** real inputs produce a defensible recommendation with reasoning.
**Gate:** run 10 fittings from memory of real customers. Does the output match
what a good associate would say? If not, the rules are wrong — fix them before
building anything on top.

### Day 4 — Artifact

Report route (server-rendered, serif, one page) · print stylesheet tested on a
real printer · signed report link + expiry · email send via Resend · report
toggles · disclaimer.

**Deliverable:** a report you would hand to a customer.
**Gate:** print it. Show it to someone outside the project. If they do not say
some version of "that's nice," redesign it — this artifact carries the product.

### Day 5 — Operations, and the real test

Dashboard (new fitting, recent, search, stats, follow-ups) · customer profile +
fit history + "what changed" · follow-up scheduling and queue · pilot feedback
sheet · close sheet with outcome.

**Then, non-negotiable: put the tablet in a real associate's hands.** Watch a
real fitting. Say nothing. Write down every hesitation.

**Deliverable:** a store can run a day on it.
**Gate:** the associate completes a fitting without you touching the tablet.

### Day 6 — Catalog and repair

Morning: fix everything day 5 exposed — that list is more valuable than anything
you planned. Afternoon: seed ~120 shoe models from the pilot stores' walls ·
product matching · consider/avoid blocks · CSV import if time allows.

**Deliverable:** recommendations name real shoes the store actually stocks.
**Gate:** every recommendation still renders correctly with the catalog empty.

### Day 7 — Ship

Seed demo data for the sales conversation · deploy to a real domain · Sentry +
PostHog with per-screen timing · one-page onboarding sheet for associates · 10
practice fittings, fixing as you go · schedule the weekly feedback call.

**Deliverable:** two pilot stores live.
**Gate:** the median of your 10 practice fittings is under 3:00.

### Deferred to week 2+, deliberately

CSV import (if not reached), QR sharing, PDF attachments, owner analytics, rule
tuning UI, offline sync, SMS, multi-store roles.

---

## 3. After day 7

| Week | Focus |
| --- | --- |
| 2 | Watch usage daily. Fix the top drop-off screen. Tune rules from overrides. |
| 3 | Second-visit experience — the first returning customers arrive and it is the moment the product proves itself. |
| 4 | Outcome capture quality; first insole attach-rate number for the sales pitch. |
| 5–8 | Hardware integration ([§4](#4-hardware-integration-plan)); third and fourth pilot stores. |
| 9–12 | Case study from real pilot data; pricing conversation; reskin the landing page to the new design system. |

---

## 4. Hardware integration plan

### The core promise

**The manual assessment schema *is* the sensor schema.** Every field an associate
fills in today is a field the platform will fill in later, in the same vocabulary,
on the same record. That single decision means the hardware arrives as a
*data source*, not a rebuild.

```
  TODAY                          AFTER HARDWARE
  ┌─────────────────┐            ┌─────────────────┐
  │ Associate taps  │            │ Platform reads  │
  │ arch_type: low  │            │ arch_type: low  │
  │ source: manual  │            │ source: sensor  │
  └────────┬────────┘            └────────┬────────┘
           │                              │
           └──────────► fit_assessment ◄──┘
                              │
                        SAME RULES
                        SAME REPORT
                        SAME HISTORY
```

### What changes

| Component | Change |
| --- | --- |
| `fit_assessment` | No schema change. The `source` jsonb flips fields from `manual` to `sensor`. |
| Assessment screen | Becomes **confirm, not enter**: fields arrive pre-filled with a small sensor icon; the associate confirms or overrides. Same layout, roughly 40 seconds faster. |
| Rules | **Unchanged.** They consume the same input vocabulary regardless of origin. This is the payoff of the two-stage design in [03](03-recommendation-engine.md). |
| `scan` table | Activated ([05 §13](05-data-model.md#13-scan-reserved--hardware)). Raw frames to object storage, derived values to the assessment. |
| Fit report | Gains one pressure-map block. Everything else identical. |
| Fit history | Gains scan-over-scan comparison — the single most compelling screen in the product. |
| Dashboard | Gains a device health panel. |

### Integration steps (weeks 5–8)

1. Device gateway: platform → store computer → authenticated ingest endpoint.
2. Raw capture stored; a derivation service maps pressure/load data into the
   assessment vocabulary.
3. **Calibration period:** run sensor and manual in parallel on 100 fittings and
   compare. This dataset is worth more than the sensor itself — it tells you
   which derived values to trust.
4. Scan quality gating: below a threshold, fall back to manual entry silently.
5. Ship the confirm-flow assessment screen.
6. Add the pressure map to the report and history.

### What must not change

- The associate keeps the override. **The sensor advises; the human decides.**
  Reverse that and you have built a medical device.
- Recommendations remain explainable in words, not just pictures.
- The product must keep working in a store with no hardware — that is the
  land-and-expand path and the entire software business.
- No new clinical vocabulary sneaks in with the sensor data. A heat map makes it
  much more tempting to sound medical; the guardrails apply unchanged.

### Risks

| Risk | Mitigation |
| --- | --- |
| Sensor disagrees with the associate | Log both. Disagreement is a research asset, not a bug. |
| Scan adds time to a 3-minute flow | Scan replaces manual entry; net time must go **down**. Measure it. |
| Hardware failure blocks fittings | Manual path never gets removed. |
| The heat map becomes the product | The recommendation and report stay the deliverable; the map is evidence. |

---

## 5. Open questions for the founder

Blocking or near-blocking, worth answering before day 1:

1. **Pilot stores:** which two, and what do they actually stock?
2. **Size units:** US only for v1, or do the pilots need EU/UK?
3. **Printer reality:** do the pilot stores have a printer the tablet can reach,
   or is email-only the v1 path?
4. **Store logos:** can you get high-resolution marks for the report header
   before day 4?
5. **Associate count per pilot store** — sets whether the associate picker needs
   PINs.
6. **Insole line:** what do the pilot stores actually sell? Every upsell in the
   rule set should map to a real SKU on their shelf.
7. **Spanish on the floor** — needed at either pilot store?
8. **Hardware date:** realistically, when does a working unit sit on a store
   floor? That date sets whether week 5–8 integration is real or optimistic.

---

## 6. Definition of done for v1

- [ ] A new associate completes a fitting unaided in under 3 minutes
- [ ] A customer leaves with a report that looks worth keeping
- [ ] A returning customer's second fitting starts from their first
- [ ] The store owner can see the week's numbers in one glance
- [ ] A wrong recommendation can be reported in two taps and reproduced exactly
- [ ] Nothing in the product makes a medical claim
- [ ] The hardware can be plugged in without changing the data model

---

**Back to:** [Blueprint index](README.md)
