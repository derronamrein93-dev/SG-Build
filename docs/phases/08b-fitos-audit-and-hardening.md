# Phase 8B (revised) — FitOS Audit and Hardening

**Status: proposal. No migration in this document has been run. No production
data has been touched. Phase 8C is not started.**

## Premise change

The original 8B assumed a greenfield tenancy build on top of a Python
lead-intelligence pipeline. That premise is retired. **FitOS is the platform
spine.** Tenancy, identity, customers, consent and RLS already exist, are
migrated, and are covered by a passing isolation suite. This phase audits what
is there, names only genuine gaps, and proposes migrations for review.

The lead engine stays separate operator infrastructure. It is not given
`organization_id`, it is not backfilled here, and it is not consolidated into
the product. That belongs to its own survey/export task.

---

## 1 · Audit — the existing spine, verified

Everything below was checked against the live schema on 2026-08-19, not read
from a design document. Counts come from `pg_class` and `pg_policies`.

| Required by 8B | Present in FitOS | Verified how |
| --- | --- | --- |
| organizations | `organization` | 28 tables in `public` |
| locations | `location` | |
| users, user↔location access | `app_user`, `user_location` | |
| customers | `organization_customer` | retailer-scoped relationship |
| location authorization | `location_customer_access` | grant table, not an FK column |
| consents | `consent_record` | 7 consent types, 5 capture methods, 2 scopes |
| identity matching layer | `phone_lookup_hash` (bytea) | per-org HMAC-SHA256 |
| encrypted contact, stored separately | `phone_encrypted`, `phone_last4` | separate columns from the hash |
| key version on every identifier | `phone_key_version` | written on every insert incl. seed |
| forced RLS | 21 tables `enable` + **`force`** | `relrowsecurity` and `relforcerowsecurity` both true |
| RLS policies | 19 policies | `pg_policies` |
| app role without BYPASSRLS | `fitos_app` — `nologin`, no bypassrls | `db/bootstrap_roles.sql` |

**The connection model, stated explicitly** (8B requires this be named):

FitOS does **not** use a service-role-for-everything model. The pool connects as
`PGUSER`, and every request opens a transaction that does `set local role
fitos_app` and sets three GUCs — `app.organization_id`, `app.location_id`,
`app.bypass_location_scope` — which the policies read. `fitos_app` has no
`BYPASSRLS`, so RLS is the enforcement mechanism, not a convention call sites
have to remember.

`fitos_svc` **does** carry `BYPASSRLS` and is used by seeding, tests, and one
production path (see gap 8B-5).

**Isolation model to preserve.** `db/test/isolation.sql` — 10 assertions,
including cross-org read/update/enumerate denial, report non-walkability,
sibling-location denial without a grant, and grant-makes-visible. Plus 65 unit
tests. These are an asset. Nothing proposed here replaces them; every proposal
below adds tests alongside.

---

## 2 · Not duplicating

No proposal in this document creates `organizations`, `locations`, `users`,
`customers`, `customer_identifiers`, or `consents`. Those exist. The original
8B's table list is satisfied by the schema already migrated, under FitOS names.

One naming decision: the original doc says `audit_logs`. FitOS uses singular
table names throughout (`consent_record`, `fitting_session`, `report_view`), so
the proposal below is **`audit_log`**. Consistency inside one schema is worth
more than fidelity to the phase doc's pluralisation.

---

## 3 · Genuine gaps

Six. Each carries reason, exact SQL, rollback, tests, RLS impact, risk, and
demo-flow effect.

---

### 8B-1 · `audit_log` table and write path

**Reason.** CLAUDE.md requires an audit trail capturing actor, action, object
type and id, timestamp, and `organization_id`. Nothing in FitOS writes one
today. It is also a precondition for gap 8B-3: a merge that is not audited is
not reconstructible.

**Migration** — `db/migrations/0005_audit_log.sql`

```sql
create type audit_action as enum (
  'customer_created', 'customer_updated',
  'identity_merged',  'identity_merge_reversed',
  'consent_captured', 'consent_withdrawn',
  'data_deleted');

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id) on delete cascade,
  location_id     uuid,
  actor_user_id   uuid,
  actor_kind      text not null default 'user'
                    check (actor_kind in ('user', 'service', 'system')),
  action          audit_action not null,
  object_type     text not null,
  object_id       uuid not null,
  detail          jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

create index audit_log_org_time on audit_log (organization_id, occurred_at desc);
create index audit_log_object   on audit_log (object_type, object_id);

alter table audit_log enable row level security;
alter table audit_log force  row level security;
create policy tenant_isolation on audit_log
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());

-- Append-only by grant: no update, no delete, for any application role.
grant select, insert on audit_log to fitos_app, fitos_svc;
```

