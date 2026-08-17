# 01 · Product Requirements Document

**Product:** Stride Guide FitOS™ (store-side fitting interface, software-only v1)
**Owner:** Founder
**Status:** Draft for approval
**Horizon:** Pilot-ready in 7 days, hardware-ready in ~90 days

---

## 1. The problem being solved

A shoe fitting is currently a performance that leaves no trace. A good associate
asks smart questions, looks at the customer's old shoes, checks width and volume,
and makes a call. None of it is recorded. The next visit starts from zero, a
different associate asks different questions, and the store has no way to know
whether the fitting was any good.

That produces four losses the retailer actually feels:

| Loss | How it shows up |
| --- | --- |
| **Inconsistency** | The best associate converts at a much higher rate than the newest one, and nobody can copy what they do. |
| **Amnesia** | A returning customer is treated like a stranger. The store's biggest advantage over Amazon is discarded. |
| **Returns** | Fit-driven returns are absorbed as a cost of doing business because nothing captures *why* a fit failed. |
| **No reason to return** | Once the transaction ends, the relationship ends. Follow-up is either nonexistent or a generic marketing blast. |

The hardware answers "what is happening under this foot." The software answers
"what do we do about it, and how do we remember it." **The software is the part
that has to exist first**, because without it the hardware produces a picture
nobody can act on.

## 2. Product strategy

### The wedge

The wedge is not the intake form. It is **the fit report the customer walks out
with.** That artifact is the only part of the system the customer sees, it is
what makes the fitting feel premium, it is what gets photographed and shown to a
spouse, and it is the permission structure for follow-up. Everything else in v1
exists to produce that report in under three minutes.

### The four questions

Every screen in the product must earn its place by answering one of these:

| Question | Screen that answers it |
| --- | --- |
| 1. What do we know about this customer? | Dashboard → Customer profile → Fit History |
| 2. What should the associate do next? | Intake → Assessment → Recommendation talking points |
| 3. Why does this shoe category make sense? | Recommendation rationale (rule-derived, plain language) |
| 4. How do we bring this customer back? | Fit report + follow-up queue |

If a proposed feature answers none of these, it does not go in v1.

### What this is and is not

- **Is:** a footwear fitting intelligence system — a guided workflow that
  produces a structured fit profile, a retail recommendation, and a customer
  artifact.
- **Is not a CRM.** Contact records exist only to attach fit history and enable
  one follow-up. No pipelines, no campaigns, no deal stages.
- **Is not a form.** A form collects; this interprets. The output is a
  recommendation with reasoning, not a saved submission.
- **Is not a medical device.** No diagnosis, no treatment, no clinical claims.
  Retail-safe language is enforced structurally, not left to associate judgment.

## 3. Product name

**Recommendation: Stride Guide FitOS.**

| Candidate | Verdict |
| --- | --- |
| **Stride Guide FitOS** | **Chosen.** Signals system-of-record and platform, not utility. Gives the fitting workflow a noun ("run it through FitOS"). Survives the hardware launch — the platform becomes an input to FitOS rather than a separate product. |
| Stride Guide Lite | Positions the first paid product as the cheap one. Hard to charge for, hard to un-say later. |
| Stride Guide Pro | Implies a Lite exists. Reserve as a **tier**, not a product name. |
| Stride Guide Retail | Descriptive and forgettable; says nothing a store owner would repeat. |

Use Lite / Pro / Enterprise as **pricing tiers under FitOS** when tiering becomes
necessary. Public naming: *Stride Guide FitOS™*, spoken as "FitOS."

## 4. Users and personas

### P1 — Store owner / GM ("the buyer")
**Ray, 52, owns two comfort-footwear stores.**
Buys the subscription, does not use it daily. Cares about staff consistency,
returns, and whether the thing makes his floor look modern. Deeply allergic to
software that his staff will abandon in three weeks — he has bought that before.

- **Wins with:** a weekly number showing fittings completed and follow-ups sent; a report his customers compliment; something he can point at when a customer says "I'll check Amazon."
- **Loses with:** a login he has to chase, training that takes more than 10 minutes, anything that slows a Saturday.
- **Success signal:** asks whether he can put it in his second store.

### P2 — Veteran associate ("the skeptic")
**Denise, 34, 11 years on the floor, best fitter in the store.**
Already does this in her head and does it well. Will experience any structured
tool as an accusation that she is doing it wrong, and will kill it socially if it
slows her down.

- **Wins with:** speed (fewer taps than her current notepad), a report that makes *her* look expert, and history that saves her re-interviewing a repeat customer.
- **Loses with:** being told what to recommend, mandatory fields she considers irrelevant, anything that makes the customer wait while she types.
- **Design consequence:** the recommendation is framed as *"here's the case for this"*, never *"do this."* She must be able to override in one tap, and the override must be recorded without friction or judgment.

### P3 — New / part-time associate ("the biggest beneficiary")
**Marcus, 19, four weeks in, works Thursdays and weekends.**
Does not know what a heel counter is. Currently guesses, or grabs whatever is on
the display wall.

