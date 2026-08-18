# 09 · Build Plan

Solo founder, limited budget, PCB arriving in 1–2 weeks, pilot stores to win.

> **Revision 2** after founder review. Phase 0 gate loosened to a design-partner
> standard; WordPress/MyStrideID topology made explicit; tenancy, provenance,
> versioning and device identity pulled forward; the hardware section rewritten
> around a canonical feature model; the medical-device claim removed. See
> [00-revision-log](00-revision-log.md).

---

## 1. Build sequence

| Phase | Scope | Outcome |
| --- | --- | --- |
| **0 · Discovery** | Approve blueprint. Secure a design partner. Capture the eight operational facts in §2. | The architecture stops guessing |
| **1 · Tenancy spine** | organization → location → user → customer → fitting_session, with RLS proven | The multi-tenant boundary is real before any feature sits on it |
| **2 · Flow** | Intake → Assessment, debounced autosave, draft/void lifecycle | The 3-minute path is walkable |
| **3 · Intelligence** | Feature model → rules → fit profile → product requirements → ranking → explanation, all versioned | The product becomes *the product* |
| **4 · Artifact** | Report as a record: screen, print, email, access log | The customer-visible payoff exists |
| **5 · Operations** | Dashboard, search, fit history, structured deltas, minimal follow-up, feedback capture | A location can run a day on it |
| **6 · Catalog** | product_model → product_variant → location_inventory, seeded or imported | "Consider / avoid" gets real |
| **7 · Pilot** | Deploy, onboard, weekly feedback loop, device-health scaffolding | Learning starts |

Every phase ends with something demonstrable to a retailer. Never two
consecutive days with nothing to show.

---

## 2. Phase 0 — Discovery

### The gate

> **Gate:** at least **one committed design partner**, or **two retailers willing
> to run structured discovery and usability testing**.

Not "two verbal pilot commitments." The problem, the retail use cases, the
pricing thesis, the retention thesis and the physical MVP are already defined —
software work does not stop because a handshake has not happened by an arbitrary
deadline. A design partner who will answer the phone every week is worth more
than two vague pilot promises anyway.

**A design partner commits to:** weekly feedback, floor access for observation,
their assortment list, and permission to use de-identified outcomes.

### What must be captured before Phase 1

