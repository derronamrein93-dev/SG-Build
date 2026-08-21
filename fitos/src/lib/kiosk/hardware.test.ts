/**
 * Hardware normalization, with no database.
 *
 * The staleness rule is the important one: a kiosk that shows a green tick from
 * a frame two minutes old is worse than one that shows nothing, because a
 * customer will step on the plate and the scan will fail for reasons nobody can
 * see. Everything below is a variation on "silence is not readiness".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTelemetry, unknownHardware, isCaptureReady, hardwareEvent, STALE_AFTER_MS,
} from './hardware';

const NOW = Date.parse('2026-03-01T12:00:00.000Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const READY = {
  matrixReady: true, loadCellsReady: true, calibrationValid: true,
  leftFootDetected: true, rightFootDetected: true, weightStable: true, totalWeight: 78.4,
};

test('H01 no unit bound is unknown, not offline and certainly not ready', () => {
  const s = unknownHardware();
  assert.equal(s.connected, false);
  assert.equal(s.health.link, 'unknown');
  assert.equal(isCaptureReady(s), false);
});

test('H02 a fresh, complete frame is capture-ready', () => {
  const s = normalizeTelemetry(
    { reported_at: at(400), component_status: READY, firmware_version: '0.4.2',
      calibration_version: 'cal-1', serial: 'SG-A19F' }, NOW);
  assert.equal(s.connected, true);
  assert.equal(isCaptureReady(s), true);
  assert.equal(s.totalWeight, 78.4);
  assert.equal(s.serial, 'SG-A19F');
  assert.equal(hardwareEvent(s), 'HARDWARE_OK');
});

test('H03 a stale frame is not partially true', () => {
  const s = normalizeTelemetry(
    { reported_at: at(STALE_AFTER_MS + 1), component_status: READY }, NOW);
  assert.equal(s.connected, false);
  // Every claim on the frame is dropped, not just the link.
  assert.equal(s.matrixReady, false);
  assert.equal(s.leftFootDetected, false);
  assert.equal(s.calibrationValid, false);
  assert.equal(s.totalWeight, undefined);
  assert.equal(isCaptureReady(s), false);
  assert.equal(hardwareEvent(s), 'HARDWARE_LOST');
});

test('H04 the staleness boundary is inclusive on the fresh side', () => {
  assert.equal(normalizeTelemetry({ reported_at: at(STALE_AFTER_MS), component_status: READY }, NOW).connected, true);
  assert.equal(normalizeTelemetry({ reported_at: at(STALE_AFTER_MS + 1), component_status: READY }, NOW).connected, false);
});

test('H05 a frame from the future is not trusted', () => {
  // Clock skew on a store network is real, and "reported 40 seconds from now"
  // is not evidence that anyone is standing on the plate.
  const s = normalizeTelemetry({ reported_at: at(-40_000), component_status: READY }, NOW);
  assert.equal(s.connected, false);
});

test('H06 an absent field is false, never assumed', () => {
  const s = normalizeTelemetry({ reported_at: at(100), component_status: {} }, NOW);
  assert.equal(s.matrixReady, false);
  assert.equal(s.weightStable, false);
  assert.equal(isCaptureReady(s), false);
});

test('H07 a talking but uncalibrated unit is degraded, not offline', () => {
  const s = normalizeTelemetry(
    { reported_at: at(200), component_status: { ...READY, calibrationValid: false } }, NOW);
  assert.equal(s.connected, true);
  assert.equal(s.health.link, 'healthy');
  assert.equal(s.health.calibration, 'degraded');
  // The distinction matters: "ask an associate for help" and "ask an associate
  // to run a setup check" are different sentences on the customer's screen.
  assert.equal(hardwareEvent(s), 'CALIBRATION_INVALID');
});

test('H08 one foot on the plate is not ready', () => {
  const s = normalizeTelemetry(
    { reported_at: at(200), component_status: { ...READY, rightFootDetected: false } }, NOW);
  assert.equal(isCaptureReady(s), false);
  // ...but the unit is fine, so the customer is asked to move, not to find help.
  assert.equal(hardwareEvent(s), 'HARDWARE_OK');
});

test('H09 unstable weight is not ready', () => {
  const s = normalizeTelemetry(
    { reported_at: at(200), component_status: { ...READY, weightStable: false } }, NOW);
  assert.equal(isCaptureReady(s), false);
});

test('H10 no frame at all is unknown', () => {
  const s = normalizeTelemetry(null, NOW);
  assert.equal(s.connected, false);
  assert.equal(s.health.pressureMatrix, 'unknown');
});

test('H11 a non-boolean truthy value does not count as true', () => {
  const s = normalizeTelemetry(
    { reported_at: at(200), component_status: { ...READY, leftFootDetected: 'yes' as any } }, NOW);
  assert.equal(s.leftFootDetected, false);
});
