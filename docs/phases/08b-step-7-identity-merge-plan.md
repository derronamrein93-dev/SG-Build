# Phase 8B step 7 — Identity merge: plan only

**Nothing here is implemented. No migration written, no migration run, no lookup
behavior changed.** Proposal for review.

---

## 0 · Two schema facts that shape everything below

Checked against the live schema, because both invalidate the obvious design.

**1. A customer holds exactly one phone.** `organization_customer` has
`phone_lookup_hash`, `phone_encrypted`, `phone_key_version` as *columns*, not a
related identifier table. A surviving record therefore **cannot absorb the
merged-away record's phone number** — there is nowhere to put it.

**2. Phone is unique per organization:**

```sql
CREATE UNIQUE INDEX organization_customer_phone_key
  ON organization_customer (organization_id, phone_lookup_hash)
  WHERE phone_lookup_hash IS NOT NULL AND deleted_at IS NULL;
```

So two records in one organization can never share a phone hash. **Duplicates
are not "same phone entered twice" — they are one person under two different
numbers**, or a record created without a phone at all. The mobile-only customer
who later gives a landline; the walk-in entered without contact details.

Together these force the shape: **the merged-away record must survive as a
tombstone**, because it is the only thing that can carry its own phone hash and
redirect a lookup on that number to the survivor. Deleting it would strand the
number. That is not a preference, it is the schema's consequence.

A third fact reinforces it: `fitting_session.organization_customer_id` is
`ON DELETE SET NULL` while the other five references cascade. Deleting a
customer would silently orphan their fitting history rather than remove it.

---

## 1 · Current customer identity model

| Table | Role in a merge | FK on-delete |
| --- | --- | --- |
| `organization_customer` | The retailer relationship. Holds identity columns and `local_customer_number`. | — |
| `phone_lookup_hash` | Per-org HMAC, unique per org, the only lookup key | — |
| `phone_encrypted` | Retains E.164 — the reason pepper rotation is possible at all | — |
| `phone_key_version` | Which pepper produced the hash. Currently `1` everywhere | — |
| `location_customer_access` | Authorization grants, one row per location | cascade |
| `fitting_session` | The history that must not be lost | **set null** |
| `consent_record` | Append-only; withdrawal is a new row | cascade |
| `report` | Carries its own `organization_customer_id` alongside the session | cascade |
| `report_view` | References `report`, not the customer — **moves implicitly** | (via report) |
| `follow_up` | Present, references the customer | cascade |
| `identity_resolution` | Links to the optional global `person_identity` | cascade |
| `audit_log` | Where the merge becomes reconstructible | — |

Six tables reference the customer directly. `report_view` is the seventh
implicitly, and needs no action.

---

## 2 · Merge semantics

| Term | Meaning |
| --- | --- |
| **Surviving customer** | The record that continues. Keeps its id, `local_customer_number`, and phone. Receives the merged-away record's history. |
| **Merged-away customer** | The duplicate. Row is **never deleted**. Keeps its own phone hash and gains `merged_into_customer_id` + `merged_at`. Becomes a redirect. |
| `merged_into_customer_id` | Nullable self-reference. Non-null means "this is not a live record; follow the pointer." |
| **merge_requested** | An operator proposes the merge. Audited. No data moves. Exists so a rejected proposal leaves a trail. |
| **merge_completed** | The move happened. Audit carries the full manifest of every row id that moved. |
| **merge_rejected** | The proposal was declined. Audited, no data movement. |
| **merge_reverted** | The manifest was replayed backwards. See §8 for what it does and does not restore. |

**Which record survives** is an operator decision, not an algorithm. Default
suggestion in any future UI: the record with more completed fittings, and on a
tie the older one — but the operator picks, and the choice is recorded.

**Chains are refused.** A record whose `merged_into_customer_id` is already set
cannot be a merge target or source. Chains make reversal ambiguous and buy
nothing: merge into the live survivor instead.

---

## 3 · Lookup behavior — every path, exhaustively

This is the section that decides whether the feature is safe. Nine call sites
touch `organization_customer`; here is what each must do.

| # | Site | Today | Required change |
| --- | --- | --- | --- |
| 1 | `queries.ts:45` `findCustomerByPhone` | matches `phone_lookup_hash` | **Follow the pointer.** Returns the survivor when the merged-away number is typed. |
| 2 | `queries.ts:96` `startSession(customerId)` | inserts a session with the given id | **Refuse or redirect.** A fitting must never attach to a tombstone. |
| 3 | `queries.ts:101` visit-number count | counts sessions for the id | Correct after the move — history lives on the survivor |
| 4 | `queries.ts:126` previous-visit lookup | joins on `organization_customer_id` | Correct after the move |
| 5 | `queries.ts:22, 28` dashboard joins | display joins | Correct after the move |
| 6 | `consent.ts:71` `customerConsent` | latest row for the id | Correct after the move; **also** resolve the id defensively |
| 7 | `actions.ts:125` report insert | copies the id from the session | Correct — sessions already moved |
| 8 | `reports.ts:29, 58` report rendering | joins through the session | Correct |
| 9 | `identity.test.ts:52` ID06 guard | direct hash lookup | Unchanged — asserts the seeded customer, which is never merged |

