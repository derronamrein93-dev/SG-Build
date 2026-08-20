# Deploying FitOS

Three things in this directory: a generated schema bundle, the decision you have
to make before you can use it, and the environment checklist.

| | |
| --- | --- |
| `schema-bundle.sql` | Migrations 0001–0010 in order, in one transaction. **Generated** — `npm run deploy:bundle`. |
| `build-bundle.sh` / `check-bundle.sh` | Regenerate / fail if stale. `npm run verify` runs the check. |
| this file | The role-model decision, and the env vars. |

Verified: the bundle applies to an empty database and produces **29 tables, 23
with forced RLS, 23 policies, 49 functions**. Its preflight refuses to run if
`fitos_svc` lacks `BYPASSRLS` or if `fitos_app` has it — both tested by
temporarily flipping the roles.

---

## The decision: two roles, one of which needs BYPASSRLS

FitOS does not use a service key and filter in application code. It uses two
Postgres roles:

```sql
create role fitos_app nologin;              -- every request. RLS applies.
create role fitos_svc nologin bypassrls;    -- seeding, identity resolution, the public report path
```

`withTenant` opens a transaction, does `set local role fitos_app`, and sets the
tenant GUCs the 23 policies read. `withService` does `set local role fitos_svc`.
15 grants target the first, 14 the second.

**`CREATE ROLE … BYPASSRLS` requires superuser, and Supabase's `postgres` role
is not one.** That is the whole problem. Three ways out, with what each actually
costs.

---

### Option A — Postgres with superuser (Neon, Fly, RDS, a VM)

**Deploy as built.** Run `bootstrap_roles.sql` once, then the bundle, then seed.

| | |
| --- | --- |
| Effort | ~2 hours, most of it provisioning |
| Code changes | **None** |
| Security model | Unchanged. The isolation suite keeps testing the thing that runs. |
| Cost | You manage a database. Backups, upgrades, connection limits are yours. Roughly $20–30/mo at pilot size. |
| Risk | Lowest. Nothing about the security model is re-derived under deadline. |

Neon is the closest fit: real Postgres, superuser on your own project, branching,
generous free tier. Supabase's other features (Auth, Storage, Realtime) are not
used by FitOS today.

**Recommended.** The role split is load-bearing — it is what makes
`app_merge_customer` service-only, what makes `report_view_orphan_audit()` refuse
to under-report, and what the 23 isolation assertions actually assert. Porting it
under deadline is how a tenancy boundary quietly becomes a convention.

---

### Option B — Supabase, mapping onto its existing roles

Supabase ships `authenticated`, `anon`, `service_role`. `service_role` already
bypasses RLS; `authenticated` does not. So the *shape* exists.

| | |
| --- | --- |
| Effort | 1–2 days, plus a re-audit |
| Code changes | Every `grant … to fitos_app/fitos_svc` re-targeted; `set local role` changed; `bootstrap_roles.sql` retired |
| Security model | Similar in shape, different in detail |
| Cost | Free tier covers the pilot. Auth and Storage come along for later. |
| Risk | **Moderate, and the risk is invisible.** |

The specific hazard: FitOS connects over the pooler with a single credential and
switches role per transaction. Supabase's model assumes a PostgREST request
carrying a JWT, with the role derived from it. If the app connects *as*
`service_role` and calls `set local role authenticated`, that works — but any
query that escapes `withTenant` runs with `service_role`'s bypass, and **the
isolation suite would still pass, because it tests the database rather than the
client.** That is exactly the failure mode `createCustomer` had, one layer up.

If you take this route, the mitigation is to re-point `mutations.test.ts` at the
hosted database and run it against the real connection string. It is the suite
that catches privilege drift.

---

### Option C — Supabase, no BYPASSRLS at all

Drop `fitos_svc`; give the service path a role that owns the tables and use
`security definer` functions for the few operations that need to see across
locations.

| | |
| --- | --- |
| Effort | 3–5 days |
| Code changes | Substantial: seeding, `loadReportByToken`, merge, the orphan audit |
| Security model | **Materially different** |
| Risk | **Highest.** |

