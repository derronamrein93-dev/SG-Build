/**
 * The kiosk HTTP boundary: how a request acquires a tenant, and how a failure
 * leaves the building.
 *
 * Every kiosk endpoint is three lines of its own logic wrapped in `handle()`.
 * That is deliberate — the two rules below have to hold on all of them, and a
 * rule that each route re-implements is a rule that one route will get wrong:
 *
 *   **Scope is derived, never accepted.** `requireKiosk` resolves the httpOnly
 *   credential cookie to a kiosk_device row and reads the organization and
 *   location off it. No endpoint takes an organization or location parameter.
 *   There is nothing to validate because there is nothing to send.
 *
 *   **Failures become codes.** `handle` catches everything, logs the real
 *   exception server-side, and returns one of the codes in ./errors. A Postgres
 *   message cannot reach a shop floor through this function.
 */
import { resolveKioskDevice, KIOSK_COOKIE, type KioskIdentity } from './device';
import { KioskError, toCustomerError, internalLogLine } from './errors';

/** Ten years. A kiosk is re-enrolled by an associate, not by a cookie expiring. */
const CREDENTIAL_MAX_AGE = 60 * 60 * 24 * 3650;

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function isSecure(req: Request): boolean {
  if (req.headers.get('x-forwarded-proto') === 'https') return true;
  try { return new URL(req.url).protocol === 'https:'; } catch { return false; }
}

/**
 * The credential cookie.
 *
 * httpOnly: the kiosk's own JavaScript never reads it, so an injected script on
 * this page cannot exfiltrate the device's identity. SameSite=Strict: nothing
 * off this origin can drive a kiosk endpoint with the device's credential
 * attached. Path=/ because /kiosk and /api/kiosk are different paths.
 */
export function credentialCookie(req: Request, credential: string): string {
  const attrs = [
    `${KIOSK_COOKIE}=${encodeURIComponent(credential)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${CREDENTIAL_MAX_AGE}`,
  ];
  if (isSecure(req)) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearedCredentialCookie(req: Request): string {
  const attrs = [`${KIOSK_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isSecure(req)) attrs.push('Secure');
  return attrs.join('; ');
}

/** Resolve the caller to a live kiosk, or fail closed. */
export async function requireKiosk(req: Request): Promise<KioskIdentity> {
  const identity = await resolveKioskDevice(readCookie(req, KIOSK_COOKIE));
  if (!identity) throw new KioskError('not_enrolled', 401);
  return identity;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A kiosk response is one customer's state. It must not be held by any
      // cache between this process and that iPad, and the iPad must not serve it
      // to the next customer out of its back/forward cache.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      pragma: 'no-cache',
      ...headers,
    },
  });
}

/**
 * Wrap a kiosk handler. The only place a kiosk exception is turned into a
 * response, so the mapping cannot vary by route.
 */
export async function handle(
  scope: string, req: Request, fn: (req: Request) => Promise<Response>,
): Promise<Response> {
  try {
    return await fn(req);
  } catch (err) {
    const { code, status } = toCustomerError(err);
    // The full exception stays here. The customer gets a word.
    console.error(internalLogLine(scope, err), err instanceof KioskError ? '' : err);
    return json({ ok: false, code }, status);
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new KioskError('invalid_state', 400, 'body must be an object');
    }
    return body as T;
  } catch (err) {
    if (err instanceof KioskError) throw err;
    throw new KioskError('invalid_state', 400, 'unparseable body');
  }
}