Two sites need code; six are correct by construction once history moves; one is
a test.

### The resolver

One function, mirroring the consent chokepoint's discipline:

```sql
create or replace function app_resolve_customer(candidate uuid) returns uuid as $$
  select coalesce(
    (select merged_into_customer_id from organization_customer
      where id = candidate and merged_into_customer_id is not null),
    candidate)
$$ language sql stable;
```

One hop, not recursive, because chains are refused at merge time. Invoker
rights, so RLS applies: a foreign tenant's id resolves to itself and then fails
the usual policies, leaking nothing.

**Site 1** wraps its result: `select app_resolve_customer(id) ...` — the
returning-customer search then produces the survivor regardless of which number
was typed, which is the entire user-visible point of the feature.

**Site 2 refuses rather than redirects.** `startSession` is a write, and
silently retargeting a write is how a fitting ends up on a record the associate
did not choose. It raises, and the caller re-resolves and retries. A read may be
helpful; a write must be explicit.

### Enforcement, following the CH10 precedent

A test that greps the source for `phone_lookup_hash` outside the resolver path,
mirroring `consent.test.ts` CH10. The rule "every lookup follows the pointer" is
worth a mechanism, not a code review habit.

---

## 4 · Data movement strategy — move the history, keep the identity

**Recommendation: move all six child references to the survivor; keep the
merged-away row as a tombstone carrying its phone hash and pointer.**

The alternative — leave rows attached and resolve at read time — was considered
and rejected:

| | Move | Read-time indirection |
| --- | --- | --- |
| Query sites needing change | 2 | 6+, every history query becomes "this customer *or anyone merged into them*" |
| Visit numbering, previous-visit | Correct automatically | Silently wrong wherever a site is missed |
| Historical rows mutated | Yes | No |
| Reversibility | Full, from the audit manifest | Trivial |
| Failure mode of a mistake | Loud — a moved row is visible | **Silent** — one un-updated query undercounts a customer's history forever |

The deciding argument is the failure mode. A missed query under indirection does
not error; it quietly shows a returning customer as new, which is precisely the
outcome the product exists to prevent. Moving concentrates the risk into one
audited transaction instead of spreading it across every future query anyone
writes.

Mutating history is the real cost, and it is paid down by Step 3: the audit
records every moved row id, ordered by `seq`, so the pre-merge state is
reconstructible exactly.

**What does not move:** the tombstone row itself, its phone columns, its
`local_customer_number` (a retailer may have written it on a shoebox), and
person-scoped `consent_record` rows, which reference `person_identity` rather
than the customer.

---

## 5 · Consent behavior

**The merge writes no consent rows.** It moves organization-scoped rows from the
merged-away record to the survivor and nothing else. No synthesis, no
reconciliation, no defaults.

This does not broaden anything across tenants: a merge is intra-organization by
construction (§7), so every moved row was already visible to exactly the tenant
that will hold it.

**Person-scoped rows are not touched.** They carry `person_identity_id` and no
`organization_customer_id`, so they are not among the six references. Migration
0005's location-scoped visibility is unaffected.

**The chokepoint is unchanged.** `hasConsent()` continues to resolve the most
recent row with `granted asc` as the tie-break. Merging simply means the two
records' rows are now one timeline.

### One consequence that must be a decision, not a surprise

If the survivor withdrew `marketing_email` in March and the merged-away record
granted it in June, then after the merge the June grant is the most recent row
and consent reads **true**.

That is defensible — it is the same person's later expression of preference —
but it is a state that did not exist before the merge, and an operator merging
two records is unlikely to be thinking about it. Three options, and I recommend
the second:

1. Accept it silently. Simplest, and quietly surprising.
2. **Detect and surface it.** The merge computes, per consent type, whether the
   effective answer changes, and records the deltas in the audit metadata as
   counts and type names. If any *marketing* type flips from false to true, the
   merge requires a second explicit confirmation flag. **Recommended** — it makes
   the one genuinely consequential case visible without blocking the common one.
3. Fail closed by writing a withdrawal for any type that would flip to true.
   Safest, but the merge would then be inventing consent state, which the scope
   forbids.

---

## 6 · Audit behavior

