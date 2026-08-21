/**
 * The state machine, exhaustively.
 *
 * Two properties matter more than any individual transition and are asserted
 * over the whole table rather than case by case:
 *
 *   - every state can reach IDLE
 *   - no state that can hold customer data lacks a way to reset
 *
 * Those are the ones that stop being true when someone adds a state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIOSK_STATES, KIOSK_EVENTS, TRANSITIONS, initial, apply, can, holdsCustomerData,
  type KioskState, type MachineState,
} from './machine';

const at = (state: KioskState): MachineState => ({ state, resumeFrom: null });

test('K01 an unenrolled device starts unenrolled, an enrolled one starts idle', () => {
  assert.equal(initial(false).state, 'UNENROLLED');
  assert.equal(initial(true).state, 'IDLE');
});

test('K02 the expected normal flow walks end to end', () => {
  let m = initial(true);
  const walk: Array<[Parameters<typeof apply>[1], KioskState]> = [
    ['START', 'IDENTIFICATION'],
    ['IDENTIFIED', 'CONSENT'],
    ['CONSENT_GRANTED', 'INTAKE'],
    ['INTAKE_DONE', 'HARDWARE_READY'],
    ['CAPTURE_START', 'CAPTURING'],
    ['CAPTURE_OK', 'PROCESSING'],
    ['PROCESSING_OK', 'RESULTS'],
    ['DELIVER_OPEN', 'DELIVERY'],
    ['DELIVER_DONE', 'COMPLETE'],
    ['FINISH', 'RESETTING'],
    ['RESET_DONE', 'IDLE'],
  ];
  for (const [event, expected] of walk) {
    const next = apply(m, event);
    assert.ok(next, `${event} should be legal in ${m.state}`);
    assert.equal(next!.state, expected);
    m = next!;
  }
});

test('K03 invalid transitions are rejected, not coerced', () => {
  assert.equal(apply(at('IDLE'), 'CAPTURE_START'), null);
  assert.equal(apply(at('IDLE'), 'PROCESSING_OK'), null);
  assert.equal(apply(at('IDENTIFICATION'), 'INTAKE_DONE'), null);
  assert.equal(apply(at('CONSENT'), 'CAPTURE_START'), null);
  assert.equal(apply(at('RESULTS'), 'START'), null);
  assert.equal(apply(at('UNENROLLED'), 'START'), null);
});

test('K04 consent is the only door into the fitting body', () => {
  // Nothing reaches INTAKE except CONSENT_GRANTED from CONSENT.
  const doors: Array<[KioskState, string]> = [];
  for (const state of KIOSK_STATES) {
    for (const event of KIOSK_EVENTS) {
      if (TRANSITIONS[state][event] === 'INTAKE') doors.push([state, event]);
    }
  }
  assert.deepEqual(doors, [['CONSENT', 'CONSENT_GRANTED']]);
});

test('K05 declining consent leads out of the flow, never onward', () => {
  assert.equal(apply(at('CONSENT'), 'CONSENT_DECLINED')!.state, 'RESETTING');
});

test('K06 every state can reach IDLE', () => {
  for (const start of KIOSK_STATES) {
    const seen = new Set<KioskState>([start]);
    const queue: KioskState[] = [start];
    let reached = false;
    while (queue.length && !reached) {
      const state = queue.shift()!;
      if (state === 'IDLE') { reached = true; break; }
      for (const event of KIOSK_EVENTS) {
        const next = TRANSITIONS[state][event];
        if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    assert.ok(reached, `${start} cannot reach IDLE`);
  }
});

test('K07 every state holding customer data can be reset in one event', () => {
  for (const state of KIOSK_STATES) {
    if (!holdsCustomerData(state)) continue;
    assert.equal(apply(at(state), 'RESET')!.state, 'RESETTING',
      `${state} holds customer data but cannot RESET`);
  }
});

test('K08 RESETTING is the only way into IDLE', () => {
  for (const state of KIOSK_STATES) {
    for (const event of KIOSK_EVENTS) {
      if (TRANSITIONS[state][event] === 'IDLE') {
        assert.ok(state === 'RESETTING' || state === 'ENROLLING',
          `${state} reaches IDLE directly via ${event}`);
      }
    }
  }
});

test('K09 server processing is never timed out', () => {
  assert.equal(apply(at('PROCESSING'), 'TIMEOUT'), null);
  // ...but every other customer-facing state is.
  for (const state of ['IDENTIFICATION', 'CONSENT', 'INTAKE', 'HARDWARE_READY',
                       'CAPTURING', 'RESULTS', 'DELIVERY'] as KioskState[]) {
    assert.equal(apply(at(state), 'TIMEOUT')!.state, 'SESSION_TIMEOUT', state);
  }
});

test('K10 a network drop returns to where it happened, and nowhere else', () => {
  const dropped = apply(at('RESULTS'), 'NETWORK_LOST')!;
  assert.equal(dropped.state, 'NETWORK_OFFLINE');
  assert.equal(dropped.resumeFrom, 'RESULTS');
  assert.equal(apply(dropped, 'NETWORK_BACK')!.state, 'RESULTS');

  // NETWORK_BACK is inert anywhere else, and inert without a recorded origin.
  assert.equal(apply(at('RESULTS'), 'NETWORK_BACK'), null);
  assert.equal(apply(at('NETWORK_OFFLINE'), 'NETWORK_BACK'), null);
});

test('K11 resumeFrom does not survive an unrelated transition', () => {
  const dropped = apply(at('CONSENT'), 'NETWORK_LOST')!;
  const reset = apply(dropped, 'RESET')!;
  assert.equal(reset.resumeFrom, null);
});

test('K12 service mode has no door back into a customer session', () => {
  assert.equal(apply(at('SERVICE'), 'SERVICE_CLOSE')!.state, 'RESETTING');
  // Whatever the exit — closing the panel, an associate resetting, a revoked
  // credential — it leads to a wipe or to the unenrolled screen. An associate
  // must never be able to hand a half-finished fitting back to a customer
  // through a door the customer did not use.
  for (const event of KIOSK_EVENTS) {
    const next = TRANSITIONS.SERVICE[event];
    if (!next) continue;
    assert.ok(next === 'RESETTING' || next === 'UNENROLLED',
      `SERVICE --${event}--> ${next} re-enters the flow`);
  }
});

test('K13 service mode is reachable from every screen a person stands at', () => {
  for (const state of ['IDLE', 'IDENTIFICATION', 'CONSENT', 'INTAKE', 'HARDWARE_READY',
                       'RESULTS', 'HARDWARE_OFFLINE', 'SCAN_FAILED', 'NETWORK_OFFLINE',
                       'SESSION_TIMEOUT'] as KioskState[]) {
    assert.ok(can(at(state), 'SERVICE_OPEN'), `${state} cannot open service mode`);
  }
});

test('K14 hardware faults recover to the readiness screen, not into a capture', () => {
  for (const state of ['HARDWARE_OFFLINE', 'CALIBRATION_REQUIRED', 'SCAN_FAILED'] as KioskState[]) {
    assert.equal(apply(at(state), 'HARDWARE_OK')!.state, 'HARDWARE_READY');
    assert.equal(apply(at(state), 'CAPTURE_START'), null);
  }
});

test('K15 a revoked credential drops the device out of service from anywhere', () => {
  for (const state of KIOSK_STATES) {
    if (state === 'UNENROLLED' || state === 'ENROLLING') continue;
    assert.equal(apply(at(state), 'REVOKED')!.state, 'UNENROLLED', state);
  }
});

test('K16 an unenrolled device can do exactly one thing', () => {
  const allowed = KIOSK_EVENTS.filter((e) => TRANSITIONS.UNENROLLED[e]);
  assert.deepEqual(allowed, ['ENROLL_START']);
});

test('K17 every transition target is a real state', () => {
  for (const state of KIOSK_STATES) {
    for (const event of KIOSK_EVENTS) {
      const next = TRANSITIONS[state][event];
      if (next) assert.ok(KIOSK_STATES.indexOf(next) >= 0, `${state} --${event}--> ${next}`);
    }
  }
});

test('K18 the table is JSON-serializable, because the browser is handed it', () => {
  const round = JSON.parse(JSON.stringify(TRANSITIONS));
  assert.deepEqual(round, TRANSITIONS);
});