- **Wins with:** questions to ask, words to say, and a defensible recommendation. The talking points are the product for him.
- **Loses with:** jargon, screens that assume experience, anything that exposes his inexperience to the customer.
- **Design consequence:** every clinical term needs a plain-language helper on tap, and the assessment must be answerable by observation alone.

### P4 — The customer ("the recipient")
**Anyone from a marathoner to a nurse on a 12-hour shift.**
Never touches the interface. Judges the whole system by two things: did this feel
more thorough than a normal shoe store, and did I leave with something.

- **Wins with:** a clean report with their name on it and a next step.
- **Loses with:** feeling diagnosed, feeling harvested for data, or a long wait while someone types.

### P5 — Regional / franchise ops manager (post-MVP)
Manages 4–40 doors. Cares about adoption per store and per associate, and about
standardizing fittings across a chain. **Explicitly out of scope for v1** — noted
so v1 does not accidentally block it (store_id on every record does the job).

## 5. Scope

### v1 (MVP) — in scope

1. Store dashboard: new fitting, recent fittings, customer search, follow-up
   reminders, three stat tiles, pilot feedback capture.
2. Customer create/lookup with duplicate prevention and explicit consent capture.
3. Intake: shopping purpose, problem, discomfort area, activity, standing hours,
   current shoe, fit priority, return history, orthotics, wear concern, notes.
4. Manual fit assessment: sizes, width, arch, foot shape, pronation tendency,
   risk flags, associate's own recommended levels.
5. Deterministic recommendation engine (30 rules) producing a fit profile,
   category, support/cushioning levels, width/volume notes, insole opportunity,
   talking points, confidence and rationale.
6. Products to consider / avoid, filtered from a curated shoe database.
7. Customer fit report: on-screen, printable, emailable via link.
8. Single follow-up scheduling with a reminder queue in-store.
9. Fit history on the customer record — the second visit shows the first.
10. Associate override capture on every recommendation.

### v1 — explicitly out of scope

See §9 "What not to build yet."

## 6. Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-01 | An associate can start a fitting from the dashboard in one tap. | Must |
| FR-02 | Customer lookup by phone returns matches in under 300ms and blocks duplicate creation on exact phone match. | Must |
| FR-03 | A fitting autosaves after every field change and is resumable after app close, tablet sleep, or network loss. | Must |
| FR-04 | Consent must be explicitly recorded (who, when, text version) before contact details are stored. | Must |
| FR-05 | The recommendation is computed locally and deterministically from intake + assessment, with no network dependency. | Must |
| FR-06 | Every recommendation displays confidence and a plain-language rationale citing the inputs that drove it. | Must |
| FR-07 | The associate can override any recommended attribute; the override and optional reason are stored. | Must |
| FR-08 | A fit report can be generated, printed, and sent by email link at the end of a fitting. | Must |
| FR-09 | Every report includes the non-medical disclaimer, store identity and date. | Must |
| FR-10 | Returning-customer fittings display the previous fit profile and what changed. | Must |
| FR-11 | A follow-up can be scheduled at 7/30/90 days and appears in the store's queue on the due date. | Must |
| FR-12 | An associate can log pilot feedback from any screen in two taps. | Must |
| FR-13 | Shoe products can be imported per store via CSV and mapped to canonical models. | Should |
| FR-14 | Products to consider are filtered by store inventory when inventory exists, and fall back to canonical models when it does not. | Should |
| FR-15 | An outcome (purchased / not purchased / which shoe) can be recorded at fitting close. | Should |

## 7. Non-functional requirements

