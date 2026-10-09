import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceLineDecoder, DeviceProtocolError, MATRIX_POINTS, parseDeviceFrame } from './protocol';

const common = {
  protocol: 'sg.v1', device_serial: 'SG-001', sequence: 42,
  uptime_ms: 10000, firmware_version: '0.1.0', hardware_revision: 'pending',
  calibration_version: 'none',
};
const status = { ...common, kind: 'status', state: 'unconfigured', error_code: null };
const scan = {
  ...common, kind: 'scan', capture_type: 'static_stance',
  rows: 24, columns: 24, matrix: Array(MATRIX_POINTS).fill(123),
  load_cells_raw: [100, -200, 300, -400],
};
const parse = (v: unknown) => parseDeviceFrame(JSON.stringify(v));

test('DV01 valid unconfigured heartbeat is accepted', () => {
  assert.deepEqual(parse(status), status);
});
test('DV02 complete raw scan accepted without treating ADC counts as pressure', () => {
  const result = parse(scan);
  assert.equal(result.kind, 'scan');
  if (result.kind === 'scan') assert.equal(result.matrix.length, 576);
});
test('DV03 reject truncated or wrong-geometry matrices', () => {
  assert.throws(() => parse({ ...scan, matrix: [1] }), DeviceProtocolError);
  assert.throws(() => parse({ ...scan, rows: 25 }), DeviceProtocolError);
});
test('DV04 reject non-finite, negative and out-of-range ADC counts', () => {
  for (const value of [-1, 4096, 1.5, null, '5']) {
    const matrix = [...scan.matrix]; matrix[17] = value as number;
    assert.throws(() => parse({ ...scan, matrix }), DeviceProtocolError);
  }
});
test('DV05 reject wrong load cell count and invalid raw counts', () => {
  assert.throws(() => parse({ ...scan, load_cells_raw: [1, 2] }), DeviceProtocolError);
  assert.throws(() => parse({ ...scan, load_cells_raw: [1, 2, 3, 2147483648] }), DeviceProtocolError);
});
test('DV06 reject unrecognized protocol and unsolicited customer identity', () => {
  assert.throws(() => parse({ ...status, protocol: 'sg.v2' }), DeviceProtocolError);
  assert.throws(() => parse({ ...status, phone_number: '5551231234' }), DeviceProtocolError);
});
test('DV07 fault requires an error code', () => {
  assert.throws(() => parse({ ...status, state: 'fault' }), DeviceProtocolError);
  assert.equal(parse({ ...status, state: 'fault', error_code: 'ADC_OFFLINE' }).kind, 'status');
});
test('DV08 partial serial lines and CRLF are reassembled', () => {
  const decoder = new DeviceLineDecoder();
  const line = JSON.stringify(status);
  assert.deepEqual(decoder.push(line.slice(0, 19)), []);
  assert.deepEqual(decoder.push(line.slice(19) + '\r\n'), [status]);
});
test('DV09 multiple serial lines can be decoded together', () => {
  const decoder = new DeviceLineDecoder();
  assert.equal(decoder.push(JSON.stringify(status) + '\n' + JSON.stringify(status) + '\n').length, 2);
});
test('DV10 oversized input fails closed and decoder can recover', () => {
  const decoder = new DeviceLineDecoder();
  assert.throws(() => decoder.push('x'.repeat(17000)), DeviceProtocolError);
  decoder.reset();
  assert.equal(decoder.push(JSON.stringify(status) + '\n').length, 1);
});
test('DV11 invalid sequence, uptime and metadata fail', () => {
  assert.throws(() => parse({ ...status, sequence: -1 }), DeviceProtocolError);
  assert.throws(() => parse({ ...status, uptime_ms: 1.2 }), DeviceProtocolError);
  assert.throws(() => parse({ ...status, device_serial: 'SG 001' }), DeviceProtocolError);
});
test('DV12 status is not mistaken for a calibrated scan', () => {
  const frame = parse(status);
  assert.equal(frame.kind, 'status');
  assert.equal('matrix' in frame, false);
});
