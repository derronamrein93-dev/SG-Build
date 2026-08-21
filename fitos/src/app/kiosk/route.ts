/**
 * GET /kiosk — the customer-facing terminal.
 *
 * A Route Handler rather than a page, because this document must not carry the
 * App Router client runtime. See src/lib/kiosk/html.ts for the measurement that
 * decision rests on.
 *
 * The only thing this route decides is enrolled vs not. Everything else the
 * kiosk needs it asks for over /api/kiosk/*, so this response contains no
 * customer data at any point in its life and is safe to be the thing a stale
 * back-navigation lands on.
 */
import { renderKioskDocument, DEFAULT_KIOSK_CONFIG } from '../../lib/kiosk/html';
import { KIOSK_APP_VERSION } from '../../lib/kiosk/service';
import { resolveKioskDevice, KIOSK_COOKIE } from '../../lib/kiosk/device';
import { readCookie } from '../../lib/kiosk/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  let identity = null;
  try {
    identity = await resolveKioskDevice(readCookie(req, KIOSK_COOKIE));
  } catch (err) {
    // A database that is down must still render a kiosk. It comes up
    // unenrolled, the associate panel says why, and nothing crashes on a
    // pedestal in a shop window.
    console.error('[kiosk:shell] identity resolution failed', err);
  }

  const html = renderKioskDocument({
    enrolled: Boolean(identity),
    appVersion: KIOSK_APP_VERSION,
    deviceName: identity?.displayName ?? null,
    locationName: identity?.locationName ?? null,
    hasHardware: Boolean(identity?.strideGuideDeviceId),
    config: DEFAULT_KIOSK_CONFIG,
  });

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      // The kiosk is not a page anyone should frame, and Guided Access does not
      // stop a nested browsing context inside the page itself.
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}