Four events, all through `writeMergeAudit` from Step 3, sharing one
`correlation_id`, subject = surviving customer, target = merged-away customer.

| Event | When | Metadata |
| --- | --- | --- |
| `customer_identity.merge_requested` | Proposal recorded | counts per table that *would* move; consent deltas from §5 |
| `customer_identity.merge_completed` | After the move, same transaction | the manifest: `{ moved: { fitting_session: [...ids], report: [...], follow_up: [...], consent_record: [...], location_customer_access: [...], identity_resolution: [...] } }` |
| `customer_identity.merge_rejected` | Proposal declined | operator's reason code (an enum, not free text) |
| `customer_identity.merge_reverted` | Manifest replayed backwards | the manifest actually restored, plus anything skipped and why |

Ordering is by `seq`, the monotonic identity column added in Step 5 — not
`created_at`, which ties when several events share a transaction.

**Metadata is ids and counts only.** No names, no phone numbers. The `audit_log`
check constraint would reject them anyway, which is the point of having it.

---

## 7 · RLS impact

**Merge cannot cross organizations, proven three ways.**

1. **Explicit check.** The function reads `organization_id` from both records and
   raises `refusing to merge customers across organizations` if they differ.
2. **RLS, not bypassed.** The function is **invoker rights, not SECURITY
   DEFINER**. Running as `fitos_app` under a tenant context, a foreign customer
   id is invisible, so `select organization_id into ...` returns null and the
   function raises "both customers must exist" — the same message a nonexistent
   id produces. **Existence is not leaked.**
3. **Execute is restricted.** `revoke execute from fitos_app` and grant to
   `fitos_svc` only. A merge is an operator action routed through a service path,
   not something a tablet session can invoke.

Points 2 and 3 together are deliberate belt and braces: 3 is the intended
control, 2 is what holds if 3 is ever loosened.

**One organization cannot infer another's records.** The two failure messages
are identical for "does not exist" and "exists but belongs to someone else", by
design — the same principle as `token.test.ts` P11.

**Location access stays valid.** `location_customer_access` rows move with the
customer, so a survivor ends up with the union of both records' grants. That is
correct: if the person was recognized at two doors, they remain recognized at
both. It is a union *within one organization*, never across.

Duplicate `(organization_customer_id, location_id)` pairs are possible when both
records were accessible at the same door. The move must upsert, not blind-insert,
or it violates `location_customer_access_key`.

---

## 8 · Reversal strategy

**`merge_reverted` replays the `merge_completed` manifest backwards**: every row
id listed moves back to the merged-away record, and `merged_into_customer_id`
and `merged_at` are cleared.

**Full reversal is safe for the manifest, and only for the manifest.** This is
the honest limit:

- Rows created **after** the merge attached to the survivor, because at that
  moment the survivor was the only live record. They are not in the manifest and
  **stay with the survivor**. A fitting done last Tuesday under the merged
  identity cannot be attributed to one of the two originals, because at the time
  there was only one.
- If the survivor has itself since been merged away, reversal is **refused**.
  Unwinding a chain is ambiguous.
- If a moved row has since been deleted, reversal restores what remains and
  records the gap in the audit rather than failing.

So reversal is precise about the past and honest about the interval. It is not a
time machine, and the plan should not imply otherwise.

**The safe alternative when reversal is refused** — a chain, or a dispute about
post-merge history — is a **forward correction**: create a fresh customer record
and move the disputed rows to it explicitly, audited as an ordinary operator
action. That keeps the trail additive instead of pretending the merge never
happened.

---

## 9 · Proposed migration — `0008_identity_merge.sql` (NOT WRITTEN, NOT RUN)

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

-- One hop only; chains are refused at merge time. Invoker rights, so a foreign
-- tenant's id resolves to itself and then fails the usual policies.
create or replace function app_resolve_customer(candidate uuid) returns uuid as $$
  select coalesce(
    (select merged_into_customer_id from organization_customer
      where id = candidate and merged_into_customer_id is not null),
    candidate)
$$ language sql stable;

-- app_merge_customer(loser, winner, actor, correlation) returns the manifest.
--   * same-organization check, raising identically for absent and foreign ids
--   * refuses either side already merged
--   * builds the manifest BEFORE moving, so the audit can reverse it
--   * upserts location_customer_access to respect its unique key
--   * writes merge_completed inside the same transaction
-- Full body deferred to implementation, after this plan is approved.

