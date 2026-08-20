# Stride Guide FitOS — prototype

The store-side fitting application, built from the blueprint in [`../docs`](../docs).
Days 1–4 of the seven-day plan — tenancy spine, fitting flow, recommendation
engine, customer fit report — plus the Day 5 readiness pass: report language
layer, *What you told us*, and a token-gated public report route.

## What runs today

| | Status |
| --- | --- |
| Schema + RLS (28 tables, 21 with RLS forced) | ✅ verified against Postgres 16 |
| Tenant isolation suite (23 assertions) | ✅ passing |
| Recommendation engine, 30 rules, six-stage contract | ✅ 35 golden scenarios passing |
| Contact identity hashing (per-org HMAC) | ✅ 5 tests passing |
| Report language layer + *What you told us* | ✅ 16 tests passing |
| Token-gated public report route | ✅ 11 tests passing against Postgres |
| Append-only tenant-scoped `audit_log` | ✅ 10 tests + 5 isolation assertions |
| Consent chokepoint `hasConsent()` | ✅ 10 tests, fails closed |
| Required identity peppers, no fallback | ✅ 11 tests, fails fast |
| Tenant-scoped, append-only `report_view` | ✅ gated orphan sweep, 5 preflight assertions |
| Customer merge primitive (tombstone + reversal) | ✅ 21 tests, service-role only |
| Fitting flow: lookup → 3 yes/no questions → scan → recommendation → report | ✅ walked end to end in a browser |
| Quick intake (3 questions, 2 returning) | ✅ 18 tests, verified on a tablet viewport |
| Hardware ingest, follow-up UI, CSV import, auth | ⛔ not built — see "Not built yet" |

**141 tests across ten suites**, plus 23 isolation assertions and 5 preflight assertions in psql.

## Run it

```bash
bash db/reset.sh      # roles, migrations, seed  (needs a local Postgres)
npm run demo          # reset, build, start on :3000  (see ../DEMO_RUNBOOK.md)
npm run verify        # reset → tests → preflight → isolation → build → reset
npm run test          # all suites  (141 tests) — sources dev.env for the peppers
npm run db:isolation  # tenant isolation suite  (19 assertions)
npm run build && npm start
```

`db/reset.sh` needs a superuser once to create the cluster roles
(`db/bootstrap_roles.sql`). Everything after that runs as `fitos_owner`.

**The identity peppers are required and have no fallback.** `dev.env` supplies
explicit non-secret development values; `db/reset.sh` and `npm run test` both
source it, so seeded data and computed hashes always agree. Anything already
exported wins. See [05 · Identity peppers](../docs/05-data-model.md).

## How the pieces line up with the blueprint

| Blueprint | Code |
| --- | --- |
| [05 §1–§9](../docs/05-data-model.md) tenancy + identity | `db/migrations/0001_tenancy_and_identity.sql` |
| [05 §13–§25](../docs/05-data-model.md) fitting + catalog | `db/migrations/0002_fitting_and_catalog.sql` |
| [05 §26](../docs/05-data-model.md) access + RLS | `db/migrations/0003_rls.sql` |
| [08B step 1](../docs/phases/08b-steps-1-2.md) consent scope | `db/migrations/0005_consent_person_scope.sql` |
| [08B step 3](../docs/phases/08b-fitos-audit-and-hardening.md) audit trail | `db/migrations/0006_audit_log.sql`, `src/lib/db/audit.ts` |
| [09 Day 1 gate](../docs/09-build-plan.md) isolation suite | `db/test/isolation.sql` |
| [03](../docs/03-recommendation-engine.md) rules + contract | `src/lib/rules/{rules.json,engine.ts}` |
| [03 §8](../docs/03-recommendation-engine.md) golden set | `src/lib/rules/engine.test.ts` |
| [05 §10](../docs/05-data-model.md) phone hashing | `src/lib/db/identity.ts` |
| [02](../docs/02-ux-spec.md) fitting flow | `src/app/fitting/**` |
| [04](../docs/04-fit-report.md) fit report | `src/components/ReportDocument.tsx` |
| [04](../docs/04-fit-report.md) public link · internal view | `src/app/r/[token]/page.tsx` · `src/app/fitting/[id]/report/page.tsx` |
| [04 §2](../docs/04-fit-report.md) *What you told us* | `src/lib/report/toldUs.ts` |
| [07 Phase 1](../docs/07-ai-roadmap.md) language layer | `src/lib/report/language.ts` |
| [10](../docs/10-day5-usability-test.md) Day 5 usability test | run it against `npm start` |
| [08](../docs/08-design-language.md) design tokens | `tailwind.config.ts`, `src/app/globals.css` |

## Five things worth knowing before reading the code

**RLS is FORCEd, so even the table owner cannot write past it.** Seeding and
migrations run as `fitos_svc`, which is the same separation production uses.
`withTenant()` in `src/lib/db/client.ts` is the only path the application has to
the database, and it always runs as `fitos_app` — a role with no `BYPASSRLS`.

**Contact hashes are keyed per organization.** Under one global key, two
retailers' rows for the same person produce identical hashes, and the platform
could correlate customers across retailers as a side effect of the schema.
`src/lib/db/identity.test.ts` asserts the two hashes differ.

**Direct observations seed the fit profile at weight 1; rules vote at 2–3.**
Every rule encodes an *inference*. "What you measured is what you need" is not an
inference, has no reasoning and deserves no talking point, so it lives in
`seedFromObservations()` rather than the rule file. This was found by walking a
real fitting — a measured wide foot never reached the recommendation.

**The public report resolves by token only; the session id is not a key.**
`/r/<token>` hashes the token and looks it up in `report.access_token_hash`
through `withService`, checking `revoked_at` and `expires_at`; anything else 404s,
including a valid session id. The associate's own view stays at
`/fitting/<id>/report` and is tenant-scoped by RLS. Both render the same
`ReportDocument`, which is why the two paths cannot drift apart.

**The default language composer is deterministic, not a model call.** A demo in
front of a store owner cannot depend on a network round trip, and a paragraph on
a customer's record has to be reproducible from `rule_set_version` years later.
`LanguageProvider` in `src/lib/report/language.ts` is the seam a model plugs into;
its output is checked against the guardrail lexicon, a length band and an
implied-precision pattern, and falls back to the deterministic text with a
recorded `fallbackReason` if it fails any of them. The paragraph is composed once,
at completion, and frozen into `report.content_snapshot`.

## Not built yet

Deliberately, per [01 §9](../docs/01-prd.md):

- **Auth.** `src/lib/session.ts` returns a seeded context; real auth plugs in
  there and nowhere else, because every query already goes through `withTenant`.
- **Supabase deployment.** The schema is plain Postgres and the GUC helpers map
  to JWT claims, but nothing has been run against a Supabase project.
- Follow-up completion UI, outcome capture sheet, pilot-feedback sheet, override
  controls, CSV import, print stylesheet polish, email delivery, QR sharing.
- Hardware ingest — `scan` and `scan_derivation` exist and are unused, which is
  the point.

## Known rough edges

- The composed paragraph covers the rules that fire today. A rule added to
  `rules.json` without a phrase in `language.ts` will rank and show as a talking
  point but will not appear in the prose.
- Report links do not expire on their own schedule yet — `expires_at` is honoured
  on read, but nothing revokes or re-issues a link from the UI.
- No print stylesheet pass on the public report, and no email delivery: the link
  is copied by hand today.
