# Stride Guide FitOS — prototype

The store-side fitting application, built from the blueprint in [`../docs`](../docs).
Days 1–4 of the seven-day plan: tenancy spine, fitting flow, recommendation
engine, and the customer fit report.

## What runs today

| | Status |
| --- | --- |
| Schema + RLS (28 tables, 21 with RLS forced) | ✅ verified against Postgres 16 |
| Tenant isolation suite (10 assertions) | ✅ passing |
| Recommendation engine, 30 rules, six-stage contract | ✅ 34 golden scenarios passing |
| Contact identity hashing (per-org HMAC) | ✅ 5 tests passing |
| Fitting flow: dashboard → customer → intake → assessment → recommendation → report | ✅ walked end to end in a browser |
| Hardware ingest, follow-up UI, CSV import, auth | ⛔ not built — see "Not built yet" |

## Run it

```bash
bash db/reset.sh      # roles, migrations, seed  (needs a local Postgres)
npm run test          # engine + identity unit tests
npm run db:isolation  # tenant isolation suite
npm run build && npm start
```

`db/reset.sh` needs a superuser once to create the cluster roles
(`db/bootstrap_roles.sql`). Everything after that runs as `fitos_owner`.

## How the pieces line up with the blueprint

| Blueprint | Code |
| --- | --- |
| [05 §1–§9](../docs/05-data-model.md) tenancy + identity | `db/migrations/0001_tenancy_and_identity.sql` |
| [05 §13–§25](../docs/05-data-model.md) fitting + catalog | `db/migrations/0002_fitting_and_catalog.sql` |
| [05 §26](../docs/05-data-model.md) access + RLS | `db/migrations/0003_rls.sql` |
| [09 Day 1 gate](../docs/09-build-plan.md) isolation suite | `db/test/isolation.sql` |
| [03](../docs/03-recommendation-engine.md) rules + contract | `src/lib/rules/{rules.json,engine.ts}` |
| [03 §8](../docs/03-recommendation-engine.md) golden set | `src/lib/rules/engine.test.ts` |
| [05 §10](../docs/05-data-model.md) phone hashing | `src/lib/db/identity.ts` |
| [02](../docs/02-ux-spec.md) fitting flow | `src/app/fitting/**` |
| [04](../docs/04-fit-report.md) fit report | `src/app/fitting/[id]/report/page.tsx` |
| [08](../docs/08-design-language.md) design tokens | `tailwind.config.ts`, `src/app/globals.css` |

## Three things worth knowing before reading the code

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

- The report's *Why* paragraph concatenates rule strings and reads slightly
  repetitive when three rules fire. This is exactly what the Phase 1 language
  layer ([07](../docs/07-ai-roadmap.md)) is for — the rules still decide.
- The report is missing the blueprint's *What you told us* block.
- Report access tokens are generated and stored hashed, but the report route is
  not yet token-gated — it resolves by session id.
