/**
 * POST /api/hardware/telemetry — the Stride Guide bridge's only endpoint.
 *
 *   Authorization: Bearer <installation ingest token>
 *   { matrixReady, loadCellsReady, calibrationValid, leftFootDetected,
 *     rightFootDetected, weightStable, totalWeight?, firmwareVersion?,
 *     calibrationVersion?, errorCode?, capture? }
 *
 * Not under /api/kiosk: this is not the kiosk speaking, it is the hardware, and
 * the two authenticate differently. Keeping them apart means a kiosk credential
 * can never be used to forge a hardware frame — which is precisely the thing
 * that would let a browser fake readiness.
 */
import { resolveInstallation, recordTelemetry } from '../../../../lib/kiosk/ingest';

export const dynamic = 'force-dynamic';

function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  return header.slice(0, 7).toLowerCase() === 'bearer ' ? header.slice(7).trim() : null;
}

export async function POST(req: Request): Promise<Response> {
  const installation = await resolveInstallation(bearer(req));
  if (!installation) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  try {
    await recordTelemetry(installation, body);
  } catch (err) {
    console.error('[hardware:telemetry] write failed', err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
