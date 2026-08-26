# core_persistence

The one thing this package owns: **the family's data, and its integrity**.

SQLite in WAL mode via Drift. It is the only package that knows what a table is.

Three invariants this package exists to guarantee:

1. **Stars are a ledger, never a number.** Rows are append-only; a mistake is
   corrected with an offsetting entry, so the history always explains the balance.
2. **Every mutation is idempotent.** `idempotency_key` is `UNIQUE`, so a retry, a
   double-tap or a crash-resume can never double-award.
3. **No migration loses data.** Every shipped schema version has a fixture
   database in `test/migration/`, migrated to HEAD on every CI run. This test is
   the only thing standing between an app update and a family losing 4,000 stars.
