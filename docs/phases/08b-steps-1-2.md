# Phase 8B — revised sequencing, and steps 1–2 in full

**Nothing in this document has been applied.** The SQL below was syntax-checked
against the development database inside transactions that were rolled back; no
migration file has been added to `db/migrations/` and no schema has changed.

---

## Revised order

Sequenced so that each step is verifiable on its own, and so the two steps that
change *semantics* rather than *scope* land last.

| # | Step | Migration | Changes behavior? | Gate before proceeding |
| --- | --- | --- | --- | --- |
| **1** | Close the `consent_record` person-scope hole | `0005` | No — narrows visibility only | Isolation suite 10 → 13 assertions, all passing |
| **2** | Correct the `withService` invariant, document the trust boundary | none | No — comment, docs, tests | `token.test.ts` 9 → 11 tests, all passing |
| 3 | `audit_log` + write path for identity-merge events | `0006` | Additive | Append-only proven; tenant-isolated |
| 4 | Consent chokepoint `app_has_consent()` + `hasConsent()` | `0007` | Additive | No inline consent query survives review |
| 5 | Secret fail-fast | none | **Yes** — startup fails without secrets | Re-seed (dev) or rehash (real data), never silent |
| 6 | `user_location` + `report_view` RLS, with orphan preflight | `0008` | Yes — `loadReportByToken` must set `organization_id` | Orphan count matches known debris, or **stop** |
| 7 | Identity merge | `0009` | **Yes** — customer lookup semantics | Every search path follows `merged_into_customer_id` |

Two ordering consequences worth stating: step 3 precedes step 7 because a merge
that is not audited is not reconstructible, and step 5 precedes step 6 because
re-seeding after a secret change wipes the `report_view` rows step 6's preflight
is trying to count.

Steps 3–7 are unchanged from the approved plan and are not restated here.

---

# Step 1 · Close the `consent_record` person-scope hole

## The defect

Verified against the live policy in `pg_policies`:

```sql
using ((organization_customer_id IS NULL) OR (EXISTS (
  SELECT 1 FROM organization_customer c
   WHERE c.id = consent_record.organization_customer_id
     AND c.organization_id = app_current_org())))
```

The `IS NULL OR` branch has **no tenant predicate at all**. Every row with
`scope = 'person'` — which is precisely the set of rows carrying
`person_identity_id` — is readable by every organization. The identity
architecture forbids the application role from reading `person_identity` or
`identity_resolution` outright, then leaks the consent rows that point at them:
which identity, what was consented to, granted or withdrawn, when, and by which
method.

Nothing writes person-scoped consent yet. That is the only reason the isolation
suite passes today, and the only reason this is a hole rather than an incident.

## The decision this forces

Two ways to close it, and they differ on a product question, not a security one.

**Option A — location-scoped (recommended).** A person-scoped row is visible to
the organization that captured it, via its `location_id`, and to nobody else.

**Option B — strict.** Person-scoped rows are invisible to the application role
entirely; only `fitos_svc` sees them.

Option B is the tighter reading of "identity belongs to resolution, not to
retailers." It is also a forward trap: `with check` would then reject any
person-scoped consent *written* by the tablet, and `identity_resolution` and
`portable_profile_share` are consent types a customer plausibly grants during a
fitting, on the tablet, under the app role. Option A closes the global-read hole
— the stated requirement — without pre-emptively breaking the capture path.

**Recommendation: Option A.** Option B's SQL is included below so the choice is
one line, not a redesign.

`location_id` is nullable, and a person-scoped row without one resolves to
invisible under Option A. That is correct: it fails closed.

## Exact SQL — `db/migrations/0005_consent_person_scope.sql`

