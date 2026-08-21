/**
 * POST /api/kiosk/session/deliver — request the fit report.
 *
 * Gated on `receive_report` consent through the hasConsent() chokepoint, and it
 * returns a masked destination rather than a link: the report URL is a bearer
 * secret and this is a shared device.
 */
import { handle, json, readJson, requireKiosk } from '../../../../../lib/kiosk/api';
import { deliverResults } from '../../../../../lib/kiosk/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('deliver', req, async () => {
    const identity = await requireKiosk(req);
    const body = await readJson<{ sessionId?: string }>(req);
    const out = await deliverResults(identity, String(body.sessionId ?? ''));
    return json({ ok: true, ...out });
  });
}
