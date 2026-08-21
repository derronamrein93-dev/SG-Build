/**
 * POST /api/kiosk/session/abandon — void an unfinished fitting.
 *
 * Called by the reset routine on every path out of the flow that did not
 * complete: decline, timeout, error, associate reset. Best-effort by design —
 * the client wipes its own state whatever this returns, because a network
 * failure must never be a reason the next customer sees the previous one's data.
 */
import { handle, json, readJson, requireKiosk } from '../../../../../lib/kiosk/api';
import { abandonSession } from '../../../../../lib/kiosk/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('abandon', req, async () => {
    const identity = await requireKiosk(req);
    const body = await readJson<{ sessionId?: string; reason?: string }>(req);
    const reason = body.reason === 'mistaken_start' ? 'mistaken_start' : 'customer_withdrew';
    await abandonSession(identity, String(body.sessionId ?? ''), reason);
    return json({ ok: true });
  });
}