**Two deliberate deviations from house style, both load-bearing:**

- `location_id` and `actor_user_id` carry **no foreign key**. Every other table
  here uses FKs, but an audit row must survive the deletion of the user or
  location it names. An `on delete set null` would erase the actor from the
  record of their own action — the one thing the table exists to remember.
- `organization_id` **does** keep `on delete cascade`, so tenant offboarding
  removes the audit trail with the tenant. That is deliberate; flag it if you
  want audit to outlive the tenant, because that is a retention-policy decision,
  not a schema one.

**Write path** — `src/lib/db/audit.ts`, one function, called inside the caller's
existing transaction so the audit row commits or rolls back with the thing it
describes:

```ts
export async function writeAudit(c: PoolClient, entry: {
  organizationId: string; locationId?: string; actorUserId?: string;
  actorKind?: 'user' | 'service' | 'system';
  action: AuditAction; objectType: string; objectId: string;
  detail?: Record<string, unknown>;
}): Promise<void>
```

Call sites in this phase: customer creation, consent capture. Later phases add
their own. **`detail` carries identifiers and enums only — never a raw phone,
email, name, or secret** (CLAUDE.md: "Log identifiers, not people").

**Rollback.** `drop table audit_log; drop type audit_action;` — no other object
depends on either.

**Tests.** A01 update denied · A02 delete denied · A03 org A cannot read org B's
rows · A04 customer creation writes exactly one `customer_created` · A05 consent
capture writes `consent_captured` · A06 `detail` contains no raw phone digits
for a customer created with a phone number.

**RLS impact.** New table, tenant-isolated on `organization_id`, consistent with
the 21 existing forced tables. No existing policy changes.

**Risk: low.** Additive.

**Demo flows: minor.** Adds one insert to customer creation and one to consent
capture. No user-visible change. Re-seed not required.

---

### 8B-2 · Consent enforcement chokepoint

**Reason.** Consent is *captured* — `queries.ts:69` refuses to create a customer
without it, and writes a `consent_record`. Consent is never *read*. There is no
`has_consent` anywhere in the codebase. 8B is right that the chokepoint must
exist before the first thing that sends a message, not alongside it.

Note the model already handles withdrawal correctly: `consent_record` has no
`revoked_at` and no update grant. Withdrawal is a **new row** with
`granted = false`. So the question "does consent hold?" is always "what does the
most recent row say?"

**Migration** — `db/migrations/0006_consent_chokepoint.sql`

```sql
create or replace function app_has_consent(customer uuid, want consent_type)
returns boolean as $$
  select coalesce((
    select granted
      from consent_record
     where organization_customer_id = customer
       and type = want
     order by captured_at desc
     limit 1
  ), false)
$$ language sql stable;
```

**Not `security definer`, deliberately.** The function runs under the caller's
RLS, so a tenant can only evaluate consent for customers it can already see.
A definer function here would become a cross-tenant oracle: ask about any
customer id and learn whether it exists.

**TypeScript wrapper** — `src/lib/consent.ts`, exporting
`hasConsent(c, customerId, type)`. The rule to enforce in review from now on:
**communication code calls `hasConsent` or it does not ship.** No inline
consent queries anywhere else.

**Rollback.** `drop function app_has_consent(uuid, consent_type);`

**Tests.** C01 no record → false · C02 granted → true · C03 granted then
withdrawn → false · C04 withdrawn then re-granted → true · C05 another
organization's customer → false, via RLS rather than a code check · C06 unknown
customer id → false, not an error.

**RLS impact.** None. The function inherits caller policies by design.

**Risk: low.** Nothing calls it yet; it is the seam later phases must use.

**Demo flows: none.** Purely additive.

---

### 8B-3 · Identity merge workflow

**Reason.** Two records for the same person is the normal end state of a phone
mistyped once. There is no merge path. 8B requires merges be reversible or
fully reconstructible from the audit log — which is why 8B-1 lands first.

Six tables reference `organization_customer` and all six must move:
`identity_resolution`, `location_customer_access`, `consent_record`,
`fitting_session`, `report`, `follow_up`.

