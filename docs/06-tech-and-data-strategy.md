# 06 · Tech Stack & Shoe Data Strategy

Written for one founder, a limited budget, and a hardware deadline measured in
weeks.

> **Revision 2.** WordPress/MyStrideID topology made explicit; catalog split into
> three layers; CSV import priority made conditional on Phase 0 discovery;
> analytics privacy rules added; transactional and marketing communication
> separated. See [00-revision-log](00-revision-log.md).

---

## 0. Platform topology — where WordPress fits

MyStrideID.com is a WordPress property and stays one. It is **the presentation
and CMS layer — not the application database, not the identity provider, and not
the core runtime.**

| Domain | Runs | Owns |
| --- | --- | --- |
| `MyStrideID.com` | WordPress | Marketing, content, SEO, lead capture |
| `app.MyStrideID.com` | Next.js (FitOS) | The fitting application |
| — | Supabase | Auth, Postgres, Storage, RLS, backend services |
| — | Device gateway (later) | Hardware ingest |

A thin WordPress plugin may call documented FitOS APIs — read-only, scoped,
never direct database access. **No fitting logic, no recommendation code, and no
customer fit data in PHP or the WordPress database, ever.**

This is written down because the alternative is predictable: someone reasons
"the site is WordPress, so the app should be a plugin," and eighteen months later
the recommendation engine lives in a theme directory behind an FTP login. The
separation also lets the application scale, deploy and be secured on its own
schedule, which a WordPress host cannot offer.

---

## 1. Recommended MVP stack

