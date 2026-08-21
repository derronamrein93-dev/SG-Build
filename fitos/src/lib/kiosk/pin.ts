/**
 * Associate PIN hashing.
 *
 * A leaf module with nothing behind it — no database, no audit, no engine —
 * because `db/seed.ts` needs to write a development PIN and must not drag the
 * recommendation pipeline in behind it. `app_user.pin_hash` has existed since
 * migration 0001 and has never had a writer; this file is what "what is in
 * pin_hash" means, so there is exactly one answer instead of one per call site.
 *
 * scrypt from node:crypto, not a bare digest: a four-digit PIN has ten thousand
 * possibilities and a SHA-256 of one is a rainbow table, not a hash. And not
 * bcrypt or argon2 either — those are dependencies, and node:crypto already
 * ships a memory-hard KDF.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_N = 16384, SCRYPT_r = 8, SCRYPT_p = 1, KEY_LEN = 32;

/** `scrypt$N$r$p$<salt-b64>$<key-b64>` — self-describing, so N can be raised later. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  try {
    const expected = Buffer.from(keyB64, 'base64');
    const actual = scryptSync(pin, Buffer.from(saltB64, 'base64'), expected.length,
      { N: Number(n), r: Number(r), p: Number(p) });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