**Migration** — `db/migrations/0007_identity_merge.sql`

```sql
alter table organization_customer
  add column merged_into_customer_id uuid references organization_customer(id),
  add column merged_at               timestamptz;

alter table organization_customer
  add constraint organization_customer_merge_consistent
    check ((merged_into_customer_id is null) = (merged_at is null)),
  add constraint organization_customer_no_self_merge
    check (merged_into_customer_id is null or merged_into_customer_id <> id);

create index organization_customer_merged
  on organization_customer (merged_into_customer_id)
  where merged_into_customer_id is not null;
```

The merge itself is a service operation, not something a tablet can trigger:

```sql
create or replace function app_merge_customer(loser uuid, winner uuid, actor uuid)
returns jsonb as $$
declare
  org_loser  uuid;
  org_winner uuid;
  moved      jsonb;
begin
  if loser = winner then
    raise exception 'cannot merge a customer into itself';
  end if;

  select organization_id into org_loser  from organization_customer where id = loser;
  select organization_id into org_winner from organization_customer where id = winner;

  if org_loser is null or org_winner is null then
    raise exception 'both customers must exist';
  end if;
  if org_loser <> org_winner then
    raise exception 'refusing to merge customers across organizations';
  end if;

  -- Record what moved BEFORE moving it, so the audit row can rebuild the split.
  select jsonb_build_object(
    'fitting_session',         (select coalesce(jsonb_agg(id), '[]'::jsonb) from fitting_session         where organization_customer_id = loser),
    'report',                  (select coalesce(jsonb_agg(id), '[]'::jsonb) from report                  where organization_customer_id = loser),
    'follow_up',               (select coalesce(jsonb_agg(id), '[]'::jsonb) from follow_up               where organization_customer_id = loser),
    'consent_record',          (select coalesce(jsonb_agg(id), '[]'::jsonb) from consent_record          where organization_customer_id = loser),
    'location_customer_access',(select coalesce(jsonb_agg(id), '[]'::jsonb) from location_customer_access where organization_customer_id = loser),
    'identity_resolution',     (select coalesce(jsonb_agg(id), '[]'::jsonb) from identity_resolution     where organization_customer_id = loser)
  ) into moved;

  update fitting_session          set organization_customer_id = winner where organization_customer_id = loser;
  update report                   set organization_customer_id = winner where organization_customer_id = loser;
  update follow_up                set organization_customer_id = winner where organization_customer_id = loser;
  update consent_record           set organization_customer_id = winner where organization_customer_id = loser;
  update location_customer_access set organization_customer_id = winner where organization_customer_id = loser;
  update identity_resolution      set organization_customer_id = winner where organization_customer_id = loser;

  update organization_customer
     set merged_into_customer_id = winner, merged_at = now()
   where id = loser;

  insert into audit_log (organization_id, actor_user_id, actor_kind, action,
                         object_type, object_id, detail)
  values (org_winner, actor, 'user', 'identity_merged',
          'organization_customer', winner,
          jsonb_build_object('merged_from', loser, 'moved', moved));

  return moved;
end $$ language plpgsql;
```

**Reversibility.** The loser row is never deleted — it keeps its identifiers and
gains a pointer. The audit row lists every id that moved. A reversal replays
those lists in the other direction and writes `identity_merge_reversed`.

**Rollback.**

```sql
drop function app_merge_customer(uuid, uuid, uuid);
alter table organization_customer
  drop constraint organization_customer_no_self_merge,
  drop constraint organization_customer_merge_consistent,
  drop column merged_at,
  drop column merged_into_customer_id;
drop index if exists organization_customer_merged;
```

Safe only while no merge has been performed. **Once a merge exists, dropping
these columns destroys the record of it** — reverse the merges first, then roll
back.

**Tests.** M01 merge moves all six reference types · M02 both identifier sets
survive · M03 cross-organization merge raises · M04 self-merge raises · M05
audit row lists every moved id · M06 reversal restores the original split
exactly · M07 customer lookup returns the winner when given the loser's phone ·
M08 merged customers do not appear twice in search.

**RLS impact.** Policies unchanged, but the *hole is in the application*: the
function is plpgsql and runs with the caller's privileges, so `fitos_app` could
call it. It should be reachable only through `withService`. **Recommend
`revoke execute on function app_merge_customer from fitos_app;`** — included
above as a review question rather than assumed.