```sql
-- =============================================================================
-- 0005 · consent_record — close the person-scope read hole
--
-- The previous policy admitted "organization_customer_id is null or ...", which
-- left every scope='person' row readable by every tenant. Those rows carry
-- person_identity_id, and the application role is forbidden from reading
-- person_identity itself — so this leaked exactly what that prohibition exists
-- to protect.
--
-- Organization-scoped rows: unchanged, scoped through their customer.
-- Person-scoped rows: scoped through the location that captured them. A row
-- with no location is visible to nobody, which is the correct failure direction.
-- =============================================================================

drop policy tenant_isolation on consent_record;

create policy tenant_isolation on consent_record
  using (
    case
      when organization_customer_id is not null then exists (
        select 1 from organization_customer c
         where c.id = organization_customer_id
           and c.organization_id = app_current_org())
      else exists (
        select 1 from location l
         where l.id = location_id
           and l.organization_id = app_current_org())
    end)
  with check (
    case
      when organization_customer_id is not null then exists (
        select 1 from organization_customer c
         where c.id = organization_customer_id
           and c.organization_id = app_current_org())
      else exists (
        select 1 from location l
         where l.id = location_id
           and l.organization_id = app_current_org())
    end);
```

**Option B**, if you prefer strict — replace both predicates with:

```sql
  using (organization_customer_id is not null and exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id
             and c.organization_id = app_current_org()))
```

Grants are unchanged: `select, insert` only, so `consent_record` stays
append-only and withdrawal remains a new row rather than an update.

## Rollback — `db/migrations/rollback/0005_down.sql`

```sql
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

Restores the hole exactly. Reversible with no data implication — a policy change
reads no rows and writes none.

## Test plan — `db/test/isolation.sql`, 10 → 13 assertions

Three new person-scoped consent rows in the seed block, placed immediately after
the `person_identity` insert:

```sql
-- Person-scoped consent. Captured at Org B's door, about the shared identity.
-- Under the old policy this row was readable by Org A, which is the defect.
insert into consent_record (id, scope, person_identity_id, location_id, type, granted,
                            consent_text_version, privacy_policy_version, method) values
  ('cccccccc-6666-0000-0000-000000000001','person','cccccccc-0000-0000-0000-000000000001',
   'bbbbbbbb-1111-0000-0000-000000000001','identity_resolution', true,
   'consent-identity-v1.0','privacy-v1.0','mystrideid_account'),
  -- No location: belongs to resolution alone, and must be visible to no tenant.
  ('cccccccc-6666-0000-0000-000000000002','person','cccccccc-0000-0000-0000-000000000001',
   null,'portable_profile_share', true,
   'consent-identity-v1.0','privacy-v1.0','mystrideid_account');

-- An ordinary organization-scoped row, so the tests prove narrowing, not breakage.
insert into consent_record (scope, organization_customer_id, location_id, type, granted,
                            consent_text_version, privacy_policy_version, method) values
  ('organization','aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001',
   'fit_history_storage', true, 'consent-fit-v1.0','privacy-v1.0','tablet_checkbox');
```

Assertions 9 and 10 go in the existing Org A / Location A1 block, before its
`end $$;`:

```sql
  -- 9 · person-scoped consent is not globally readable
  select count(*) into n from consent_record where scope = 'person';
  if n <> 0 then
    raise exception 'TEST 9 FAILED: % person-scoped consent rows visible to Org A', n;
  end if;
  raise notice 'PASS 9 · person-scoped consent invisible across tenants';

  -- 10 · ...and the organization's own consent rows still are
  select count(*) into n from consent_record where scope = 'organization';
  if n <> 1 then
    raise exception 'TEST 10 FAILED: expected 1 own consent row, saw %', n;
  end if;
  raise notice 'PASS 10 · organization-scoped consent still visible to its own tenant';
```

Assertion 11 needs Org B's context. Append after the PASS 5 block, before
`reset role`:

```sql
-- 11 · the capturing organization can still see the person-scoped row it took,
--      and only that one — the location-less row stays invisible to everyone.
set role fitos_app;
set app.organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
set app.location_id     = 'bbbbbbbb-1111-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from consent_record
   where scope = 'person' and id = 'cccccccc-6666-0000-0000-000000000001';
  if n <> 1 then
    raise exception 'TEST 11 FAILED: capturing org cannot see its own person-scoped consent';
  end if;

  select count(*) into n from consent_record
   where scope = 'person' and id = 'cccccccc-6666-0000-0000-000000000002';
  if n <> 0 then
    raise exception 'TEST 11 FAILED: location-less person-scoped consent was visible';
  end if;
  raise notice 'PASS 11 · person-scoped consent scoped to the capturing organization';