revoke execute on function app_merge_customer(uuid, uuid, uuid, uuid) from public, fitos_app;
grant  execute on function app_merge_customer(uuid, uuid, uuid, uuid) to fitos_svc;
```

### Rollback notes

`rollback/0008_down.sql` drops the constraints, index, columns and both
functions.

**Reversible only while no merge has been performed.** Once a merge exists,
dropping `merged_into_customer_id` destroys the redirect while leaving the moved
rows on the survivor — a partial state worse than either end. The rollback must
therefore refuse if any row has a non-null pointer, and say so:

```sql
do $$ begin
  if exists (select 1 from organization_customer where merged_into_customer_id is not null) then
    raise exception 'Refusing to roll back 0008: % merged record(s) exist. Revert the merges first.',
      (select count(*) from organization_customer where merged_into_customer_id is not null);
  end if;
end $$;
```

Same gate pattern as 0007's orphan sweep: stop, report, require a deliberate act.

---

## 10 · Proposed tests

**Merge mechanics** — `merge.test.ts`, new suite:

| | Assertion |
| --- | --- |
| MG01 | Every one of the six references moves to the survivor |
| MG02 | The merged-away row still exists, keeps its phone hash and `local_customer_number` |
| MG03 | Cross-organization merge raises, with the same message as a nonexistent id |
| MG04 | Self-merge raises |
| MG05 | Merging an already-merged record raises (no chains) |
| MG06 | `location_customer_access` duplicates upsert rather than violating the unique key |
| MG07 | `fitos_app` cannot execute the merge function |

**Lookup** — the section that matters most:

| | Assertion |
| --- | --- |
| MG08 | Searching the merged-away **phone number** returns the survivor |
| MG09 | Searching the survivor's number still returns the survivor |
| MG10 | `startSession` on a merged-away id **raises** rather than silently retargeting |
| MG11 | Visit number counts the combined history, not either half |
| MG12 | Previous-visit comparison finds the pre-merge fitting |

**Consent, audit, access:**

| | Assertion |
| --- | --- |
| MG13 | `hasConsent` still fails closed for a type neither record granted |
| MG14 | A withdrawal on either record still wins at equal timestamps |
| MG15 | The §5 consent flip is detected and recorded, and marketing flips require the confirmation flag |
| MG16 | Person-scoped consent is untouched by the merge |
| MG17 | Four events ordered by `seq`, sharing one `correlation_id`, subject = survivor, target = merged-away |
| MG18 | Audit metadata contains no PII keys (the constraint proves it, the test states it) |

**Regression — nothing else moves:**

| | Assertion |
| --- | --- |
| MG19 | `/r/<token>` resolves and renders unchanged after a merge of an unrelated customer |
| MG20 | A report belonging to a moved fitting still resolves by its original token |
| MG21 | ID06 — the Day 5 seeded returning customer — still resolves by phone |
| MG22 | Isolation suite unchanged at 21 assertions, plus one: a merged record is invisible cross-tenant |

**Reversal:**

| | Assertion |
| --- | --- |
| MG23 | Reversal restores every manifest row and clears the pointer |
| MG24 | Rows created after the merge stay with the survivor, and the audit says so |
| MG25 | Reversal of a record that has since been merged again is refused |

**Negative control, per the Step 1 precedent:** MG08 must fail before the
resolver is wired in. A lookup test that passes without the feature is testing
nothing.

---

## 11 · What we are intentionally not building

- **No UI merge screen.** The function and its audit contract first; a screen is
  worth building once the semantics have survived contact with real duplicates.
  An operator can call the service path in the meantime.
- **No automatic fuzzy matching.** No name similarity, no phonetic keys, no
  "probably the same person". Merge is operator-initiated on evidence.
- **No cross-tenant identity graph.** Merge is intra-organization, full stop.
  `person_identity` and `identity_resolution` remain the only cross-retailer
  concepts, and this step does not touch how they resolve.
- **No medical identity resolution.** Nothing here infers anything about a
  person beyond "these two records are the same customer of this retailer".
- **No multi-identifier customer table.** The right long-term answer to "one
  person, two phone numbers" is the `customer_identifiers` table the original 8B
  specified, letting a survivor hold both numbers and retiring the tombstone
  redirect. That is a larger change and belongs in its own step; §0 explains why
  the tombstone is correct until then.
- No lead-engine integration, no hardware ingest, no CSV import, no catalog work,
  no Supabase deployment, no WordPress, no FastAPI.

---

## Open questions for review

1. **Consent flip handling** — §5, options 1/2/3. I recommend 2.
2. **`startSession` on a tombstone** — raise (recommended) or silently resolve?
   Raising costs a round trip and prevents a class of misattribution.
3. **Merge without a phone.** A record with `phone_lookup_hash = null` has no
   redirect to preserve, so its tombstone is pure history. Confirm it should
   still never be deleted — I believe yes, for audit continuity.
4. **Who may merge.** The plan restricts execution to `fitos_svc`. If store
   managers should merge from the tablet, that is a real auth requirement and
   auth does not exist yet.

**Stop here for review. Nothing implemented.**
