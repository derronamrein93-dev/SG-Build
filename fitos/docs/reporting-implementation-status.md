# Reporting implementation status

Development branch: `chatgpt/fitos-reporting-foundation`. Not merged or deployed.

## Implemented in source
- Additive migrations 0020 and 0021: visits, sales, lines, refunds, attribution, link integrity and tenant RLS.
- Bounded store/customer reporting queries.
- Store-local date ranges, including DST transitions.
- Reconciled, source-idempotent USD sale ingestion and line items.
- Development-only store dashboard, reporting APIs, CSV metrics export.
- Unit test files for dates, ingestion validation and CSV escaping.
- Adversarial reporting RLS/FK SQL test; wired into `npm run verify`.

## Critical release blockers
1. **Staff authentication is not present in the GitHub base.** `currentContext()` still returns seeded demo identities. All new reporting pages/APIs explicitly fail closed in production; local preview requires `FITOS_REPORTING_DEMO_ENABLED=true`. Never turn that flag on in a public environment.
2. **Full verification has not run.** Apply all migrations to disposable Postgres 16 and execute `npm run verify`. Regenerate the deployment schema bundle using `npm run deploy:bundle` before the bundle check; review generated diffs and commit the regenerated artifact. The developer environment used to author these commits has no repository checkout or Postgres server.
3. **The new data has no real POS connection yet.** Manual JSON ingestion is a development-gated API, not a production-ready CSV/POS importer. Implement CSV parsing, reconciliation preview, audit logs and authenticated operator UI.
4. **Reporting coverage is incomplete.** Customer history API is capped at 500 rows; pagination, return/refund rollups, visit coverage, device uptime, staff attribution, cost/ROI, and cohort retention remain.
5. **No live production metrics have been asserted.** Sale association is not evidence of incremental sales lift.

## Developer check sequence
```sh
cd fitos
npm run db:reset
npm run test
npm run db:isolation
npm run db:reporting-isolation
npm run deploy:bundle
npm run deploy:check
npm run build
```

Only after the database and security tests pass should a review PR be considered.