end $$;
```

Under **Option B**, assertion 11 inverts: both counts are 0, and the notice
becomes "person-scoped consent invisible to every tenant."

**Verify the test actually tests something.** Run the new assertions against the
*old* policy first. Assertion 9 must fail. A test that passes before the fix is
not a regression test, and this one is cheap to get wrong — `scope = 'person'`
returning 0 could equally mean the policy works or the seed row is missing.

## Verified against a real database

Run inside `begin … rollback` on a freshly reset database — nothing committed.
A second organization, a shared `person_identity`, and the two person-scoped
consent rows above were inserted, then the policy was swapped mid-transaction:

```
OLD policy - person rows visible to Org A: 2      ← the hole, confirmed
OLD policy - Org A own org-scoped rows:    2
NEW policy - person rows visible to Org A: 0      ← closed
NEW policy - Org A own org-scoped rows:    2      ← narrowing, not breakage
ORGB - captured person row:                1      ← capturing org retains access
ORGB - location-less person row:           0      ← fails closed
```

**The proposed assertion 9 fails before the fix (2 ≠ 0) and passes after.** It is
a regression test, not a tautology.

The existing write path was checked separately: the exact insert from
`queries.ts:82` — `scope = 'organization'` with `organization_customer_id` and
`captured_by_user_id` — succeeds under the new `with check`. Customer creation is
unaffected.

## Risk and demo impact

**Risk: low.** Read-narrowing only, and verified as such above. Both `queries.ts:82` and `db/seed.ts:69`
write `scope = 'organization'` with `organization_customer_id` set — verified —
so no existing write path meets the new `with check`.

**Demo flows: none.** No re-seed. The fitting flow does not read consent.

---

# Step 2 · The token trust boundary

No SQL. A false comment, a documented boundary, and two tests.

## The false invariant

`src/lib/db/client.ts:50`:

```ts
/** Service role: seeding, jobs, identity resolution. Never reachable from a page. */
```

`loadReportByToken` (`src/lib/reports.ts:21`) calls `withService`, and the public
route `/r/[token]` calls that. So `withService` **is** reachable from a page, and
one production path runs as `fitos_svc` with `BYPASSRLS`.

The design is right. A customer opening a link has no session and no tenant, so
there is no RLS predicate to satisfy; the token hash is the authorization. But a
security-relevant file asserting the opposite of what the code does is worse than
silence — the next person to add a `withService` call reads that comment as
permission.

## Exact diff — `src/lib/db/client.ts`

```diff
-/** Service role: seeding, jobs, identity resolution. Never reachable from a page. */
+/**
+ * Service role — runs as `fitos_svc`, which has BYPASSRLS. No policy applies to
+ * anything done in here.
+ *
+ * Used by: seeding, tests, identity resolution, and ONE production path —
+ * `loadReportByToken`, where the customer is anonymous, there is no tenant
+ * context, and the SHA-256 token match IS the authorization boundary.
+ *
+ * The rule that keeps that path safe: a query inside it may be keyed by the
+ * token hash and nothing else. It must never accept a caller-supplied
+ * identifier as a filter or a join condition, because RLS is not there to catch
+ * the mistake. Anything that needs a tenant predicate belongs in `withTenant`.
+ */
 export async function withService<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
```

## Exact diff — `docs/05-data-model.md`, new section

Append after the RLS section:

```markdown
## Connection model and trust boundaries

Three ways into the database, and they are not interchangeable.

| Path | Role | RLS | Authorization is |
| --- | --- | --- | --- |
| `withTenant` | `fitos_app` | Applies — no BYPASSRLS | The GUCs `app.organization_id` / `app.location_id`, enforced by 19 policies |
| `withService` | `fitos_svc` | **Bypassed** | Whatever the caller enforces. Currently: a token hash, or a test |
| Migrations | `fitos_owner` | Applies — RLS is FORCEd | Not an application path |

