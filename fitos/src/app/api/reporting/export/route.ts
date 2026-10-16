import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../lib/reporting/access';
import { currentContext } from '../../../../lib/session';
import { withTenant } from '../../../../lib/db/client';
import { localCalendarRange } from '../../../../lib/reporting/dates';
import { storeOutcomes } from '../../../../lib/reporting/outcomes';
import { csvRows } from '../../../../lib/reporting/csv';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    assertReportingAccess();
    const from = req.nextUrl.searchParams.get('from') ?? '';
    const through = req.nextUrl.searchParams.get('through') ?? '';
    const ctx = currentContext();
    const location = await withTenant(ctx, c => c.query(
      'select timezone from location where id=$1 and organization_id=$2',
      [ctx.locationId, ctx.organizationId]));
    if (!location.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const range = localCalendarRange(from, through, location.rows[0].timezone);
    const data = await storeOutcomes(ctx, range);
    const csv = csvRows([
      ['metric','value','start_utc','end_utc'],
      ['completed_fittings',data.completedFittings,data.start,data.end],
      ['sensor_scans',data.scans,data.start,data.end],
      ['directly_converted_fittings',data.convertedFittings,data.start,data.end],
      ['direct_conversion_percent',data.directConversionPercent ?? '',data.start,data.end],
      ['linked_transactions',data.linkedTransactions,data.start,data.end],
      ['linked_revenue_usd',data.linkedRevenue,data.start,data.end],
      ['store_transactions',data.storeTransactions,data.start,data.end],
      ['store_sales_including_tax_usd',data.storeGrossSales,data.start,data.end],
      ['refund_events',data.refundEvents,data.start,data.end],
      ['refunded_total_usd',data.refundedTotal,data.start,data.end],
      ['period_net_receipts_usd',data.periodNetReceipts,data.start,data.end],
    ]);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="fitos-store-report.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Export unavailable' }, { status: 403 });
  }
}