**Risk: medium-high.** This is the only proposal that mutates existing rows.
M07 and M08 are the reason: every customer-lookup path must now follow
`merged_into_customer_id`, or a merged customer is found under a stale record
and the fitting attaches to the wrong history. That is a real behavior change in
`queries.ts`, not just a schema addition.

**Demo flows: yes, if a merge is performed.** No effect until one is. Customer
search must be updated in the same change, or the seeded returning customer
could be found under a merged-away record.

---

### 8B-4 · Fail fast on missing HMAC secrets

**Reason.** `src/lib/db/identity.ts:13-14`:

```ts
const ORG_KEY_SECRET       = process.env.FITOS_ORG_HASH_SECRET ?? 'dev-only-org-secret';
const GLOBAL_IDENTITY_SECRET = process.env.FITOS_IDENTITY_SECRET ?? 'dev-only-identity-secret';
```

CLAUDE.md: the pepper is *"never logged, never defaulted to a hard-coded value,
never committed."* A deployment that forgets these variables gets a working
application with a publicly-known HMAC key and no symptom at all. This is the
highest-severity item in the audit, and it is the one that is not a migration.

**Change** — `src/lib/db/identity.ts`, no schema change:

```ts
function requireSecret(name: string): string {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (value) throw new Error(`${name} is set but shorter than 32 characters.`);
  if (process.env.FITOS_ALLOW_DEV_SECRETS === '1') return `dev-only:${name}`;
  throw new Error(
    `${name} is not set. Generate one with: openssl rand -base64 48\n` +
    `For local development only: FITOS_ALLOW_DEV_SECRETS=1`);
}
```

An explicit opt-in rather than a `NODE_ENV` check: `NODE_ENV` is wrong by
accident more often than it is right, and a staging box running with
`NODE_ENV=development` is exactly where this bites.

**Rollback.** Revert the file. No data implication *provided the secret values
have not changed* — see below.

**Tests.** S01 missing secret throws · S02 short secret throws · S03 opt-in flag
yields a deterministic dev value · S04 the dev value differs from the previous
hard-coded literal (so old dev hashes are not silently accepted as valid) · S05
the error message contains no secret value.

**RLS impact.** None.

**Risk: medium — and the risk is not in the code.**

> **Changing the *value* of `FITOS_ORG_HASH_SECRET` invalidates every
> `phone_lookup_hash` already stored.** Existing customers become unfindable by
> phone. The seeded returning customer used in the Day 5 usability script
> (Card B, 612-555-4417) would not be found, and the returning-customer path —
> the most persuasive thing in the demo — silently fails.

Two ways through, and the choice is yours:

1. **Re-seed.** `bash db/reset.sh` after setting the real secrets. Correct for a
   demo database, unacceptable for anything with real fittings in it.
2. **Rotate properly.** This is what `phone_key_version` is for, and it works
   because `phone_encrypted` retains the E.164: decrypt → re-HMAC under the new
   key → write `phone_key_version = 2`. A rotation script belongs in this phase
   only if you intend to set real secrets against a database that already holds
   fittings you care about.

**Demo flows: yes, unavoidably.** `db/reset.sh`, `fitos/README.md` and a
`.env.example` must be updated in the same change, or `npm run test` fails on a
clean checkout with an unhelpful error.

---

### 8B-5 · Connection model documentation, and one false invariant

**Reason.** 8B requires the connection model be stated explicitly. Section 1
does that. But the audit turned up a comment that is no longer true, and a stale
invariant in a security-relevant file is worse than no comment.

`src/lib/db/client.ts:50`:

```ts
/** Service role: seeding, jobs, identity resolution. Never reachable from a page. */
export async function withService<T>(...)
```

**"Never reachable from a page" is false.** `src/lib/reports.ts:21`
(`loadReportByToken`) calls `withService`, and it is reached by the public route
`/r/[token]`. That is *correct design* — a customer opening a report link has no
tenant context, so RLS cannot be the authorization mechanism and the token hash
is — but it means one production path runs with `BYPASSRLS`.

**Change.** No migration. Correct the comment to state the real invariant, and
document the constraint that makes the path safe:

> `withService` runs as `fitos_svc`, which has `BYPASSRLS`. One production path
> uses it: `loadReportByToken`, where the SHA-256 token match *is* the
> authorization and no tenant context exists. Any query inside that path must be
> keyed by the token hash alone. It must never accept a caller-supplied
> identifier as a filter, because RLS is not there to catch the mistake.

