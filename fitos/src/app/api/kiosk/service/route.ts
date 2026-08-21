/**
 * POST /api/kiosk/service — associate diagnostics, behind a PIN.
 *
 * One endpoint, one action per call, because the PIN is checked on every one:
 * there is no "service session" to steal, and closing the panel leaves nothing
 * behind that could reopen it.
 */
import { handle, json, readJson, requireKiosk } from '../../../../lib/kiosk/api';
import { authenticateAssociate, buildDiagnostics } from '../../../../lib/kiosk/service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('service', req, async () => {
    const identity = await requireKiosk(req);
    const body = await readJson<{ pin?: string }>(req);
    await authenticateAssociate(identity, String(body.pin ?? ''));
    return json({ ok: true, diagnostics: await buildDiagnostics(identity) });
  });
}