| Layer | Choice | Why this one |
| --- | --- | --- |
| **App** | **Next.js (App Router) + TypeScript** | One codebase serves the tablet UI, the report page, and the API. Server components keep the tablet bundle small. The most-documented stack in existence, which matters when you are the only engineer. |
| **UI** | **Tailwind + shadcn/ui**, tokens from [08](08-design-language.md) | Component code you own outright rather than a dependency you fight. Fast to restyle when the design direction shifts — and it will. |
| **Database / auth / storage** | **Supabase** (Postgres, RLS, Auth, Storage) | Real Postgres, not a document store pretending. RLS gives multi-tenancy without an authorization layer. Postgres handles the sensor data later; Firebase would not without a migration. |
| **Hosting** | **Vercel** | Zero-config for Next.js, preview URL per branch — which is how a pilot store sees a fix the same afternoon. |
| **Rules engine** | **Plain TypeScript over a versioned JSON rule file**, in-repo | No dependency, runs on the client, testable in isolation, diffable in review. See [03 §5](03-recommendation-engine.md#5-rule-schema). |
| **Fit report** | **Server-rendered HTML route + print stylesheet** | The report page *is* the print artifact *is* the emailed link. One implementation, three channels. |
| **Email (transactional only)** | **Resend** | Simple API, good deliverability, React email templates. The fit report is a **transactional** message with its own sender identity, templates and suppression list. Retention marketing is a separate subsystem for a later quarter — conflating them now creates a consent and deliverability mess that is tedious to unwind. |
| **Local drafts** | **IndexedDB via Dexie** (or localStorage for v0) | Solves the real failure mode: a fitting lost to store Wi-Fi. |
| **Analytics** | **PostHog**, with an explicit event allowlist | Funnel per screen and time-per-step. **Privacy rules are part of the choice, not an afterthought** — see §4. |
| **Errors** | **Sentry** | A pilot bug you hear about three days later has already cost you the store. |
| **Internal ops** | **Airtable or a Notion board** | Pilot feedback triage, store onboarding checklist, shoe data curation queue. Do **not** build admin screens for yourself. |

**Estimated monthly cost during pilot: $0–40.** Everything above has a free tier
that comfortably covers four stores.

### Explicitly rejected, with reasons

| Tool | Verdict |
| --- | --- |
| **Glide / Softr / Adalo** | Cannot deliver the fit report, the offline draft, or the rules engine. You would rebuild inside a month and lose the data model. |
| **Airtable as the app database** | Excellent as an internal ops board, wrong as a production datastore: rate limits, no RLS, no real relations, and a hard ceiling exactly when the pilot succeeds. |
| **Retool** | Great for internal admin, wrong for a customer-facing floor tool. Consider it later for a support console. |
| **Firebase** | Fine product, wrong shape. Fit data is deeply relational and the sensor future is time-series — both are Postgres problems. |
| **Replit as production host** | Genuinely good for prototyping; use it for a day-one clickable mock if it helps. Not where a pilot store's customer data should live. |
| **Tally / Fillout** | These are forms. The premise of the product is that it is not a form. |
| **A dedicated PDF service** | Print-to-PDF from the report page covers v1. Add server-side PDF only when a store asks for an attachment. |
| **React Native / Expo** | Solves nothing v1 has. Revisit only for BLE hardware pairing. |

## 2. Production stack (post-pilot)

Additive, not a rewrite — every item below bolts onto the same core.

| Need | Addition |
| --- | --- |
| Background jobs (follow-up sends, digests) | Inngest or Trigger.dev |
| SMS follow-up | Twilio + 10DLC registration + separate opt-in |
| PDF attachments | Playwright render of the report route, stored in Supabase Storage |
| Multi-location roles | Supabase RLS policies over the existing `organization → location` hierarchy — no new layer needed, which is the point of settling tenancy on Day 1 |
| Hardware ingestion | Device gateway service (WebSocket/MQTT) → Postgres + object storage for raw frames |
| Rule authoring by non-engineers | Small internal editor over the JSON, behind an admin flag |
| Warehouse / analysis | Postgres read replica → whatever BI tool is cheapest at the time |
| Uptime | Vercel + Supabase paid tiers, daily backups, restore drill actually rehearsed |

**Do not migrate off Supabase because of scale anxiety.** Four stores at 40
fittings a day is roughly 5,000 rows a month. This stack is good to thousands of
stores.

---

## 3. Shoe data strategy

### The strategic point

Manufacturers do not publish usable fit data. There is no reliable public API for
"is this a wide toe box." Anyone who wants shoe-fit intelligence has to build it.
That is not a problem to route around — **it is the moat.** The plan below builds
proprietary data on purpose.

And the deeper asset is not specs at all. Any competitor can eventually assemble
a spec table. What no one else will have is **which recommendations led to which
outcomes for which foot profiles.** That is `outcome`
([05 §16](05-data-model.md#16-outcome)), and it accrues from day one at zero
marginal cost.

### Three layers, never one table

| Layer | Scope | Changes | Owned by |
| --- | --- | --- | --- |
| `product_model` | Global brand knowledge: "Nike Pegasus 43" and its fit characteristics | Slowly, per model year | Stride Guide |
| `product_variant` | The sellable thing: model + gender + size + width + colorway + UPC | Per release | Stride Guide |
| `location_inventory` | This retailer's assortment: stocked, price, SKU, optional quantity | Constantly | The retailer |

Global product knowledge and retailer assortment are different datasets with
different owners and different change rates. Collapsing them would force every
retailer to re-describe the same shoe, prevent knowledge compounding across
retailers, and make a future POS or inventory integration ugly — because the
integration wants to write to exactly one of these layers and nothing else.

**Quantity is optional in v1; assortment is not.** Knowing a location does not
carry a 2E width is what stops a recommendation from embarrassing an associate.
Knowing there are three pairs left is a later nicety.

### Phases

| Phase | What | When | Effort |
| --- | --- | --- | --- |
| **1 · Curated core** | Hand-build ~120 models actually on the design partner's wall. Characteristics from spec sheets, hands-on inspection, and the partner's own staff. | Now | 6–10 hours, one time |
| **2 · Retailer import** | Assortment CSV → auto-match to `product_model`/`product_variant` → one-tap create for unmatched rows. | **Conditional — see below** | 1 day |
| **3 · Associate enrichment** | Correct or add a characteristic in two taps from the recommendation screen ("this one runs narrow"). Queued for review. **This is how the database gets good** — the people handling shoes all day are the best annotators available. | Week 4+ | 1 day |
| **4 · Outcome weighting** | Rank by observed fit success for similar profiles, not spec match alone. Now the catalog is genuinely proprietary. | ~2,000 fittings | Ongoing |
| **5 · Manufacturer feeds** | Only where a brand offers a real feed, and only as one input ranked below hands-on data. | Opportunistic | Varies |

**Never make the product depend on an external catalog API.** Recommendations
must render with an empty catalog — the fit profile alone is useful, and that
independence is what prevents being disintermediated by a data vendor.

### CSV import priority is decided in Phase 0, not assumed

Phase 0 discovery fact #2 is *inventory source and format*
([09 §2](09-build-plan.md#2-phase-0--discovery)). It settles this directly:

| Discovery finding | Day 6 priority |
| --- | --- |
| Partner can export inventory (any messy format) | **CSV import is priority #1.** Hand-seeding 1,000 SKUs is not a plan, and an importer that works once works for every retailer after. |
| Partner cannot export, or carries a small curated wall | Manual seed of ~120 models is fine; defer the importer. |

Minimum viable columns:

```
brand, model, variant, category, widths_stocked, size_low, size_high, sku, retail_price
```

Everything else is enrichment. **Do not require a clean spreadsheet.** Retailers
export messy data from old POS systems; the importer tolerates it or it goes
unused.

### Data quality rules

- Every `product_model` carries `data_source`, `verified_at` and
  `catalog_version`. Curated and hands-on-verified data outranks imported data
  in matching, and `catalog_version` is stamped on every recommendation so a
  past match can be reproduced.
- Fit characteristics use the **same vocabulary as recommendations**
  ([03 §2](03-recommendation-engine.md#2-output-vocabulary)). Matching is
  comparison, not translation — a small decision that eliminates a whole class
  of bugs.
- `removable_insole` and stocked widths are effectively required: they are the
  two fields that most often make a recommendation wrong in practice.

---

## 4. Analytics and error reporting — privacy rules

Sentry and PostHog are the right tools and the wrong default configuration. Both
happily hoover up whatever is on screen.

**Emit an explicit event allowlist, nothing else:**

```
assessment_started · assessment_completed · recommendation_viewed
recommendation_overridden · report_generated · report_sent
fitting_completed · fitting_voided · feedback_submitted
```

Each payload carries IDs and enums only — `fitting_session_id`,
`organization_id`, `location_id`, `evidence_strength`, `override_reason`,
durations, counts.

**Never leaves the application boundary:** names, phone numbers (in any form),
email addresses, assessment notes, intake notes, report URLs or tokens, pressure
matrices, scan imagery.

- Session replay: **off**, or on with aggressive masking over every customer
  field and the entire report view. A replay of a fitting is a recording of a
  named person's foot data.
- Sentry: scrub request bodies, deny-list the customer and assessment routes'
  payloads, and never attach form state to an exception.
- The same rule applies to any future LLM call: send the fit profile, not the
  person.

---

---

**Next:** [07 · AI Agent Roadmap](07-ai-roadmap.md)
