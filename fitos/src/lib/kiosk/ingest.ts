/**
 * Stride Guide telemetry ingest.
 *
 * The ESP32 does not talk to the iPad and the iPad does not talk to the ESP32.
 * A bridge on the store network posts normalized frames here; the kiosk reads
 * the result back through /api/kiosk/hardware. That indirection is not
 * fastidiousness — Web Bluetooth does not exist in Safari on any iOS
 * version, and even if it did, putting hardware session state in a browser that
 * the OS may evict at any moment is how a fitting ends up in an unknown state.
 *
 * -- What authenticates a frame -------------------------------------------------
 *
 * The INSTALLATION, not the organization. `device_installation` is the row that
 * says "this unit, at this door, since this date", so a token lifted off a bench
 * unit cannot speak for a store, and retiring a unit (setting `removed_at`)
 * silences it without touching any other credential.
 *
 * Resolution is by token hash and nothing else, through the service role — the
 * bridge has no tenant context to run under, exactly like the report token path.
 * The organization and location come off the resolved row.
 */
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { withService, withTenant, type TenantContext } from '../db/client';
import { KioskError } from './errors';
import type { TelemetryCapture } from './session';

function sha256(v: string): Buffer { return createHash('sha256').update(v).digest(); }

export interface InstallationIdentity {
  installationId: string;
  deviceId: string;
  organizationId: string;
  locationId: string;
  serial: string;
}

/**
 * Mint an ingest token for an installed unit. Returns the plaintext once.
 * Runs under the caller's tenant context, so the installation must be theirs.
 */
export async function provisionIngestToken(
  ctx: TenantContext, deviceId: string,
): Promise<string> {
  const installationId = await withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select id from device_installation
        where device_id = $1 and location_id = $2 and removed_at is null limit 1`,
      [deviceId, ctx.locationId]);
    if (!rows.length) throw new KioskError('invalid_state', 404, 'no live installation');
    return rows[0].id as string;
  });
  const token = randomBytes(32).toString('base64url');
  await withService(async (c) => {
    await c.query('update device_installation set ingest_token_hash = $2 where id = $1',
      [installationId, sha256(token)]);
  });
  return token;
}

/** Resolve a bearer token to the installation it belongs to. Fails closed. */
export async function resolveInstallation(token: string | null | undefined)
  : Promise<InstallationIdentity | null> {
  if (!token || token.length < 32) return null;
  const hash = sha256(token);
  return withService(async (c) => {
    const { rows } = await c.query(
      `select i.id, i.device_id, i.organization_id, i.location_id, i.ingest_token_hash, d.serial
         from device_installation i join device d on d.id = i.device_id
        where i.ingest_token_hash = $1 and i.removed_at is null limit 1`, [hash]);
    if (!rows.length) return null;
    const stored = rows[0].ingest_token_hash as Buffer;
    if (stored.length !== hash.length || !timingSafeEqual(stored, hash)) return null;
    return {
      installationId: rows[0].id,
      deviceId: rows[0].device_id,
      organizationId: rows[0].organization_id,
      locationId: rows[0].location_id,
      serial: rows[0].serial,
    };
  });
}

/**
 * The frame contract. Everything is optional except the booleans that describe
 * readiness, and everything absent is treated as false — a bridge that omits a
 * field is not asserting anything.
 */
export interface TelemetryFrame {
  matrixReady?: boolean;
  loadCellsReady?: boolean;
  calibrationValid?: boolean;
  leftFootDetected?: boolean;
  rightFootDetected?: boolean;
  weightStable?: boolean;
  totalWeight?: number;
  firmwareVersion?: string;
  calibrationVersion?: string;
  signalQuality?: number;
  errorCode?: string;
  /**
   * A completed capture, if the bridge has one for the stance currently held.
   * Its presence is what makes /api/kiosk/session/capture succeed; its absence
   * is what makes that endpoint fail honestly instead of inventing a scan.
   */
  capture?: TelemetryCapture;
}

function bool(v: unknown): boolean { return v === true; }
function num(v: unknown): number | undefined { return typeof v === 'number' && isFinite(v) ? v : undefined; }
function str(v: unknown, max = 64): string | undefined {
  return typeof v === 'string' && v.length ? v.slice(0, max) : undefined;
}

/**
 * Normalize an untrusted frame into the shape stored on `component_status`.
 *
 * Everything is copied field by field. The frame never becomes a jsonb blob the
 * bridge controls the keys of, because `component_status` is read back by
 * `recordCapture` and turned into database rows.
 */
export function normalizeFrame(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    matrixReady: bool(raw.matrixReady),
    loadCellsReady: bool(raw.loadCellsReady),
    calibrationValid: bool(raw.calibrationValid),
    leftFootDetected: bool(raw.leftFootDetected),
    rightFootDetected: bool(raw.rightFootDetected),
    weightStable: bool(raw.weightStable),
  };
  const weight = num(raw.totalWeight);
  if (weight !== undefined) out.totalWeight = weight;
  const signal = num(raw.signalQuality);
  if (signal !== undefined) out.signalQuality = signal;

  const cap = raw.capture as Record<string, unknown> | undefined;
  if (cap && typeof cap === 'object' && str(cap.rawUri, 500) && str(cap.rawChecksum, 200)) {
    const captureType = ['static_stance', 'weight_shift', 'walk'].indexOf(String(cap.captureType)) >= 0
      ? String(cap.captureType) : 'static_stance';
    const capture: Record<string, unknown> = {
      rawUri: str(cap.rawUri, 500),
      rawChecksum: str(cap.rawChecksum, 200),
      captureType,
    };
    for (const [key, value] of [['sampleRateHz', num(cap.sampleRateHz)],
                                ['frameCount', num(cap.frameCount)],
                                ['totalLoadMeasured', num(cap.totalLoadMeasured)],
                                ['captureQuality', num(cap.captureQuality)]] as const) {
      if (value !== undefined) capture[key] = value;
    }
    const algo = str(cap.algorithmVersion, 40);
    if (algo) capture.algorithmVersion = algo;
    if (cap.derived && typeof cap.derived === 'object' && !Array.isArray(cap.derived)) {
      capture.derived = cap.derived;
    }
    if (cap.assessment && typeof cap.assessment === 'object' && !Array.isArray(cap.assessment)) {
      capture.assessment = cap.assessment;
    }
    out.capture = capture;
  }
  return out;
}

/** Store one frame. Append-only: telemetry is a log, not a current-value row. */
export async function recordTelemetry(
  installation: InstallationIdentity, raw: Record<string, unknown>,
): Promise<void> {
  const component = normalizeFrame(raw);
  await withService(async (c) => {
    await c.query(
      `insert into device_health_event
        (device_id, event_type, firmware_version, calibration_version, connectivity,
         signal_quality, component_status, error_code)
       values ($1,'status',$2,$3,'online',$4,$5,$6)`,
      [installation.deviceId, str(raw.firmwareVersion, 40) ?? null,
       str(raw.calibrationVersion, 40) ?? null, num(raw.signalQuality) ?? null,
       component, str(raw.errorCode, 60) ?? null]);
  });
}