`withTenant` opens a transaction, issues `set local role fitos_app`, and sets the
GUCs the policies read. FitOS does **not** connect with a service role and filter
in application code; the database refuses cross-tenant reads whether or not a
call site remembers to ask it to.

The public report is the one deliberate exception. `/r/<token>` has no session,
so RLS has nothing to key on. `loadReportByToken` hashes the token, matches
`report.access_token_hash`, and checks `revoked_at` and `expires_at`. **The token
is the boundary.** It is 24 random bytes, stored only as a SHA-256 digest, and a
session id is not an input to that function and cannot become one.

**If FitOS moves to Supabase, the role switching must survive the move.** A
Supabase client using the service-role key for application queries bypasses all
19 policies at once — and the isolation suite would still pass, because it tests
the database, not the client. Whatever connects must arrive as a role without
BYPASSRLS, with the tenant GUCs set from verified JWT claims.
```

## Test plan — `src/lib/report/token.test.ts`, 9 → 11 tests

Already covered, and re-run as part of this step: P01 valid token resolves ·
P06 expired fails · P07 revoked fails · P04 raw session id fails · P02/P03
unknown and malformed fail.

Two genuinely new ones. Exact code, using the file's existing `seedReport`
helper:

```ts
test('P10 a token resolves only its own report', async () => {
  // "A valid token works" is weaker than it sounds: it passes even if the query
  // ignores the token and returns the newest report. Two live tokens at once is
  // what makes the claim exclusivity rather than existence.
  const a = await seedReport();
  const b = await seedReport();

  const ra = await loadReportByToken(a.token);
  const rb = await loadReportByToken(b.token);

  assert.equal(ra?.fitting_session_id, a.sessionId);
  assert.equal(rb?.fitting_session_id, b.sessionId);
  assert.notEqual(ra?.id, rb?.id, 'two tokens must not resolve the same report');
});

test('P11 an unrelated organization cannot infer that a report exists', async () => {
  // Isolation is not only "cannot read". If a foreign tenant can tell a real
  // session id from a fabricated one — different row count, different error,
  // anything — the boundary leaks existence even while withholding content.
  const { sessionId } = await seedReport();

  const other = await withService(async (c) => {
    const { rows } = await c.query(
      `insert into organization (name) values ('Unrelated Retailer') returning id`);
    return rows[0].id as string;
  });

  const probe = (id: string) => withTenant(
    { organizationId: other, locationId: DEMO.locationId },
    async (c) => (await c.query(
      `select r.id from report r
         join fitting_session s on s.id = r.fitting_session_id
        where r.fitting_session_id = $1 limit 1`, [id])).rows[0] ?? null);

  const real = await probe(sessionId);
  const fake = await probe('00000000-0000-0000-0000-000000000000');

  assert.equal(real, null, 'a foreign tenant must not resolve a real session id');
  assert.deepEqual(real, fake, 'real and fabricated ids must be indistinguishable');
});
```

`DEMO` and `withTenant` are already imported by this file; no new imports.

**What P11 does not prove.** It shows the *result* is identical, not that the
*timing* is. A timing oracle on report existence is real but out of scope here,
and the mitigation is rate limiting at the edge rather than a query change.
Noting it so it is a decision rather than an oversight.

## Risk and demo impact

**Risk: low.** No schema change, no behavior change. The only executable change
is two added tests.

**Demo flows: none.**

---

## Not in this batch

`audit_log`, the consent chokepoint, secret fail-fast, `user_location` and
`report_view` RLS with its orphan preflight, and identity merge — steps 3–7,
drafted in `08b-fitos-audit-and-hardening.md`, unchanged and not started.

Also unchanged: no 8C, no lead-engine consolidation, no FastAPI, no hardware
ingest, no CSV import, no Supabase writes, no auth.

**No migration runs without final review.**
