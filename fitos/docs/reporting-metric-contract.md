# FitOS Reporting — Metric Contract v1

This contract is deliberately separate from the associate-reported `outcome` table. That table is not a verified POS ledger.

## Time and scope
- Persist timestamps as `timestamptz`; filter intervals as `[start, end)`.
- Convert location-local calendar boundaries to UTC before filtering.
- Store-level reports scope to the authorized location. Organization rollups require explicitly authorized org-wide context.
- Revenue metrics are in original currency; never add unlike currencies without a documented FX conversion.

## Canonical definitions
| Metric | Numerator | Denominator / rules |
|---|---|---|
| Completed fittings | Distinct `fitting_session.id` with status=completed and `completed_at` in range | No denominator |
| Scans | Distinct `scan.id` captured in range | No denominator; separate from completed fittings |
| Direct fitting-to-sale conversion | Distinct completed fitting sessions with >=1 linked, completed sale and `method='explicit'` | Eligible completed fitting sessions in cohort; count each fitting once |
| POS-matched conversion | Distinct completed fitting sessions with linked completed sale via explicit or POS customer match | Same denominator; label method/coverage |
| Associated sales revenue | Sum of unique completed `retail_sale.total` linked to eligible fittings | Count each sale once even if multiple fittings link to it; observational, NOT incremental lift |
| Net associated sales | Associated sales total minus refunds for those sales | Partial refunds and multiple refund records supported |
| Return rate | Returned units / sold units for line-linked returns | Null if line coverage insufficient |
| Customer purchase history | Completed `retail_sale` records for authorized customer | No inference from `outcome` |
| Customer fitting history | Completed sessions for authorized customer | Include scans separately |
| Participation | Visits with linked fitting / known visits | Only where visit capture is complete; otherwise show unavailable |
| 30-day repeat purchase | Customers with a second completed sale within 30 days of first qualifying sale | Eligible customers with adequate 30-day observation window |
| Device usage | Scan count by device installation | Device IDs and installation history must be validated |

## Integrity and provenance
- Source, external transaction ID, and timestamp are mandatory for sale ingestion. External IDs can be null for manual entry; manual entries must have application-issued stable IDs.
- A fitting outcome marked `purchased` is *reported*, not verified, until linked to a completed sale.
- Multiple scans may link to a sale; never sum sale totals through the join without deduplicating sale IDs.
- `time_window` attribution is estimated and must never be silently combined with direct attribution.
- An unknown outcome is not a no-sale.
- Empty denominators display N/A rather than 0%.
- No baseline/control cohort means no defensible causal lift or incremental ROI claim.
- Data coverage (POS integration, visit capture, returns, customer match) must accompany business outcome reporting.

## Remaining implementation gates
1. Migration must be applied to a disposable Postgres 16 database; verify fresh bootstrap and rollback strategy.
2. Add adversarial RLS tests for same-organization cross-store access, foreign organization, and forged cross-store attribution.
3. Add authenticated reporting services and paginated APIs, bounded time filters, customer and store views.
4. Implement manual/POS CSV ingestion with idempotency and validated transaction totals.
5. Add CSV exports with formula-injection escaping and audit events.
6. Run existing full test, kiosk, browser, and database isolation suites.
7. Validate production deployment/authentication independently; current seeded staff context is not production authentication.

No schema or metric definition alone is proof of a production-ready reporting dashboard.