Add to `docs/05-data-model.md` a short "connection model" section covering the
`set local role` mechanism, the GUCs, and what changes if FitOS moves to
Supabase: **the role-switching must be preserved.** A Supabase client using the
service-role key for application queries would bypass all 19 policies at once,
and the isolation suite would still pass, because it tests the database rather
than the client.

**Rollback.** Documentation only.

**Tests.** No new tests. P09 in `token.test.ts` already asserts reports do not
leak across organizations.

**Risk: low.** **Demo flows: none.**

---

### 8B-6 · RLS review against the real connection assumptions

**Reason.** 21 of 28 tables have forced RLS. The audit asks what the other seven
are, and whether every existing policy is as tight as it reads.

**Seven tables without RLS:**

| Table | Verdict |
| --- | --- |
| `product_model`, `product_variant`, `feature_schema_version` | **Correct.** Global catalog and schema registry, shared across tenants by design. |
| `device`, `device_health_event` | **Defer to 8C.** Unused today. 8C introduces tenant-scoped devices and should add RLS with the columns it adds. |
| `user_location` | **Gap.** Reveals which staff cover which locations across tenant boundaries. |
| `report_view` | **Gap.** The report access log. Reveals viewing patterns; also has no `organization_id`. |

**And one hole in an existing policy.** `consent_record`:

```sql
using (organization_customer_id is null or exists (...))
```

The `is null or` escape means a **person-scoped consent row is visible to every
tenant**. Person-scoped rows carry `person_identity_id`, and the app role is
otherwise forbidden from reading `person_identity` entirely — so this is a
narrow leak of exactly the thing the identity architecture is designed to keep
separate. Nothing writes person-scoped consent yet, which is why the isolation
suite does not catch it.

**Migration** — `db/migrations/0008_rls_review.sql`

```sql
-- (a) close the person-scope escape in consent_record
drop policy tenant_isolation on consent_record;
create policy tenant_isolation on consent_record
  using (organization_customer_id is not null and exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id
             and c.organization_id = app_current_org()))
  with check (organization_customer_id is not null and exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id
             and c.organization_id = app_current_org()));

-- (b) user_location, scoped through its location
alter table user_location enable row level security;
alter table user_location force  row level security;
create policy tenant_isolation on user_location
  using (exists (select 1 from location l
                  where l.id = location_id and l.organization_id = app_current_org()))
  with check (exists (select 1 from location l
                       where l.id = location_id and l.organization_id = app_current_org()));
grant select on user_location to fitos_app, fitos_svc;

-- (c) report_view: denormalize organization_id, then scope it.
--     Denormalized rather than joined, matching the decision already made for
--     location_customer_access, where a joined policy recursed.
alter table report_view add column organization_id uuid references organization(id) on delete cascade;

update report_view rv
   set organization_id = s.organization_id
  from report r
  join fitting_session s on s.id = r.fitting_session_id
 where r.id = rv.report_id;

-- Orphan sweep. Any row that did not resolve is an access-log entry whose
-- report no longer exists. Delete rather than invent a tenant: a view that
-- cannot be attributed to an organization cannot be shown to one either.
delete from report_view where organization_id is null;

alter table report_view alter column organization_id set not null;

alter table report_view enable row level security;
alter table report_view force  row level security;
create policy tenant_isolation on report_view
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());
grant select, insert on report_view to fitos_app, fitos_svc;
```

**Run this first, and read the number.** The orphan sweep above is not
hypothetical — it was added after a syntax check on the development database
failed at `set not null`, with two `report_view` rows whose `report_id` matches
no surviving report. Their provenance is not established; the most likely cause
is a partial manual cleanup during an earlier build phase. Before applying 0008
anywhere, count them:

```sql
select count(*) from report_view rv
  left join report r on r.id = rv.report_id
 where r.id is null;
```

Zero means the sweep is a no-op. A non-trivial number on a database with real
fittings means something deletes reports without their access log, and **that
should be understood before it is swept away** — an access log that loses rows
silently is worth more attention than the migration it is blocking.

**Companion code change.** `loadReportByToken` inserts the `report_view` row and
must now populate `organization_id`. It runs as `fitos_svc` (`BYPASSRLS`), so
the insert will not be blocked by the new policy — but it *will* fail the
`not null` constraint if not updated. **These two changes must land together.**

