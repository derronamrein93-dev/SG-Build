/**
 * GET /api/kiosk/hardware — normalized Stride Guide state.
 *
 * Polled at 2 Hz while a customer is being positioned, and not at all otherwise.
 * The response is the customer-safe subset: booleans and a health word. Serial
 * numbers, firmware versions and frame ages are in the service payload, behind
 * the associate PIN.
 */
import { handle, json, requireKiosk } from '../../../../lib/kiosk/api';
import { kioskHardware } from '../../../../lib/kiosk/session';
import { isCaptureReady, hardwareEvent } from '../../../../lib/kiosk/hardware';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle('hardware', req, async () => {
    const identity = await requireKiosk(req);
    const s = await kioskHardware(identity);
    return json({
      ok: true,
      hardware: {
        connected: s.connected,
        leftFootDetected: s.leftFootDetected,
        rightFootDetected: s.rightFootDetected,
        weightStable: s.weightStable,
        calibrationValid: s.calibrationValid,
        ready: isCaptureReady(s),
      },
      event: hardwareEvent(s),
    });
  });
}
