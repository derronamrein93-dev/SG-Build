/**
 * Stride Guide bridge simulator — DEVELOPMENT ONLY.
 *
 * Stands in for the ESP32 bridge so the kiosk flow can be walked end to end on a
 * desk. It posts to the same authenticated endpoint the real bridge does, with
 * the same payload, and it holds no privilege the real bridge does not: without
 * a valid ingest token it gets a 401 like anything else.
 *
 * It exists here, outside the application, and NOT as a switch inside the kiosk,
 * because a "simulate hardware" toggle in the kiosk UI is a toggle that ships.
 * With this script not running, the kiosk correctly shows HARDWARE_OFFLINE —
 * which is the true state of a store with no unit plugged in.
 *
 *   npm run kiosk:sim -- <ingest-token>            # feet on the plate, ready
 *   npm run kiosk:sim -- <ingest-token> --empty    # unit online, nobody on it
 *   npm run kiosk:sim -- <ingest-token> --uncal    # calibration invalid
 */
const BASE = process.env.SG_SIM_BASE ?? 'http://127.0.0.1:3000';

function frame(mode: string) {
  const ready = mode === 'ready';
  return {
    matrixReady: true,
    loadCellsReady: true,
    calibrationValid: mode !== 'uncal',
    leftFootDetected: ready,
    rightFootDetected: ready,
    weightStable: ready,
    totalWeight: ready ? 78.4 : 0,
    firmwareVersion: '0.4.2',
    calibrationVersion: 'cal-2024-11',
    signalQuality: 0.96,
    // A capture is only offered when a stable stance is actually being held.
    // Its absence is what makes /api/kiosk/session/capture fail honestly.
    capture: ready ? {
      rawUri: 'sg://sim/' + Date.now(),
      rawChecksum: 'sha256:' + Date.now().toString(16).padEnd(64, '0'),
      captureType: 'static_stance',
      sampleRateHz: 60,
      frameCount: 180,
      totalLoadMeasured: 78.4,
      captureQuality: 0.91,
      algorithmVersion: 'sim-0.1',
      derived: { arch_index: 0.24, contact_area_cm2: { left: 121.4, right: 124.9 } },
      // Measurements the bridge derived, in the assessment vocabulary FitOS
      // already uses. Allowlisted server-side in SCAN_ASSESSMENT_FIELDS.
      assessment: {
        size_left: 10.5, size_right: 11, width: 'wide',
        arch_type: 'low', pronation_tendency: 'overpronation',
      },
    } : undefined,
  };
}

async function main() {
  const token = process.argv[2];
  if (!token) { console.error('usage: npm run kiosk:sim -- <ingest-token> [--empty|--uncal]'); process.exit(2); }
  const mode = process.argv.includes('--empty') ? 'empty'
             : process.argv.includes('--uncal') ? 'uncal' : 'ready';
  console.log(`posting ${mode} frames to ${BASE}/api/hardware/telemetry every 2s — ctrl-c to stop`);
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/hardware/telemetry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(frame(mode)),
      });
      process.stdout.write(res.ok ? '.' : `[${res.status}]`);
    } catch {
      process.stdout.write('x');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main();
