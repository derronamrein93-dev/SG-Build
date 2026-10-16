import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../lib/reporting/access';
import { currentContext } from '../../../../lib/session';
import { linkFittingSale } from '../../../../lib/reporting/attribution';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    assertReportingAccess();
    if (Number(req.headers.get('content-length') ?? 0) > 8192)
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    const body = await req.text();
    if (body.length > 8192) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    const input = JSON.parse(body) as { fittingId?: string; saleId?: string };
    const result = await linkFittingSale(currentContext(), input.fittingId ?? '', input.saleId ?? '');
    return NextResponse.json(result, { status: result.linked ? 201 : 200,
      headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && /Invalid|mismatch|required/.test(error.message))
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Attribution unavailable' }, { status: 403 });
  }
}
