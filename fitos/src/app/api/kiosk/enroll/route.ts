/**
 * POST /api/kiosk/enroll — redeem an enrollment code.
 *
 * The one endpoint that does NOT require a credential, because its whole job is
 * to issue one. The code is the authorization: short-lived, single-use, and
 * resolved by hash through the service role, keyed by nothing else.
 *
 * The credential goes back as an httpOnly cookie and is never in the response
 * body. A device code visible on a screen is fine; a long-lived credential
 * readable by `document.cookie` is not.
 */
import { handle, json, readJson, credentialCookie } from '../../../../lib/kiosk/api';
import { redeemEnrollmentCode, EnrollmentError } from '../../../../lib/kiosk/device';
import { KIOSK_APP_VERSION } from '../../../../lib/kiosk/service';
import { KioskError } from '../../../../lib/kiosk/errors';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('enroll', req, async () => {
    const body = await readJson<{ code?: string }>(req);
    try {
      const { credential, identity } = await redeemEnrollmentCode(
        String(body.code ?? ''), KIOSK_APP_VERSION);
      return json(
        // Deliberately thin: the device learns its own name and store, and
        // nothing about the tenant beyond what is printed on the door.
        { ok: true, deviceName: identity.displayName, locationName: identity.locationName,
          hasHardware: Boolean(identity.strideGuideDeviceId) },
        200, { 'set-cookie': credentialCookie(req, credential) });
    } catch (err) {
      // Every failure reason collapses to one code. "Expired" and "already
      // used" are useful to an associate and useful to someone guessing codes,
      // and the associate has FitOS in front of them.
      if (err instanceof EnrollmentError) throw new KioskError('enrollment_failed', 400, err.reason);
      throw err;
    }
  });
}
