/**
 * POST /api/kiosk/session — begin a fitting.
 *
 * The first write of the flow, and it only happens on an explicit consent
 * grant. There is no endpoint that starts a session without one.
 */
import { handle, json, readJson, requireKiosk } from '../../../../lib/kiosk/api';
import { beginSession } from '../../../../lib/kiosk/session';
import { KioskError } from '../../../../lib/kiosk/errors';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('session', req, async () => {
    const identity = await requireKiosk(req);
    const body = await readJson<Record<string, unknown>>(req);
    const mode = body.mode === 'guest' ? 'guest' : 'identified';
    if (mode === 'identified' && body.consentFitHistory !== true) {
      throw new KioskError('consent_required', 403);
    }
    const ref = await beginSession(identity, {
      mode,
      phone: typeof body.phone === 'string' ? body.phone : undefined,
      firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
      lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
      consentFitHistory: body.consentFitHistory === true,
      consentReceiveReport: body.consentReceiveReport === true,
    });
    return json({ ok: true, ...ref, hasHardware: Boolean(identity.strideGuideDeviceId) });
  });
}
