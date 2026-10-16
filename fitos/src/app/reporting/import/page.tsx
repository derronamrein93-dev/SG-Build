import Link from 'next/link';
import CsvPreview from './CsvPreview';
import { assertReportingAccess } from '../../../lib/reporting/access';

export const dynamic = 'force-dynamic';

export default function ReportingImportPage() {
  assertReportingAccess();
  return (
    <main className="max-w-[800px] mx-auto p-8">
      <Link href="/reporting" className="text-[14px] text-ink-muted hover:text-accent">← Reporting</Link>
      <p className="overline mt-6">Stride Guide · Data quality</p>
      <h1 className="text-[34px] font-semibold mt-1">Sales CSV preview</h1>
      <p className="text-ink-secondary mt-3">
        Validate transaction IDs, line items, timestamps, and financial totals
        before importing sales. This development preview does not write to the database.
      </p>
      <CsvPreview />
      <div className="card mt-6">
        <h2 className="text-[18px] font-semibold">Required columns (in this order)</h2>
        <p className="text-[13px] text-ink-secondary mt-3 break-words">
          transaction_id, occurred_at, customer_id, sku, brand, model, quantity,
          unit_price_cents, line_discount_cents, sale_discount_cents, tax_cents, total_cents
        </p>
        <p className="text-[13px] text-ink-muted mt-3">
          Each line item occupies one row. Repeat the same transaction ID and
          transaction-level totals on every row for that sale. Timestamps require
          an explicit UTC offset. Amounts are whole USD cents. No customer ID
          is required for anonymous purchases.
        </p>
      </div>
    </main>
  );
}
