/**
 * Normalized Stride Guide hardware state.
 *
 * The iPad is an interface. It does not own the hardware, does not speak to the
 * ESP32, and does not know what an ESP32 is. The transport is:
 *
 *     ESP32 → bridge → POST /api/hardware/telemetry → device_health_event
 *                                                          ↓
 *                    GET /api/kiosk/hardware ← kiosk polls ←┘
 *
 * Web Bluetooth is not on the table and never was: it does not exist in Safari
 * on any iOS version, let alone the 12.5 on an iPad mini 2. Nor does the kiosk
 * hold a socket — see the phase doc for why polling is the right transport for
 * this device. Either way the browser consumes the type below and nothing else,
 * so replacing the transport later touches this file and no screen.
 *
 * -- Two rules that keep this honest ------------------------------------------
 *
 * **Silence is not readiness.** A missing telemetry frame means `offline`, never
 * `unknown-but-probably-fine`. The staleness window below is what turns "we
 * have heard nothing for twelve seconds" into a state the UI can show, rather
 * than a stale green tick from two minutes ago.
 *
 * **The kiosk is told, not asked.** Readiness is computed here, server-side,
 * from what the hardware reported. A browser cannot assert that a foot is on
 * the plate; /api/kiosk/session/capture re-reads this rather than trusting the
 * client that just claimed it.
 */
import { withTenant, type TenantContext } from '../db/client';

/** How long a frame stays believable. Two seconds of jitter on a 5 Hz feed. */
export const STALE_AFTER_MS = 12_000;

export type SubsystemHealth = 'healthy' | 'degraded' | 'offline' | 'unknown';

/**
 * What the browser sees. Adapted from the shape in the kiosk brief to what this
 * schema can actually stand behind — `lastReadingAt` is the reported_at of a
 * real row, and every boolean is false unless a frame said otherwise.
 */
export interface HardwareStatus {
  connected: boolean;
  matrixReady: boolean;
  loadCellsReady: boolean;
  calibrationValid: boolean;
  leftFootDetected: boolean;
  rightFootDetected: boolean;
  weightStable: boolean;
  totalWeight?: number;
  lastReadingAt?: string;
  /** Seconds since the last frame. Associates see this; customers never do. */
  secondsSinceReading?: number;
  firmwareVersion?: string;
  calibrationVersion?: string;
  serial?: string;
  errorCode?: string;
  health: {
    link: SubsystemHealth;
    pressureMatrix: SubsystemHealth;
    loadCells: SubsystemHealth;
    calibration: SubsystemHealth;
  };
}

/** No unit bound, or no unit installed. Everything false, nothing invented. */
export function unknownHardware(): HardwareStatus {
  return {
    connected: false, matrixReady: false, loadCellsReady: false,
    calibrationValid: false, leftFootDetected: false, rightFootDetected: false,
    weightStable: false,
    health: { link: 'unknown', pressureMatrix: 'unknown', loadCells: 'unknown', calibration: 'unknown' },
  };
}

function bool(v: unknown): boolean { return v === true; }

/**
 * Turn one telemetry row into the normalized view.
 *
 * Exported so the tests can drive it without a database: the staleness rule is
 * the single most important behaviour in this file and it should not need
 * Postgres to assert.
 */
export function normalizeTelemetry(
  row: {
    reported_at: Date | string;
    component_status?: Record<string, unknown> | null;
    firmware_version?: string | null;
    calibration_version?: string | null;
    error_code?: string | null;
    serial?: string | null;
  } | null,
  now: number = Date.now(),
): HardwareStatus {
  if (!row) return unknownHardware();

  const reportedAt = new Date(row.reported_at);
  const age = now - reportedAt.getTime();
  const fresh = age >= 0 && age <= STALE_AFTER_MS;
  const cs = row.component_status ?? {};

  // Everything the hardware claimed is gated on the frame being current. A
  // stale frame is not partially true.
  const matrixReady = fresh && bool(cs.matrixReady);
  const loadCellsReady = fresh && bool(cs.loadCellsReady);
  const calibrationValid = fresh && bool(cs.calibrationValid);
  const weight = typeof cs.totalWeight === 'number' ? cs.totalWeight : undefined;

  const status: HardwareStatus = {
    connected: fresh,
    matrixReady,
    loadCellsReady,
    calibrationValid,
    leftFootDetected: fresh && bool(cs.leftFootDetected),
    rightFootDetected: fresh && bool(cs.rightFootDetected),
    weightStable: fresh && bool(cs.weightStable),
    lastReadingAt: reportedAt.toISOString(),
    secondsSinceReading: Math.round(age / 100) / 10,
    health: {
      link: fresh ? 'healthy' : 'offline',
      pressureMatrix: !fresh ? 'offline' : matrixReady ? 'healthy' : 'degraded',
      loadCells: !fresh ? 'offline' : loadCellsReady ? 'healthy' : 'degraded',
      // Calibration is the one subsystem whose bad state is not "offline": the
      // unit is talking, it just cannot be trusted to measure. That distinction
      // is the difference between "ask an associate for help" and "ask an
      // associate to run a setup check", which are different sentences on the
      // customer's screen.
      calibration: !fresh ? 'unknown' : calibrationValid ? 'healthy' : 'degraded',
    },
  };
  if (fresh && weight !== undefined) status.totalWeight = weight;
  if (row.firmware_version) status.firmwareVersion = row.firmware_version;
  if (row.calibration_version) status.calibrationVersion = row.calibration_version;
  if (row.error_code) status.errorCode = row.error_code;
  if (row.serial) status.serial = row.serial;
  return status;
}

/**
 * Read the current state of the Stride Guide unit bound to this kiosk.
 *
 * Runs under the kiosk's own tenant context, so the RLS policy added in 0016
 * scopes device_health_event through device_installation. A kiosk cannot read
 * another store's telemetry even by guessing a device id, because the device id
 * comes off its own row and is never an input.
 */
export async function readHardwareStatus(
  ctx: TenantContext, strideGuideDeviceId: string | null,
): Promise<HardwareStatus> {
  if (!strideGuideDeviceId) return unknownHardware();
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select e.reported_at, e.component_status, e.firmware_version,
              e.calibration_version, e.error_code, d.serial
         from device_health_event e
         join device d on d.id = e.device_id
        where e.device_id = $1
        order by e.reported_at desc limit 1`, [strideGuideDeviceId]);
    return normalizeTelemetry(rows[0] ?? null);
  });
}

/** Ready to begin a capture: talking, calibrated, both feet on, weight settled. */
export function isCaptureReady(s: HardwareStatus): boolean {
  return s.connected && s.matrixReady && s.loadCellsReady && s.calibrationValid
      && s.leftFootDetected && s.rightFootDetected && s.weightStable;
}

/**
 * Which machine event, if any, this hardware state forces.
 *
 * Order matters: a unit that is not talking cannot also be telling us its
 * calibration is bad, so the link is checked first.
 */
export function hardwareEvent(s: HardwareStatus): 'HARDWARE_LOST' | 'CALIBRATION_INVALID' | 'HARDWARE_OK' {
  if (!s.connected || !s.matrixReady || !s.loadCellsReady) return 'HARDWARE_LOST';
  if (!s.calibrationValid) return 'CALIBRATION_INVALID';
  return 'HARDWARE_OK';
}
