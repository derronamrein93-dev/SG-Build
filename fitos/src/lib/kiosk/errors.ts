/**
 * What a customer is allowed to be told when something breaks.
 *
 * A stranger in a shoe shop must never see a Postgres error, a stack frame, a
 * Supabase message, an API payload or a uuid. Not because it looks bad — because
 * every one of those is a free description of the system's internals handed to
 * whoever is standing in front of an unattended tablet.
 *
 * So the API returns a CODE from this file and nothing else. The mapping from
 * code to sentence lives here and in the kiosk client; the exception that caused
 * it never leaves the server, where it is logged in full.
 */

export const KIOSK_ERROR_CODES = [
  'hardware_offline',
  'calibration_required',
  'scan_failed',
  'network',
  'not_ready',
  'invalid_state',
  'session_expired',
  'consent_required',
  'not_enrolled',
  'enrollment_failed',
  'service_auth_failed',
  'unavailable',
] as const;

export type KioskErrorCode = (typeof KIOSK_ERROR_CODES)[number];

export interface CustomerMessage { title: string; body: string; action: string }

/**
 * Customer-facing copy. Plain sentences, no jargon, and every one of them ends
 * somewhere the customer can actually go — a retry, or an associate.
 */
export const CUSTOMER_MESSAGES: Record<KioskErrorCode, CustomerMessage> = {
  hardware_offline: {
    title: "Stride Guide isn't ready yet.",
    body: 'Please ask an associate for help.',
    action: 'Start over',
  },
  calibration_required: {
    title: 'Stride Guide needs a quick setup check.',
    body: 'Please ask an associate.',
    action: 'Start over',
  },
  scan_failed: {
    title: "We couldn't complete that scan.",
    body: 'Please reposition your feet and try again.',
    action: 'Try again',
  },
  network: {
    title: 'Connection interrupted.',
    body: "We're trying to reconnect.",
    action: 'Start over',
  },
  not_ready: {
    title: 'Almost there.',
    body: 'Place both feet inside the guides and hold still.',
    action: 'OK',
  },
  invalid_state: {
    title: "Let's start that again.",
    body: 'Nothing was saved.',
    action: 'Start over',
  },
  session_expired: {
    title: 'This session timed out.',
    body: 'Tap below to start a new fitting.',
    action: 'Start over',
  },
  consent_required: {
    title: 'We need your OK first.',
    body: 'Your fitting is only saved once you agree.',
    action: 'Back',
  },
  not_enrolled: {
    title: 'This kiosk needs to be set up.',
    body: 'Please ask an associate.',
    action: 'OK',
  },
  enrollment_failed: {
    title: "That code didn't work.",
    body: 'Check the code and try again.',
    action: 'Try again',
  },
  service_auth_failed: {
    title: 'That PIN was not recognized.',
    body: '',
    action: 'Try again',
  },
  unavailable: {
    title: 'Something went wrong.',
    body: 'Please ask an associate for help.',
    action: 'Start over',
  },
};

export class KioskError extends Error {
  readonly code: KioskErrorCode;
  readonly httpStatus: number;
  constructor(code: KioskErrorCode, httpStatus = 400, internal?: string) {
    super(internal ?? code);
    this.name = 'KioskError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * The chokepoint every kiosk route funnels its failures through.
 *
 * An unrecognised exception becomes `unavailable`, full stop. There is no
 * branch here that reads a message and passes part of it on: that is exactly how
 * a constraint name or a column list ends up on a shop floor.
 */
export function toCustomerError(err: unknown): { code: KioskErrorCode; status: number } {
  if (err instanceof KioskError) return { code: err.code, status: err.httpStatus };
  return { code: 'unavailable', status: 500 };
}

/**
 * What the server logs. Identifiers, never people, and never the customer's
 * input — CLAUDE.md's "log identifiers, not people", applied to a surface where
 * the input is a phone number.
 */
export function internalLogLine(scope: string, err: unknown, kioskDeviceId?: string): string {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : 'non-error thrown';
  return `[kiosk:${scope}]${kioskDeviceId ? ` device=${kioskDeviceId}` : ''} ${detail}`;
}
