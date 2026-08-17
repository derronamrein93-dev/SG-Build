# 06 · Tech Stack & Shoe Data Strategy

Written for one founder, a limited budget, and a hardware deadline measured in
weeks.

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
| **Email** | **Resend** | Simple API, good deliverability, React email templates. |
| **Local drafts** | **IndexedDB via Dexie** (or localStorage for v0) | Solves the real failure mode: a fitting lost to store Wi-Fi. |
| **Analytics** | **PostHog** | Funnel per screen and time-per-step, which is how you defend the 3-minute budget with data. |
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
| Multi-store roles | Supabase RLS policies + an org layer above `store` |
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
outcomes for which foot profiles.** That is `fit_outcome`
([05 §10](05-data-model.md#10-fit_outcome-added)), and it accrues from day one at
zero marginal cost.

### Phases

| Phase | What | When | Effort |
| --- | --- | --- | --- |
| **1 · Curated core** | Hand-build ~120 models — the shoes actually on the pilot stores' walls. Fill fit characteristics from spec sheets, hands-on inspection, and the store's own staff. | Now | 6–10 hours, one time |
| **2 · Store CSV import** | Each store uploads its assortment; a mapping screen reconciles rows to canonical `shoe_model` records, creating new ones where needed. | Week 2–3 | 1 day |
| **3 · Associate enrichment** | An associate can correct or add a characteristic in two taps from the recommendation screen ("this one runs narrow"). Corrections queue for review. **This is how the database gets good** — the people handling the shoes all day are the best possible annotators. | Week 4+ | 1 day |
| **4 · Outcome weighting** | Rank products by observed fit success for similar profiles, not just spec match. Now the catalog is genuinely proprietary. | ~2,000 fittings | Ongoing |
| **5 · Manufacturer feeds** | Only where a brand offers a real feed, and only as one input ranked below hands-on data. | Opportunistic | Varies |

**Never make the product depend on an external catalog API.** Recommendations
must render with an empty catalog — the fit profile alone is useful, and that
independence is what keeps you from being disintermediated by a data vendor.

### CSV import spec (phase 2)

Minimum viable columns a store must provide:

```
brand, model, variant, category, widths_stocked, size_low, size_high, sku, retail_price
```

Everything else is enrichment. Import flow: upload → auto-match against
`shoe_model` by brand+model fuzzy match → show unmatched rows for one-tap
"create new model" → done. **Do not require a clean spreadsheet.** Stores export
messy data from ancient POS systems; the importer must tolerate it or it will not
be used.

### Data quality rules

- Every `shoe_model` carries `data_source` and `verified_at`. Curated and
  hands-on-verified data outranks imported data in matching.
- Fit characteristics use the **same vocabulary as recommendations**
  ([03 §2](03-recommendation-engine.md#2-output-vocabulary)). Matching is then a
  direct comparison rather than a translation layer — a small decision that
  saves an entire category of bugs.
- `removable_insole` and `widths_stocked` are effectively required: they are the
  two fields that most often make a recommendation wrong in practice.

---

**Next:** [07 · AI Agent Roadmap](07-ai-roadmap.md)