These eight facts change the architecture, not just the roadmap. Capture them
into `location` ([05 §3](05-data-model.md#4-location)) as real fields.

| # | Capture | Why it changes the build |
| --- | --- | --- |
| 1 | **POS system** (exact product and version) | Determines whether any integration is ever plausible, and what outcome data can be reconciled |
| 2 | **Inventory source and format** | Decides whether CSV import is Day 6 priority #1 or unnecessary (§7) |
| 3 | **Associate count per location** | Sets whether the user picker needs PINs, and whether attribution is meaningful |
| 4 | **Return / exchange workflow** | Determines whether return outcomes can ever be tied back to a fitting — the highest-value data in the system |
| 5 | **Current customer identification method** | Phone? Loyalty ID? Nothing? Drives `identification_method` and the whole lookup design |
| 6 | **Is phone-number lookup operationally acceptable?** | If associates will not ask for a phone, the entire dedupe strategy changes |
| 7 | **Wi-Fi reliability and tablet environment** | Sets how much offline hardening is real work versus paranoia |
| 8 | **Do they track associate attribution today?** | Predicts whether per-user metrics will be welcomed or resisted |

---

## 3. Platform topology — WordPress stays in its lane

MyStrideID.com already exists as a WordPress property. It stays. It does **not**
become the application.

```
  MyStrideID.com              WordPress — marketing, content, CMS, SEO
        │
        │  links / SSO handoff / lightweight bridge plugin
        ▼
  app.MyStrideID.com          Stride Guide FitOS — Next.js application
        │
        ▼
  Supabase                    Auth · Postgres · Storage · RLS · backend services
        │
        ▼
  (later) device gateway      Hardware ingest
```

**WordPress is the presentation and CMS layer. It is not the application
database, not the identity provider, and not the core runtime.** No fitting
logic, no recommendation code, no customer fit data in PHP or in the WordPress
database — ever. If a WordPress page needs application data, it calls a
documented FitOS API through a thin bridge plugin, read-only, scoped.

Stating this now prevents the predictable future in which someone reasons
"the site is WordPress, so the app should be a plugin," and the fitting engine
ends up in a theme directory.

**Open item:** the existing landing page in this repo currently declares
`strideguide.co` as its canonical domain. Decide whether that page becomes
MyStrideID.com content, redirects, or stays as a separate brand site — it is a
15-minute change once decided, and a confusing mess if left ambiguous.

---

## 3b. Standing architectural instruction — customer identity

This is a build constraint, not a preference. It holds for every line of code
written from Day 1 onward.

> Architect customer data as retailer-scoped relationships linked optionally to a
> separate global `person_identity`. A retailer's customer and fitting records
> remain organization/location scoped. Global identity resolution must not imply
> cross-retailer visibility. Identity matching, consumer consent, and retailer
> authorization must be separate concepts. `person_identity_id` must be nullable
> so MyStrideID can be introduced later without migrating existing customer
> records.

What this buys: the commercial decision about whether MyStrideID becomes a
cross-retailer network **does not have to be made now**, and stays reversible
either way. Day 1 ships a conventional retailer-owned customer system. The option
on a portable consumer Fit ID — plausibly worth more than the pressure platform —
costs one nullable column and a resolution table nobody has to use yet.

Schema in [05 §6–§12](05-data-model.md#6-person_identity--global-optional-deliberately-almost-empty).

---

## 4. The 7-day plan

~8–10 focused hours per day. One deliverable and one gate per day.

### Day 0 — Decisions (2 hours)

- [ ] Approve or redline this blueprint
- [ ] Confirm name (**Stride Guide FitOS**) and the light + teal design pivot
- [ ] Secure the design partner (gate, §2)
- [ ] Capture the eight operational facts
- [ ] Decide: CSV import in or out for Day 6, based on fact #2
- [ ] Provision Supabase, Vercel, repo, `app.MyStrideID.com` DNS

### Day 1 — Tenancy spine

Migrations for `organization → location → user → organization_customer →
fitting_session` · `location_customer_access` enforced in RLS ·
`person_identity` and `identity_resolution` created but **unused**, with
`person_identity_id` null throughout · service-role separation · Next.js +
Tailwind skeleton with [08](08-design-language.md) tokens · user picker · create
and persist a session.

The identity tables cost perhaps twenty minutes on Day 1 and are the entire
reason the MyStrideID decision can wait. Nothing reads them yet.

**Deliverable:** a fitting session exists under a real tenant hierarchy, with a
customer numbered per retailer and visible only at the location that created
them.

**Gate — the tenant isolation suite, all six passing:**

1. Org A cannot **read** Org B's rows.
2. Org A cannot **update** Org B's rows.
3. Org A cannot **enumerate** Org B's IDs (no count, no existence leak, no error-message oracle).
4. A report URL cannot be walked to another report by altering an ID.
5. **Storage objects** obey the same tenant boundary as their rows.
6. **Service-role operations are explicitly separated** from user operations and are audited.
7. A customer created at Location 1 is **invisible at Location 2** of the same organization until an access grant exists.
8. Setting `person_identity_id` on two organizations' customers creates **no** query path between them.

A passing `SELECT` test alone is not isolation. Fix this on Day 1 or never.

### Day 2 — Flow

Customer search/create on **HMAC phone lookup** ([05 §6](05-data-model.md#10-contact-identity--keyed-hashes-scoped-per-organization)) ·
multi-type consent capture ([05 §7](05-data-model.md#11-consent_record)) ·
Intake · Assessment · draft lifecycle.

**Autosave, done properly** — not a write per tap:

```
  local optimistic state  →  debounce 500–1500ms  →  server ack  →  local draft backup
       (instant UI)            (by field type)        (authoritative)   (survives reload)
```

Steppers and chips debounce at the short end; free text at the long end. The
session is `draft` until intake is meaningfully complete, `in_progress` through
the flow, `completed` only at the end, `voided` on request. **An accidentally
opened screen must never become a historical fitting.**

**Gate:** time yourself. If intake + assessment exceeds 2:00 with practice, cut
fields now.

### Day 3 — Intelligence (slow down here)

This is the product. Build it as an explicit contract, not a lookup table.

```
  observed_features        canonical, provenanced  ([05 §10](05-data-model.md#15-the-canonical-fit-feature-model))
        ↓
  derived_fit_profile      support / cushioning / width / volume / toe box / heel / category / insole
        ↓
  product_requirements     the abstract characteristics a shoe must have
        ↓
  candidate_products       filtered against location assortment
        ↓
  ranking                  ordered, with reasons
        ↓
  explanation              associate talking points + customer rationale
```

**`low_arch` must never map directly to a named shoe.** It maps to a stability
requirement, which maps to midsole and support characteristics, which match
candidate inventory, which ranks. That layering is what makes the intelligence
portable across catalogs and retailers — and it is the part of the system with a
defensible IP story.

Also today: **five version stamps on every recommendation** —
`recommendation_engine_version`, `rule_set_version`, `catalog_version`,
`feature_schema_version`, `assessment_schema_version` — plus the frozen feature
snapshot. Without these, "reproduce this recommendation exactly" is a slogan.

**Gate:** the 25-scenario golden test set passes, **and** a working retail fitter
(the design partner's best associate, not you from memory) reviews 10 outputs and
agrees with the reasoning. Memory of past customers is not validation.

### Day 4 — Artifact

Report as a **record** ([05 §17](05-data-model.md#22-report-and-report_view)):
`report_version`, `template_version`, hashed access token, expiry, revocation ·
server-rendered page · print stylesheet on a real printer · transactional email ·
`generated_at` / `emailed_at` / `printed_at` / view log.

Access resolves `customer → fitting_session → report_version`, so a future
customer-history portal on MyStrideID needs no redesign.

**Transactional communication only.** The report email is transactional; it uses
its own sender identity, template set and suppression rules. Retention marketing
is a different subsystem for a later quarter, and conflating them now creates a
compliance problem that is tedious to unwind.

**Gate:** print it. Show it to someone outside the project.

### Day 5 — Operations, and the real test

Dashboard · customer profile · fit history · **structured `assessment_delta`**
([05 §14](05-data-model.md#19-assessment_delta--what-changed-since-last-visit)) —
stored as data, not computed at render · minimal follow-up (due list + Done,
nothing more) · pilot feedback sheet · outcome capture.

Analytics wired with an **explicit event allowlist**: `assessment_started`,
`assessment_completed`, `recommendation_viewed`, `recommendation_overridden`,
`report_generated`, `report_sent`, each carrying IDs and enums only. No names,
phones, notes, report URLs or pressure data. Session replay off or aggressively
masked over every customer field.

**Then put the tablet in a real associate's hands and say nothing.** Write down
every hesitation.

**Gate:** the associate completes a fitting without you touching the tablet.

### Day 6 — Catalog and repair

Morning: fix everything Day 5 exposed. Afternoon: catalog in three layers
([05 §15](05-data-model.md#20-catalog-three-layers)) — `product_model` (global
knowledge) → `product_variant` (sellable) → `location_inventory` (assortment).

**Priority set by Phase 0 fact #2:** if the partner can export inventory, **CSV
import is priority #1 today** — hand-seeding 1,000 SKUs is not a plan. If they
cannot, seed ~120 models from their wall and move on.

**Gate:** every recommendation still renders correctly with an empty catalog.

### Day 7 — Ship

Deploy to `app.MyStrideID.com` · Sentry · analytics per the allowlist ·
**device-health scaffolding** (§6) even with no hardware attached · seed demo
data · one-page associate onboarding · 10 practice fittings.

**Gate:** median time-to-recommendation across 10 practice fittings under 3:00.

### Deferred deliberately

Follow-up UI beyond a list · QR sharing · PDF attachments · owner analytics ·
rule-authoring UI · offline sync engine · SMS · POS integration · marketing
automation.

---

## 5. Measure the system, not the stopwatch

Under three minutes stays a design constraint. It is not the KPI — a blazing-fast
workflow nobody values is still a failure.

| Layer | Metric |
| --- | --- |
| **Workflow** | Fitting completion rate · time to recommendation · associate error/correction rate |
| **Decision** | Recommendation acceptance rate · override rate **with reason** |
| **Commercial** | Footwear purchase rate · insole attach rate · recommended-vs-purchased match |
| **Durability** | Return / exchange outcome · repeat visit rate · time to second visit |

Completion rate and override-with-reason are the two that tell you whether the
product is working. Duration only tells you whether it is fast.

---

## 6. Hardware integration

### The correct abstraction

The earlier draft said "the manual assessment schema *is* the sensor schema."
That is wrong, and taken literally it would cripple the platform. A sensor
produces things a human cannot: a pressure matrix, center-of-pressure track,
peak pressure, contact area, left/right load distribution, temporal frames,
normalized pressure, total measured load, and capture-quality metrics. Forcing
those into a dropdown-shaped human schema discards the entire reason for
building hardware.

```
  Manual assessment ─────────────┐
                                 ├──► CANONICAL FIT FEATURE MODEL ──► recommendation engine
  Sensor derivation ─────────────┘         (versioned, provenanced)

  Raw scan (immutable) ──► scan_derivation (algorithm vN) ──► derived features ──┘
```

Manual observation and sensor derivation are **two sources feeding one canonical
model**. Each feature carries structured provenance —
`source_type`, `source_record_id`, `algorithm_version`, `quality`, `captured_at`,
`overridden_by`, `override_reason` — as first-class columns, not a loose JSONB
blob. If the system's reasoning ever has to be defended, provenance is the
defence.

### The compatibility promise, stated accurately

Not "rules never change." The honest promise is **backwards compatibility**:

- V1 sensor-derived features **map into existing canonical features**, so the
  Day-3 rule set keeps working the moment hardware arrives.
- The feature dictionary is **additive within a major version** — new keys may
  appear; existing keys never change meaning or lose enum values.
- Sensor-native features (`medial_pressure_ratio`, COP deviation, load
  asymmetry) **extend** the model, and later rule versions may use them.
- Every recommendation records the versions it ran under, so old fittings stay
  reproducible after the rules improve.

Hardware will almost certainly reveal better signals than `pronation = moderate`.
The architecture must welcome that, not promise it will not happen.

### Integration steps (weeks 5–8)

1. **Device identity first.** `device`, `device_installation`,
   `device_health_event` ([05 §19](05-data-model.md#24-device-device_installation-device_health_event)).
   Every scan records which device, firmware, calibration and hardware revision
   produced it.
2. **Authenticated ingest:** platform → store host → signed ingest endpoint, with
   device public-key auth and replay protection.
3. **Immutable raw capture.** Pressure frames and the **simultaneous load-cell
   series** stored together with a checksum. Never overwritten.
4. **Derivation pipeline:**
   `raw plantar matrix + synchronized load-cell reading → normalize pressure
   distribution by measured load → derive features`. Normalizing pressure by
   actual measured load is the specific thing that makes this data more useful
   than a pressure mat alone, and it only works if both streams are captured
   together. Derivations are versioned and re-runnable over old raw captures.
5. **Parallel calibration:** run sensor and manual side by side. 100 fittings is
   the minimum to look at; **treat 300–500 as the threshold for drawing
   conclusions** on any feature where the two disagree. This dataset is worth
   more than the sensor.
6. **Quality gating:** below threshold, fall back to manual entry silently.
7. Ship the confirm-flow assessment screen, then the pressure map on report and
   history.

### Device health ships early — deliberately

Build heartbeat, firmware version, calibration date, last scan, error count,
signal quality, connectivity and component diagnostics **before the first unit
leaves**. The first pilot device may be geographically remote, and flying out to
reset an ESP32 is not a business model. This is the one place worth building
ahead of need.

### Regulatory posture

**Maintain the product's intended use as retail footwear-fit guidance.** Avoid
diagnosis, treatment, prevention and clinical claims in the product, the report,
generated text, marketing and sales conversations.

Human override supports operational control and explainability. It is **not** a
regulatory safe harbor. Whether a product is regulated turns on intended use,
claims, functionality, labeling and context — not on whether a person can press
a different button. Design and speak accordingly, and get qualified regulatory
advice before any claim shifts toward health outcomes.

### Risks

| Risk | Mitigation |
| --- | --- |
| Sensor disagrees with the associate | Log both with provenance. Disagreement is a research asset. |
| Scan adds time to the flow | Scan replaces manual entry; net time must go **down**. Measure it. |
| Hardware failure blocks fittings | The manual path is never removed. |
| Heat map becomes the product | The recommendation and report stay the deliverable; the map is evidence. |
| Derivation algorithm proves wrong | Raw is immutable; reprocess and every past customer benefits. |

---

## 7. Open questions

**Operational (blocking Phase 1):**

1. Which design partner, and what do they stock?
2. Size units — US only, or EU/UK needed?
3. Printer reality at the partner location, or email-only?
4. High-resolution store logos before Day 4?
5. Associate count per location — PINs needed?
6. Which insole line do they actually sell? Every upsell should map to a real SKU.
7. Spanish on the floor?
8. Realistic date a working unit sits on a retail floor?

**Strategic (shape the architecture):**

9. **How does a store identify a customer who refuses to give a phone number?**
   Name + birth year? Loyalty ID? Anonymous-with-printed-report? `identification_method` exists for this, but the operational default is a business decision.
10. **Who owns the fitting record** — retailer, customer, Stride Guide, or a
    defined combination? This belongs in the design-partner agreement before the
    first real fitting, not after. `data_owner_terms_version` records which
    answer applied.
11. **When should a chain grant customer access across its own locations?**
    *Structurally settled:* `location_customer_access` defaults to the creating
    location only, and wider access is an explicit, auditable grant. The
    remaining question is commercial — at what point does a multi-location
    retailer want a customer fitted at one door recognized at another, and does
    the consent wording need to say so before those grants are issued?
12. **What happens when two different retailers fit the same consumer?** Today:
    two unlinked customer records, by design. Linking them is a product and
    consent decision, not an accident to stumble into.
13. **Is MyStrideID intended to become a customer-level identity across
    participating retailers?** *This is the largest question on the page.* If yes,
    a customer becomes a first-class entity above the organization, with their own
    consent, portability and portal — and that shape should be designed now, while
    it costs a schema decision instead of a migration and a renegotiation with
    every retailer. If no, the current org-scoped model is correct and should be
    stated as a deliberate limit.

---

## 8. Definition of done for v1

**Product / UX**

- [ ] A new associate completes a fitting unaided in under 3 minutes
- [ ] A customer leaves with a report that looks worth keeping
- [ ] A returning customer's second fitting starts from their first
- [ ] The owner can see the week's numbers in one glance
- [ ] A wrong recommendation is reportable in two taps and reproducible exactly

**Commercial**

- [ ] Fitting completion rate **80–90%+** in real pilot usage
- [ ] Recommendation overrides captured **with reason**, every time
- [ ] Sale / no-sale outcome recorded on completed fittings
- [ ] Recommended product versus purchased product comparable
- [ ] Return / exchange outcome can later be tied back to the fitting

**Integrity**

- [ ] No cross-tenant data leakage — all six isolation tests passing
- [ ] Raw fitting and scan records versioned, immutable and reproducible
- [ ] The system works when AI services are unavailable
- [ ] The system works when hardware is unavailable
- [ ] Nothing in the product makes a medical claim

---

**Back to:** [Blueprint index](README.md)