| Area | Requirement |
| --- | --- |
| **Speed** | Fitting workflow completes in **under 3 minutes** at the median. Screen transitions under 150ms. No spinner in the fitting path. |
| **Resilience** | Store Wi-Fi is unreliable. A fitting in progress must never be lost to a dropped connection; drafts persist locally and sync when possible. |
| **Device** | Primary target: 10–11" tablet, landscape, one-handed use while standing. Secondary: laptop for the owner. Not a phone product in v1. |
| **Learnability** | A new associate completes a supervised fitting correctly with under 10 minutes of instruction. |
| **Accessibility** | WCAG 2.2 AA: 4.5:1 text contrast, 44px minimum touch targets (56px preferred), full keyboard path for the laptop case, no color-only meaning. |
| **Privacy** | Contact identity separated from fit data; scan/fit records reference a customer by ID. Exports exclude direct identifiers by default. |
| **Legal** | No diagnostic or treatment claims anywhere in UI, report, or generated text. Consent stored per customer with text version and timestamp. SMS requires separate opt-in. |
| **Portability** | No data model decision that blocks the pressure platform (see [09](09-build-plan.md#4-hardware-integration-plan)). |

## 8. Success metrics

**Pilot success (first 30 days, 2–4 stores).** These are the numbers that decide
whether this is a product or a demo.

| Metric | Target | Why it matters |
| --- | --- | --- |
| Fittings completed per store per week | ≥ 25 | Proves it survives a real Saturday, not just a demo. |
| Median time to complete | < 3:00 | The single most likely cause of abandonment. |
| Completion rate (started → report) | ≥ 85% | Drop-off points tell you exactly which screen is too long. |
| Associate adoption | ≥ 70% of on-shift associates use it weekly | One enthusiast is not adoption. |
| Report send rate | ≥ 60% of completed fittings | Measures customer-perceived value, not just internal use. |
| Insole attach rate on flagged fittings | ≥ 20% | The first hard revenue proof — a number Ray can multiply. |
| Follow-up completion | ≥ 50% of due reminders actioned | Tests whether retention is real or theater. |
| Override rate | 15–35% | **Both directions are bad.** Under 15% means associates are rubber-stamping; over 35% means the rules are wrong. |

**Deliberately not measured in v1:** return-rate reduction. It requires POS
integration and a baseline the store probably cannot produce. Claiming it without
data would poison the pilot. Collect the inputs (outcome + follow-up response)
now, make the claim when there is evidence.

## 9. What NOT to build yet

The most valuable section of this document. Each of these is a real temptation
with a real reason to wait.

| Do not build | Why not now | When |
| --- | --- | --- |
| POS / inventory integration | Every store has a different system; each is weeks of work for zero pilot learning. CSV import gets 90% of the value. | After 3 pilots ask for the same POS by name. |
| Native iOS/Android app | A well-built responsive web app on a tablet is indistinguishable to the user and ships 5× faster. | When offline-first or hardware BLE pairing demands it. |
| Customer login / portal | Nobody creates an account for a shoe store. The report link is the portal. | Possibly never. |
| ML-based recommendations | You have zero outcome data. A model trained on nothing is worse than 30 good rules and cannot be explained to a skeptical associate. | After ~2,000 fittings with recorded outcomes. |
| LLM in the recommendation path | Latency, cost, non-determinism and legal exposure in the one place you need none of them. | Never for deciding; soon for phrasing. |
| Multi-store analytics dashboard | You have no multi-store customers. | At the first chain. |
| Gait video capture / analysis | Enormous scope, storage cost and clinical-claim risk. The hardware is the answer here. | With hardware, if at all. |
| SMS follow-up | TCPA consent, carrier registration (10DLC), and per-message cost before you have proven anyone wants the follow-up. Email first. | After follow-up value is proven by email. |
| Loyalty / marketing automation | This is the CRM trap. One follow-up, done well. | Post-pilot, only if stores ask. |
| Orthotic prescription logic | Direct route to medical-claim exposure. | Never without a clinical partner and counsel. |
| Full offline sync engine | Real engineering. Local draft persistence covers the actual failure mode (a dropped fitting). | When a pilot store's Wi-Fi genuinely fails mid-fitting more than once. |
| Barcode/SKU scanning | Nice demo, marginal time saved, needs clean inventory data first. | With inventory integration. |
| QR-code report sharing | The emailed link works today. QR is a 2-hour add later. | Post-pilot polish. |
| Spanish (or other) localization | Adds a translation pass to every string change during the period of maximum churn. | When a pilot store's floor needs it — ask during pilot selection. |
| User-configurable rules UI | Rules will change weekly during the pilot. Edit JSON and redeploy; do not build an editor for one editor. | When a non-technical person needs to tune rules. |

## 10. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Associates abandon it because it slows a sale | **Critical** | The 3-minute budget is a hard design constraint, not an aspiration. Test with a real associate on day 5, not day 30. Every screen has a "skip" path. |
| The veteran associate kills it socially | High | Position as *"makes your expertise portable"*; give her the override; show her the returning-customer screen, which is the one thing she cannot do in her head. |
| Recommendations feel obvious to experts and therefore worthless | High | The value for experts is the record and the report, not the advice. Sell those to P2, sell the advice to P3. |
| A customer treats the report as medical advice | High | Structural language guardrails, mandatory disclaimer, referral routing for red flags, no anatomical diagnosis vocabulary anywhere. |
| Store Wi-Fi drops mid-fitting | Medium | Local draft persistence from day one. |
| Shoe database goes stale | Medium | Start with the ~120 models actually on the pilot walls; the value is fit characteristics, which change slowly, not stock levels. |
| Pilot store loves it and asks for POS integration immediately | Medium | Have the "not yet, here's the CSV path" answer ready; treat as validation, not a requirement. |
| Hardware arrives and forces a data model rewrite | Medium | Assessment schema is designed as the sensor schema from day one ([09](09-build-plan.md#4-hardware-integration-plan)). |

## 11. Pilot commercial frame (light touch)

Not a pricing exercise, but the build should not contradict a plan:

- 2–4 pilot stores, free for 60 days in exchange for weekly feedback calls and
  permission to use anonymized outcomes.
- Target post-pilot: per-store monthly subscription, with the hardware sold or
  leased as an upgrade that unlocks scan capture inside the same FitOS workflow.
- The pitch to the store is one sentence: *"Every fitting your team does becomes
  a record you own, a report your customer keeps, and a reason for them to come
  back."*

---

**Next:** [02 · UX Specification](02-ux-spec.md)
