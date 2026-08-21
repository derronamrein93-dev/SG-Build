/**
 * POST /api/kiosk/session/complete — run the recommendation and freeze the report.
 *
 * All of the expensive work in the product happens inside this one call, on the
 * server: rules, catalog matching, language composition, report snapshot. The
 * iPad's share is a POST and a render.
 *
 * The report's access token is minted here and deliberately not returned.
 */
import { handle, json, readJson, requireKiosk } from '../../../../../lib/kiosk/api';
import { completeSession } from '../../../../../lib/kiosk/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('complete', req, async () => {
    const identity = await requireKiosk(req);
    const body = await readJson<{ sessionId?: string }>(req);
    const out = await completeSession(identity, String(body.sessionId ?? ''));
    return json({ ok: true, ...out });
  });
}
