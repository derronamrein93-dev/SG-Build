import Link from 'next/link';
import { currentContext } from '../../lib/session';
import { withTenant } from '../../lib/db/client';
import { storeOutcomes } from '../../lib/reporting/outcomes';
import { localCalendarRange } from '../../lib/reporting/dates';
import { assertReportingAccess } from '../../lib/reporting/access';

export const dynamic = 'force-dynamic';

function asDay(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export default async function ReportingPage({
  searchParams,
}: { searchParams: Promise<{ from?: string; through?: string }> }) {
  // The current branch's staff identity is seeded. Never expose reporting
  // to public deployments until actual authenticated roles are installed.
  assertReportingAccess();
  const ctx = currentContext();
  const { rows } = await withTenant(ctx, c => c.query(
    'select name, timezone from location where id=$1 and organization_id=$2',
    [ctx.locationId, ctx.organizationId]));
  if (!rows.length) throw new Error('Location not found');
  const location = rows[0] as { name: string; timezone: string };
  const params = await searchParams;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: location.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const from = asDay(params.from, new Date(Date.parse(today + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0, 10));
  const through = asDay(params.through, today);
  const range = localCalendarRange(from, through, location.timezone);
  const data = await storeOutcomes(ctx, range);
  const money = (v: string) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
  }).format(Number(v));
  const metrics = [
    { label: 'Completed fittings', value: data.completedFittings.toLocaleString() },
    { label: 'Sensor scans', value: data.scans.toLocaleString() },
    { label: 'Directly linked purchases', value: data.convertedFittings.toLocaleString() },
    { label: 'Direct conversion', value: data.directConversionPercent === null ? 'N/A' : data.directConversionPercent + '%' },
    { label: 'Store transactions', value: data.storeTransactions.toLocaleString() },
    { label: 'Store gross sales', value: money(data.storeGrossSales) },
    { label: 'Scan-associated transactions', value: data.linkedTransactions.toLocaleString() },
    { label: 'Scan-associated revenue', value: money(data.linkedRevenue) },
  ];
  return (
    <main className="max-w-[1200px] mx-auto p-8">
      <Link href="/" className="text-[14px] text-ink-muted hover:text-accent">← Dashboard</Link>
      <p className="overline mt-6">Stride Guide · Reporting</p>
      <h1 className="text-[34px] font-semibold mt-1">Store outcomes</h1>
      <p className="text-ink-secondary mt-2">{location.name} · {location.timezone}</p>
      <form method="get" className="card mt-6 flex flex-wrap items-end gap-4">
        <label className="text-[14px] font-medium">From
          <input name="from" type="date" required defaultValue={from}
            className="block mt-1 min-h-touch px-3 border border-line-strong rounded-control" />
        </label>
        <label className="text-[14px] font-medium">Through
          <input name="through" type="date" required defaultValue={through}
            className="block mt-1 min-h-touch px-3 border border-line-strong rounded-control" />
        </label>
        <button type="submit" className="btn-primary">Apply dates</button>
      </form>
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6"
        aria-label="Store reporting metrics">
        {metrics.map(m => (
          <div key={m.label} className="card">
            <p className="text-[13px] text-ink-secondary">{m.label}</p>
            <p className="text-[27px] font-semibold tabular-nums mt-2">{m.value}</p>
          </div>
        ))}
      </section>
      <div className="card mt-6">
        <h2 className="text-[18px] font-semibold">How to interpret this report</h2>
        <p className="text-[14px] text-ink-secondary mt-2">
          Direct conversion counts completed fittings linked to a verified, completed
          transaction through explicit attribution. One fitting counts once.
          Unlinked fittings are not proof of a lost sale. Scan-associated revenue
          is not incremental revenue caused by Stride Guide.
        </p>
        <p className="text-[13px] text-ink-muted mt-3">
          Store sales use transaction dates. Fittings and direct conversion use
          fitting completion dates. The selected calendar days are interpreted
          in the store’s local timezone. Monetary figures assume USD; mixed
          currency support requires currency-specific reporting.
        </p>
      </div>
      <p className="text-[13px] text-ink-muted mt-4">
        Development-only reporting preview. Production staff authentication and POS
        coverage validation are required before rollout.
      </p>
    </main>
  );
}
