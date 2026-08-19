/**
 * Configuration fail-fast.
 *
 * These tests deliberately break the environment, so each one restores it. They
 * do not touch the database: the whole point is that identity hashing refuses
 * to run *before* anything is persisted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSecret, assertIdentityConfig, ConfigurationError, IDENTITY_SECRET_VARS } from './config';
import { phoneLookupHash, identityLookupHash, normalizePhone } from './db/identity';

const SAVED = { ...process.env };
function restore() {
  for (const v of IDENTITY_SECRET_VARS) {
    if (SAVED[v] === undefined) delete process.env[v];
    else process.env[v] = SAVED[v];
  }
}

// Long enough to clear the minimum, and obviously not production values.
const TEST_ORG_PEPPER = 'test-org-pepper-deterministic-000000001';
const TEST_ID_PEPPER  = 'test-identity-pepper-deterministic-00001';
const ORG = '11111111-1111-1111-1111-111111111111';

test('SC01 a missing org hash secret fails fast', () => {
  delete process.env.FITOS_ORG_HASH_SECRET;
  assert.throws(() => phoneLookupHash(ORG, '+16125554417'),
    (e: Error) => e instanceof ConfigurationError && /FITOS_ORG_HASH_SECRET is not set/.test(e.message));
  restore();
});

test('SC02 a missing identity secret fails fast', () => {
  delete process.env.FITOS_IDENTITY_SECRET;
  assert.throws(() => identityLookupHash('+16125554417'),
    (e: Error) => e instanceof ConfigurationError && /FITOS_IDENTITY_SECRET is not set/.test(e.message));
  restore();
});

test('SC03 an empty org hash secret fails fast', () => {
  for (const empty of ['', '   ']) {
    process.env.FITOS_ORG_HASH_SECRET = empty;
    assert.throws(() => phoneLookupHash(ORG, '+16125554417'),
      /FITOS_ORG_HASH_SECRET is set but empty/);
  }
  restore();
});

test('SC04 an empty identity secret fails fast', () => {
  process.env.FITOS_IDENTITY_SECRET = '';
  assert.throws(() => identityLookupHash('+16125554417'),
    /FITOS_IDENTITY_SECRET is set but empty/);
  restore();
});

test('SC05 the old hard-coded fallbacks are rejected', () => {
  // These are the exact strings that used to be the `??` defaults. If either
  // ever passes again, the hole is back.
  process.env.FITOS_ORG_HASH_SECRET = 'dev-only-org-secret';
  assert.throws(() => phoneLookupHash(ORG, '+16125554417'), /known placeholder value/);
  restore();

  process.env.FITOS_IDENTITY_SECRET = 'dev-only-identity-secret';
  assert.throws(() => identityLookupHash('+16125554417'), /known placeholder value/);
  restore();
});

test('SC06 a too-short secret is rejected', () => {
  process.env.FITOS_ORG_HASH_SECRET = 'abc123';
  assert.throws(() => phoneLookupHash(ORG, '+16125554417'), /shorter than 32 characters/);
  restore();
});

test('SC07 explicit test secrets allow hashing, deterministically', () => {
  process.env.FITOS_ORG_HASH_SECRET = TEST_ORG_PEPPER;
  process.env.FITOS_IDENTITY_SECRET = TEST_ID_PEPPER;

  const e164 = normalizePhone('(612) 555-4417')!;
  const a = phoneLookupHash(ORG, e164);
  const b = phoneLookupHash(ORG, e164);
  assert.deepEqual(a, b, 'same pepper, same input, same hash');
  assert.equal(a.length, 32, 'sha256 digest');
  restore();
});

test('SC08 different peppers produce different lookup hashes', () => {
  const e164 = '+16125554417';

  process.env.FITOS_ORG_HASH_SECRET = TEST_ORG_PEPPER;
  const underFirst = phoneLookupHash(ORG, e164);

  process.env.FITOS_ORG_HASH_SECRET = TEST_ORG_PEPPER + '-rotated';
  const underSecond = phoneLookupHash(ORG, e164);

  // This is the whole reason rotation needs phone_encrypted: the stored hash
  // cannot be recomputed from itself once the pepper moves.
  assert.notDeepEqual(underFirst, underSecond);
  restore();
});

test('SC09 error messages never contain the secret value', () => {
  const leak = 'super-secret-value-that-must-never-be-logged-0001';
  process.env.FITOS_ORG_HASH_SECRET = leak.slice(0, 6); // too short → throws
  try {
    phoneLookupHash(ORG, '+16125554417');
    assert.fail('should have thrown');
  } catch (err) {
    const message = (err as Error).message;
    assert.ok(!message.includes(leak.slice(0, 6)), 'the value must not appear in the message');
    assert.ok(message.includes('FITOS_ORG_HASH_SECRET'), 'but the variable name must');
  }
  restore();
});

test('SC10 assertIdentityConfig reports every missing variable at once', () => {
  delete process.env.FITOS_ORG_HASH_SECRET;
  delete process.env.FITOS_IDENTITY_SECRET;
  try {
    assertIdentityConfig();
    assert.fail('should have thrown');
  } catch (err) {
    const message = (err as Error).message;
    for (const v of IDENTITY_SECRET_VARS) {
      assert.ok(message.includes(v), `${v} should be named in the combined report`);
    }
  }
  restore();
  assert.doesNotThrow(() => assertIdentityConfig(), 'valid config passes');
});

test('SC11 requireSecret names the variable it is asked about', () => {
  process.env.FITOS_ORG_HASH_SECRET = TEST_ORG_PEPPER;
  assert.equal(requireSecret('FITOS_ORG_HASH_SECRET'), TEST_ORG_PEPPER);
  restore();
});
