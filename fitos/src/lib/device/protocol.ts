/**
 * Stride Guide device wire contract v1 (USB CDC newline-delimited JSON).
 *
 * Pure validation only: NO device authentication, ingestion, persistence,
 * calibration, or clinical interpretation happens in this module.
 * Transport adapters MUST authenticate the station and resolve its tenant
 * server-side before accepting a scan. Device-supplied IDs are not authority.
 */
export const SG_PROTOCOL = 'sg.v1' as const;
export const MATRIX_ROWS = 24;
export const MATRIX_COLS = 24;
export const MATRIX_POINTS = MATRIX_ROWS * MATRIX_COLS;
export const MAX_LINE_BYTES = 16_384;

export type CaptureType = 'static_stance' | 'weight_shift' | 'walk';
export type DeviceState = 'unconfigured' | 'ready' | 'fault';

interface BaseFrame {
  protocol: typeof SG_PROTOCOL;
  kind: 'status' | 'scan';
  device_serial: string;
  sequence: number;
  uptime_ms: number;
  firmware_version: string;
  hardware_revision: string;
  calibration_version: string;
}

export interface StatusFrame extends BaseFrame {
  kind: 'status';
  state: DeviceState;
  error_code: string | null;
}

export interface ScanFrame extends BaseFrame {
  kind: 'scan';
  capture_type: CaptureType;
  rows: typeof MATRIX_ROWS;
  columns: typeof MATRIX_COLS;
  /** Raw unsigned 12-bit ADC counts, row-major. Not calibrated pressure. */
  matrix: number[];
  /** Four signed HX711 raw counts, not kilograms or pounds. */
  load_cells_raw: number[];
}

export type DeviceFrame = StatusFrame | ScanFrame;

export class DeviceProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceProtocolError';
  }
}

function fail(message: string): never { throw new DeviceProtocolError(message); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('frame must be an object');
  return value as Record<string, unknown>;
}
function keysOnly(frame: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(frame)) if (!allowed.includes(key)) fail('unexpected frame field');
}
function textField(value: unknown, label: string, max = 64): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max ||
      !/^[A-Za-z0-9._-]+$/.test(value)) fail('invalid ' + label);
  return value;
}
function uint(value: unknown, label: string, max = 0xffffffff): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail('invalid ' + label);
  return value;
}
function signed32(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) ||
      value < -2147483648 || value > 2147483647) fail('invalid ' + label);
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail('invalid ' + label);
  return value as T;
}

const COMMON = ['protocol','kind','device_serial','sequence','uptime_ms',
  'firmware_version','hardware_revision','calibration_version'];
const STATUS_FIELDS = [...COMMON,'state','error_code'];
const SCAN_FIELDS = [...COMMON,'capture_type','rows','columns','matrix','load_cells_raw'];

/** Parses exactly one line. Never accepts customer data or arbitrary fields. */
export function parseDeviceFrame(line: string): DeviceFrame {
  if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES)
    fail('frame too large');
  let decoded: unknown;
  try { decoded = JSON.parse(line); } catch { return fail('invalid JSON'); }
  const f = record(decoded);
  if (f.protocol !== SG_PROTOCOL) fail('unsupported protocol version');
  const kind = oneOf(f.kind, ['status','scan'] as const, 'kind');
  keysOnly(f, kind === 'status' ? STATUS_FIELDS : SCAN_FIELDS);
  const base = {
    protocol: SG_PROTOCOL,
    kind,
    device_serial: textField(f.device_serial, 'device_serial'),
    sequence: uint(f.sequence, 'sequence'),
    uptime_ms: uint(f.uptime_ms, 'uptime_ms'),
    firmware_version: textField(f.firmware_version, 'firmware_version'),
    hardware_revision: textField(f.hardware_revision, 'hardware_revision'),
    calibration_version: textField(f.calibration_version, 'calibration_version'),
  };
  if (kind === 'status') {
    const state = oneOf(f.state, ['unconfigured','ready','fault'] as const, 'state');
    const error_code = f.error_code === null ? null : textField(f.error_code, 'error_code');
    if (state === 'fault' && error_code === null) fail('fault requires error_code');
    return { ...base, kind, state, error_code };
  }
  const capture_type = oneOf(f.capture_type, ['static_stance','weight_shift','walk'] as const, 'capture_type');
  if (f.rows !== MATRIX_ROWS || f.columns !== MATRIX_COLS) fail('unexpected matrix geometry');
  if (!Array.isArray(f.matrix) || f.matrix.length !== MATRIX_POINTS) fail('invalid matrix length');
  const matrix = f.matrix.map((v: unknown) => uint(v, 'matrix value', 4095));
  if (!Array.isArray(f.load_cells_raw) || f.load_cells_raw.length !== 4) fail('invalid load cell count');
  const load_cells_raw = f.load_cells_raw.map((v: unknown) => signed32(v, 'load cell count'));
  return { ...base, kind, capture_type, rows: MATRIX_ROWS, columns: MATRIX_COLS, matrix, load_cells_raw };
}

/**
 * Strict serial line framing. One instance per physical connection.
 * The caller must handle disconnects, monotonic sequence checks, reconnect
 * and authenticated delivery. Never persist raw frames from this helper.
 */
export class DeviceLineDecoder {
  private pending = '';
  push(chunk: string): DeviceFrame[] {
    this.pending += chunk;
    if (Buffer.byteLength(this.pending, 'utf8') > MAX_LINE_BYTES * 2) {
      this.pending = '';
      fail('serial buffer exceeded limit');
    }
    const result: DeviceFrame[] = [];
    let newline: number;
    while ((newline = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, newline).replace(/\r$/, '');
      this.pending = this.pending.slice(newline + 1);
      if (line.trim()) result.push(parseDeviceFrame(line));
    }
    if (Buffer.byteLength(this.pending, 'utf8') > MAX_LINE_BYTES) {
      this.pending = '';
      fail('unterminated frame exceeded limit');
    }
    return result;
  }
  reset(): void { this.pending = ''; }
}
