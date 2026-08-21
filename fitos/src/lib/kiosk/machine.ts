/**
 * The kiosk state machine.
 *
 * A retail kiosk is not a website with pages. It is one device, driven by
 * strangers, that must never show customer B what customer A left on the
 * screen. Loose page navigation cannot make that guarantee: every `<a href>` is
 * a transition nobody wrote down, and Back is a transition nobody wrote down at
 * all.
 *
 * So the flow is a table, and the table is the only way to move.
 *
 * Two design choices are worth stating, because they are what make the
 * guarantee hold rather than merely make it likely:
 *
 * 1. **Transitions are driven by EVENTS, not by target states.** `apply(m,
 *    'CONSENT_GRANTED')` either produces the one state that follows, or is
 *    rejected. There is no `goTo(state)` for a caller to misuse, so an invalid
 *    transition is not something to remember not to write — it is something
 *    there is no way to express.
 *
 * 2. **The table is data, and the browser is given the data rather than a
 *    second copy of the logic.** `/kiosk` serializes TRANSITIONS into the page
 *    and the ES5 client enforces it generically. One source of truth, checked
 *    by the tests in this directory, running unchanged on a 2013 iPad.
 *
 * Nothing here imports anything. It runs identically on the server, under
 * node:test, and — as JSON — in Safari 12.
 */

/** Primary flow, error states, and the two operational states. */
export const KIOSK_STATES = [
  // operational
  'UNENROLLED', 'ENROLLING', 'SERVICE',
  // primary customer flow
  'IDLE', 'IDENTIFICATION', 'CONSENT', 'INTAKE', 'HARDWARE_READY',
  'CAPTURING', 'PROCESSING', 'RESULTS', 'DELIVERY', 'COMPLETE', 'RESETTING',
  // error / interruption
  'HARDWARE_OFFLINE', 'NETWORK_OFFLINE', 'SCAN_FAILED',
  'CALIBRATION_REQUIRED', 'SESSION_TIMEOUT',
] as const;

export type KioskState = (typeof KIOSK_STATES)[number];

export const KIOSK_EVENTS = [
  'ENROLL_START', 'ENROLL_OK', 'ENROLL_CANCEL', 'REVOKED',
  'START', 'IDENTIFIED', 'CONSENT_GRANTED', 'CONSENT_DECLINED', 'INTAKE_DONE',
  'HARDWARE_OK', 'HARDWARE_LOST', 'CALIBRATION_INVALID',
  'CAPTURE_START', 'CAPTURE_OK', 'CAPTURE_FAILED',
  'PROCESSING_OK', 'PROCESSING_FAILED',
  'DELIVER_OPEN', 'DELIVER_BACK', 'DELIVER_DONE', 'DELIVER_SKIP',
  'FINISH', 'RESET', 'RESET_DONE', 'TIMEOUT',
  'NETWORK_LOST', 'NETWORK_BACK',
  'SERVICE_OPEN', 'SERVICE_CLOSE',
] as const;

export type KioskEvent = (typeof KIOSK_EVENTS)[number];

export type TransitionTable = {
  [S in KioskState]: Partial<Record<KioskEvent, KioskState>>
};

/**
 * `NETWORK_BACK` and `RESET` are absent from most rows because they are added
 * uniformly below — see BUILT. Writing them out thirty times would be thirty
 * chances to forget one, and forgetting RESET is how a state becomes a place a
 * customer's data can be stranded.
 */
const FLOW: TransitionTable = {
  // ── operational ───────────────────────────────────────────────────────
  // A kiosk with no credential can do exactly one thing.
  UNENROLLED: { ENROLL_START: 'ENROLLING' },
  ENROLLING:  { ENROLL_OK: 'IDLE', ENROLL_CANCEL: 'UNENROLLED' },
  // Leaving service mode ALWAYS resets. An associate may open diagnostics in
  // the middle of a fitting; the cost of that is the fitting, and the thing
  // that must not happen is returning to a half-finished customer session
  // through a door the customer never used.
  SERVICE:    { SERVICE_CLOSE: 'RESETTING' },

  // ── the customer flow ─────────────────────────────────────────────────
  IDLE:           { START: 'IDENTIFICATION' },
  IDENTIFICATION: { IDENTIFIED: 'CONSENT' },
  // A decline is not an error and not a dead end: it resets, and the next
  // customer finds a clean idle screen. Consent is never inferred from moving
  // on — there is no event here that advances without one.
  CONSENT:        { CONSENT_GRANTED: 'INTAKE', CONSENT_DECLINED: 'RESETTING' },
  INTAKE:         { INTAKE_DONE: 'HARDWARE_READY' },
  HARDWARE_READY: {
    CAPTURE_START: 'CAPTURING',
    HARDWARE_LOST: 'HARDWARE_OFFLINE',
    CALIBRATION_INVALID: 'CALIBRATION_REQUIRED',
  },
  CAPTURING: {
    CAPTURE_OK: 'PROCESSING',
    CAPTURE_FAILED: 'SCAN_FAILED',
    HARDWARE_LOST: 'HARDWARE_OFFLINE',
    CALIBRATION_INVALID: 'CALIBRATION_REQUIRED',
  },
  // No TIMEOUT row, and it is not added below either. The backend is working;
  // a customer standing still while it does is not an abandoned session.
  PROCESSING: { PROCESSING_OK: 'RESULTS', PROCESSING_FAILED: 'SCAN_FAILED' },
  RESULTS:    { DELIVER_OPEN: 'DELIVERY', DELIVER_SKIP: 'COMPLETE' },
  DELIVERY:   { DELIVER_DONE: 'COMPLETE', DELIVER_BACK: 'RESULTS' },
  COMPLETE:   { FINISH: 'RESETTING' },
  // The single doorway back to IDLE. Everything that clears customer state runs
  // here, which is why every other row can only reach IDLE through it.
  RESETTING:  { RESET_DONE: 'IDLE' },

  // ── error and interruption ────────────────────────────────────────────
  HARDWARE_OFFLINE:     { HARDWARE_OK: 'HARDWARE_READY' },
  CALIBRATION_REQUIRED: { HARDWARE_OK: 'HARDWARE_READY' },
  SCAN_FAILED:          { HARDWARE_OK: 'HARDWARE_READY' },
  // Resumption is not in the table: NETWORK_BACK returns to the state the
  // machine recorded on the way in, and apply() is what enforces that. A table
  // entry would let it land anywhere.
  NETWORK_OFFLINE: {},
  // The warning countdown is a UI overlay on the live state. Reaching this
  // state means the countdown already expired, so there is nothing to go back
  // to — only out.
  SESSION_TIMEOUT: {},
};