**Rollback.**

```sql
-- (c)
drop policy tenant_isolation on report_view;
alter table report_view disable row level security;
alter table report_view drop column organization_id;
-- (b)
drop policy tenant_isolation on user_location;
alter table user_location disable row level security;
-- (a) restore the previous, looser consent policy
drop policy tenant_isolation on consent_record;
create policy tenant_isolation on consent_record
  using (organization_customer_id is null or exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id
             and c.organization_id = app_current_org()))
  with check (organization_customer_id is null or exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id
             and c.organization_id = app_current_org()));
```

**Tests.** Extend `db/test/isolation.sql` from 10 assertions to 14:
R11 org A cannot read org B's `report_view` rows · R12 org A cannot read org B's
`user_location` rows · R13 a person-scoped `consent_record` is invisible to
every tenant · R14 `loadReportByToken` still logs a view and P08 still passes · R15 the
orphan count is zero after migration.

**RLS impact.** This is the only proposal that changes an existing policy.
Coverage goes from 21 forced tables to 23, and one policy gets strictly tighter.

**Risk: medium.** (a) is safe today because nothing writes person-scoped consent
— verified: both `queries.ts` and `db/seed.ts` write `scope = 'organization'`
with `organization_customer_id` set. If that ever changes, this policy makes
those rows unreadable, which is the intended behavior but would look like a bug.
(c) adds a `not null` column to a table the public report path writes on every
view, and deletes unattributable rows from an access log — irreversible, which
is why the count above is a required pre-flight rather than a suggestion.

**Demo flows: yes.** A stale `loadReportByToken` against migration 0008 breaks
every public report view with a constraint violation. Land them together, and
re-run the browser walk before demoing.

---

## 4 · What we are intentionally not changing

- **No new tenancy spine.** `organization → location → app_user →
  organization_customer → fitting_session` stands as built.
- **No table duplication.** No `organizations`, `customers`,
  `customer_identifiers`, or `consents` alongside the existing tables.
- **No FastAPI service.** 8C's own text permits this: *"use FastAPI unless the
  existing architecture gives a concrete reason not to."* The reason is a
  working, tested Next.js application with no Python runtime; adding one means
  two services, two deploys and two auth surfaces for one engineer. Revisit only
  for pressure-matrix derivation, which is a service behind the ingestion
  endpoint, not a reason to rewrite tenancy in a second language.
- **No product rewrite.** The fitting flow, rules engine, language layer and
  report are untouched.
- **No lead-engine consolidation.** No `organization_id` on lead data, no
  backfill, no move into the product repository.
- **No hardware ingest.** `scan` and `scan_derivation` stay unused. `device`
  RLS is deferred to 8C, which owns the columns.
- **No CSV import.**
- **No Supabase production writes.** Nothing here has been applied to any
  Supabase project. The three projects on the account are all paused and were
  not resumed.
- **No auth.** `src/lib/session.ts` still returns a seeded context.

---

## 5 · The lead engine

Separate operator infrastructure. Prospecting tooling that finds retailers to
sell to is not the multi-tenant product those retailers use, and the two share
one concept — a prospect may become an organization — which is an export, not a
shared codebase.

Not in this phase: no `organization_id`, no backfill, no RLS, no skeleton. It
gets its own survey and export task, starting with whether the paused
`StrideGuide-Leads-Engine` Supabase project holds data worth preserving.

---

## 6 · Sequencing and exit criteria

Order matters: 8B-1 before 8B-3 (merge writes audit rows); 8B-6(c) with its code
change or the report route breaks.

| # | Item | Risk | Migration | Re-seed |
| --- | --- | --- | --- | --- |
| 1 | `audit_log` + write path | low | 0005 | no |
| 2 | consent chokepoint | low | 0006 | no |
| 4 | secret fail-fast | medium | none | **yes, if secrets change** |
| 5 | connection model docs | low | none | no |
| 6 | RLS review | medium | 0008 | no |
| 3 | identity merge | med-high | 0007 | no |

**Exit criteria.** All 65 existing tests still pass. Isolation suite extended
from 10 assertions to 14, all passing. Every proposal above either applied with
its tests, or explicitly declined and recorded here. No Supabase project written
to. 8C not started.

---

**Stop here for review.** No migration in this document has been run.
