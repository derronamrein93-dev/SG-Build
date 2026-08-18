/**
 * Contact identity — docs/05 §10.
 *
 * HMAC, not a bare hash: the North American phone space is ~10^10, so a plain
 * SHA-256 is a weekend of brute force. Keys are per-organization, so two
 * retailers' rows for the same person do NOT produce the same hash — otherwise
 * the platform could correlate customers across retailers as a silent side
 * effect of the schema, which would defeat the separation of identity from
 * authorization before any resolution logic existed.
 */
import { createHmac } from 'crypto';

const ORG_KEY_SECRET = process.env.FITOS_ORG_HASH_SECRET ?? 'dev-only-org-secret';
const GLOBAL_IDENTITY_SECRET = process.env.FITOS_IDENTITY_SECRET ?? 'dev-only-identity-secret';
export const PHONE_KEY_VERSION = 1;

/** +1 (502) 555-1212 → +15025551212 */
export function normalizePhone(input: string, defaultCountry = '1'): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
}

/** Retailer-scoped lookup hash. Exact match only — no partial search, by design. */
export function phoneLookupHash(organizationId: string, e164: string): Buffer {
  return createHmac('sha256', `${ORG_KEY_SECRET}:${organizationId}`).update(e164).digest();
}

/**
 * Global identity hash. Used ONLY inside identity resolution, never for
 * retailer-facing lookup, and derived from a different secret so a retailer
 * hash can never be compared against it.
 */
export function identityLookupHash(e164: string): Buffer {
  return createHmac('sha256', GLOBAL_IDENTITY_SECRET).update(e164).digest();
}

export function last4(e164: string): string {
  return e164.slice(-4);
}