/** States a customer is standing in front of, mid-fitting. */
const CUSTOMER_FLOW: KioskState[] = [
  'IDENTIFICATION', 'CONSENT', 'INTAKE', 'HARDWARE_READY', 'CAPTURING',
  'PROCESSING', 'RESULTS', 'DELIVERY', 'COMPLETE',
];

const ERROR_STATES: KioskState[] = [
  'HARDWARE_OFFLINE', 'NETWORK_OFFLINE', 'SCAN_FAILED',
  'CALIBRATION_REQUIRED', 'SESSION_TIMEOUT',
];

function build(): TransitionTable {
  const t: TransitionTable = JSON.parse(JSON.stringify(FLOW));

  // RESET is universal except where there is nothing to reset. This is the
  // property that makes "a failed or abandoned session returns safely to IDLE"
  // true by construction rather than by inspection.
  for (const s of KIOSK_STATES) {
    if (s === 'RESETTING' || s === 'UNENROLLED' || s === 'ENROLLING') continue;
    t[s].RESET = 'RESETTING';
  }

  // Inactivity. Not from PROCESSING (the server is working), not from IDLE
  // (nobody is there), not from SERVICE (an associate is), and not from
  // RESETTING or the enrollment states.
  for (const s of [...CUSTOMER_FLOW, 'HARDWARE_OFFLINE', 'SCAN_FAILED',
                   'CALIBRATION_REQUIRED', 'NETWORK_OFFLINE'] as KioskState[]) {
    if (s === 'PROCESSING') continue;
    t[s].TIMEOUT = 'SESSION_TIMEOUT';
  }

  // Connectivity can drop under anyone's feet.
  for (const s of [...CUSTOMER_FLOW, 'IDLE'] as KioskState[]) {
    t[s].NETWORK_LOST = 'NETWORK_OFFLINE';
  }

  // The hidden operator entry point is reachable from everywhere a person can
  // be standing, including mid-fitting — see SERVICE above for what leaving it
  // costs.
  for (const s of [...CUSTOMER_FLOW, ...ERROR_STATES, 'IDLE'] as KioskState[]) {
    t[s].SERVICE_OPEN = 'SERVICE';
  }

  // A revoked or suspended credential drops the device out of service from
  // wherever it was, immediately.
  for (const s of KIOSK_STATES) {
    if (s === 'UNENROLLED' || s === 'ENROLLING') continue;
    t[s].REVOKED = 'UNENROLLED';
  }

  return t;
}

/** The authoritative table. Also serialized into the kiosk page as JSON. */
export const TRANSITIONS: TransitionTable = build();

export interface MachineState {
  state: KioskState;
  /** Where NETWORK_BACK returns to. Null in every other state. */
  resumeFrom: KioskState | null;
}

export function initial(enrolled: boolean): MachineState {
  return { state: enrolled ? 'IDLE' : 'UNENROLLED', resumeFrom: null };
}

/**
 * Apply an event. Returns the new machine state, or null if the event is not
 * legal here — callers treat null as "ignore", never as "force it".
 */
export function apply(m: MachineState, event: KioskEvent): MachineState | null {
  if (event === 'NETWORK_BACK') {
    if (m.state !== 'NETWORK_OFFLINE' || !m.resumeFrom) return null;
    return { state: m.resumeFrom, resumeFrom: null };
  }
  const next = TRANSITIONS[m.state]?.[event];
  if (!next) return null;
  if (event === 'NETWORK_LOST') return { state: next, resumeFrom: m.state };
  return { state: next, resumeFrom: null };
}

export function can(m: MachineState, event: KioskEvent): boolean {
  return apply(m, event) !== null;
}

/**
 * Does this state hold anything belonging to a customer?
 *
 * The reset routine keys off this rather than off a hand-kept list at the call
 * site, so adding a state to the flow cannot quietly add a state that skips the
 * wipe. NETWORK_OFFLINE and SESSION_TIMEOUT count: they are entered FROM the
 * flow, carrying whatever the flow was holding.
 */
export function holdsCustomerData(state: KioskState): boolean {
  return CUSTOMER_FLOW.indexOf(state) >= 0
      || state === 'NETWORK_OFFLINE'
      || state === 'SESSION_TIMEOUT';
}

/** The one legal starting point of a fitting. */
export const FLOW_ENTRY: KioskState = 'IDENTIFICATION';

/** Where a fitting must end up, however it ends. */
export const FLOW_EXIT: KioskState = 'IDLE';
