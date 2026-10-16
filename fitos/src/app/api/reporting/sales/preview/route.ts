import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../../lib/reporting/access';
import { previewSalesCsv } from '../../../../../lib/reporting/importCsv';

export const dynamic = 'force-dynamic';

/** Read-only validation. Does not create a sale or update any customer. */
export async function POST(req: NextRequest) {
  try {
    assertReportingAccess();
    if (Number(req.headers.get('content-length') ?? 0) > 1048576)
      return NextResponse.json({ error: 'CSV exceeds 1 MiB' }, { status: 413 });
    const csv = await req.text();
    if (csv.length > 1048576)
      return NextResponse.json({ error: 'CSV exceeds 1 MiB' }, { status: 413 });
    const source = req.nextUrl.searchParams.get('source') ?? 'manual_csv';
    const sales = previewSalesCsv(csv, source);
    return NextResponse.json({
      valid: true,
      transactionCount: sales.length,
      lineCount: sales.reduce((n, sale) => n + sale.lines.length, 0),
      totalCents: sales.reduce((n, sale) => n + sale.totalCents, 0),
      // Preview excludes customer identifiers and product details.
      sampleTransactionIds: sales.slice(0, 5).map(sale => sale.externalTransactionId),
      note: 'Preview only. No transactions have been saved.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && /CSV|Invalid|Missing|Conflicting|reconcile|USD|required|timezone|Sale|transaction/.test(error.message))
      return NextResponse.json({ valid: false, error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'CSV preview unavailable' }, { status: 403 });
  }
}
