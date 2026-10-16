import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../lib/reporting/access';
import { currentContext } from '../../../../lib/session';
import { ingestSale, type SaleInput } from '../../../../lib/reporting/ingest';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    assertReportingAccess();
    if (Number(req.headers.get('content-length') ?? 0) > 131072)
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    const body = await req.text();
    if (body.length > 131072) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    const input = JSON.parse(body) as SaleInput;
    const result = await ingestSale(currentContext(), input);
    return NextResponse.json(result, { status: result.inserted ? 201 : 200,
      headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && /Invalid|reconcile|required|contain|Only USD|Conflicting/.test(error.message))
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Sale ingestion unavailable' }, { status: 403 });
  }
}