The blocker is `FORCE ROW LEVEL SECURITY`, which applies to the table owner too —
that is deliberate, and it is why owner-run checks under-report. Every service
operation becomes a `security definer` function, and each one is a new place to
get the tenant predicate wrong. Two of the bugs found in the last week were
exactly that shape.

Only worth it if you must be on Supabase *and* cannot have `BYPASSRLS`.

---

### Recommendation

**Option A now, revisit Supabase when there is a reason to.** Nothing in FitOS
uses Supabase's differentiators yet. The moment there is a real reason — Auth
when you add real logins, Storage when the pressure platform starts writing raw
frames — that is a considered migration with tests, not a deployment-day
scramble.

Whatever you pick, `npm run e2e` against the hosted URL (`E2E_BASE=…`) before the
pilot touches it. It is 27 checks and about thirty seconds.

---

## Deploy runbook

Assumes Option A. Steps 2–5 are the whole thing; the rest is Vercel.

1. **Provision Postgres 16+** and get a superuser connection.
2. **Roles, once:** `psql "$ADMIN_URL" -f db/bootstrap_roles.sql`
3. **Schema:** `psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/schema-bundle.sql`
   One transaction — a failure rolls the whole thing back and you re-run from the
   top.
4. **Grant role membership to the owner**, so the seed can switch into the
   service role — `db/reset.sh` does this locally and it is easy to miss here.
   The deploy rehearsal failed on exactly this step:
   ```bash
   psql "$ADMIN_URL" -c 'grant fitos_app, fitos_svc to <owner-role>'
   ```
5. **Seed**, with the *final* secrets already set:
   ```bash
   FITOS_ORG_HASH_SECRET=… FITOS_IDENTITY_SECRET=… PG… npx tsx db/seed.ts
   ```
   **Set the real peppers before seeding, not after.** Changing either one later
   makes every stored `phone_lookup_hash` unmatchable — the seeded returning
   customer stops being findable, and on a database with real fittings that is a
   rotation, not a re-seed. See docs/05 "Identity peppers".
6. **Vercel project**, root directory `fitos`, the env vars below.
7. **Verify against the deployed URL:**
   ```bash
   E2E_BASE=https://… npm run e2e
   ```
8. Only then hand the link to the pilot.

---

## Environment variables

All seven are required. The app **refuses to start hashing** without the two
peppers — deliberately, because the previous default was a value published in
this repository.

| Variable | Where | Notes |
| --- | --- | --- |
| `PGHOST` | Vercel | database host |
| `PGPORT` | Vercel | `5432`, or the pooler port |
| `PGUSER` | Vercel | the **application** role, not the owner |
| `PGPASSWORD` | Vercel | |
| `PGDATABASE` | Vercel | |
| `FITOS_ORG_HASH_SECRET` | Vercel | `openssl rand -base64 48`. Per-organization contact hashing. |
| `FITOS_IDENTITY_SECRET` | Vercel | a **different** value, same command. Global identity resolution. |

Both peppers must be ≥32 characters and are rejected if set to any known
placeholder. `.env.example` carries the full annotated list; `dev.env` holds the
local development values and is **not** for anything real.

**Store the two peppers somewhere you will still have them in a year.** They are
not derivable from the database. Losing them means every phone lookup stops
working, permanently.

### Not required, and deliberately absent

No API keys, no analytics key, no email provider. `src/lib/analytics.ts` logs to
the server and sends nothing anywhere. Wiring PostHog is a later decision with
its own privacy rules already written down in docs/06 §4.

---

## After deploying, before the pilot

- [ ] `E2E_BASE=… npm run e2e` — 27/27
- [ ] Look up `612-555-4417` on the hosted app; Marisol Alvarez appears
- [ ] Walk one new customer end to end; the report link opens in a private window
- [ ] Confirm a bogus token 404s
- [ ] Confirm the peppers are recorded somewhere durable
