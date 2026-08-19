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
import { requireSecret } from '../config';

// Read at the point of use, not at module load. Two reasons: a module-level
// constant would make the failure a import-time crash in whatever happened to
// import this file first, and it would freeze the value, so tests could never
// prove that two different peppers produce two different hashes.
const orgKeySecret = () => requireSecret('FITOS_ORG_HASH_SECRET');
const globalIdentitySecret = () => requireSecret('FITOS_IDENTITY_SECRET');

/**
 * Bump when the pepper is rotated. Rotation is possible precisely because
 * `phone_encrypted` retains the E.164: decrypt, re-HMAC under the new key, write
 * the new version. Not implemented — see docs/05, "Identity peppers".
 */
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
  return createHmac('sha256', `${orgKeySecret()}:${organizationId}`).update(e164).digest();
}

/**
 * Global identity hash. Used ONLY inside identity resolution, never for
 * retailer-facing lookup, and derived from a different secret so a retailer
 * hash can never be compared against it.
 */
export function identityLookupHash(e164: string): Buffer {
  return createHmac('sha256', globalIdentitySecret()).update(e164).digest();
}

export function last4(e164: string): string {
  return e164.slice(-4);
}
