/**
 * POST /api/kiosk/session/capture — record a Stride Guide capture.
 *
 * Readiness is re-read from telemetry inside `recordCapture`. The browser's
 * claim that both feet are on the plate is not an input to this endpoint; it is
 * a reason the customer tapped a button.
 */
import { handle, json, readJson, requireKiosk } from '../../../../../lib/kiosk/api';
import { recordCapture } from '../../../../../lib/kiosk/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('capture', req, async () => {
    const identity = await requireKiosk(req);
    const body = await readJson<{ sessionId?: string }>(req);
    const result = await recordCapture(identity, String(body.sessionId ?? ''));
    return json({ ok: true, captureQuality: result.captureQuality });
  });
}
