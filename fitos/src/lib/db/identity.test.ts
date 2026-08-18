import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, phoneLookupHash, identityLookupHash, last4 } from './identity';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000001';

test('normalizes the shapes an associate actually types', () => {
  for (const input of ['502-555-1212', '(502) 555 1212', '5025551212', '+1 502 555 1212', '15025551212']) {
    assert.equal(normalizePhone(input), '+15025551212', `failed on ${input}`);
  }
  assert.equal(normalizePhone('123'), null);
});

test('the same person hashes DIFFERENTLY at two retailers', () => {
  const a = phoneLookupHash(ORG_A, '+15025551212');
  const b = phoneLookupHash(ORG_B, '+15025551212');
  assert.ok(!a.equals(b), 'per-org keys must prevent silent cross-retailer correlation');
});

test('the same person hashes identically within one retailer', () => {
  assert.ok(phoneLookupHash(ORG_A, '+15025551212').equals(phoneLookupHash(ORG_A, '+15025551212')));
});

test('the global identity hash is derived from a different secret', () => {
  const org = phoneLookupHash(ORG_A, '+15025551212');
  const global = identityLookupHash('+15025551212');
  assert.ok(!org.equals(global));
});

test('only the last four digits are kept in the clear', () => {
  assert.equal(last4('+15025551212'), '1212');
});
