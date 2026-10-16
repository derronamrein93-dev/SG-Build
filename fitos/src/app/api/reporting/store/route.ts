import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../lib/reporting/access';
import { currentContext } from '../../../../lib/session';
import { withTenant } from '../../../../lib/db/client';
import { localCalendarRange } from '../../../../lib/reporting/dates';
import { storeOutcomes } from '../../../../lib/reporting/outcomes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    assertReportingAccess();
    const from = req.nextUrl.searchParams.get('from') ?? '';
    const through = req.nextUrl.searchParams.get('through') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(through))
      return NextResponse.json({ error: 'Use YYYY-MM-DD date filters' }, { status: 400 });
    const ctx = currentContext();
    const location = await withTenant(ctx, c => c.query(
      'select timezone from location where id=$1 and organization_id=$2',
      [ctx.locationId, ctx.organizationId]));
    if (!location.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const range = localCalendarRange(from, through, location.rows[0].timezone);
    const data = await storeOutcomes(ctx, range);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && /Invalid|366/.test(error.message))
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Reporting unavailable' }, { status: 403 });
  }
}
