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

test('ID06 the seeded returning customer is still findable by phone', async () => {
  // The guard against pepper drift. db/reset.sh and `npm run test` both source
  // dev.env; if those ever diverge, the hash stored by the seed stops matching
  // the hash computed at lookup — and the Day 5 returning-customer path fails in
  // front of a store owner rather than here.
  //
  // The query is replicated rather than imported: queries.ts is `server-only`,
  // which throws under node:test. What matters is the hash comparison, and that
  // is identical either way.
  const { withTenant } = await import('./client');
  const { DEMO } = await import('../session');
  const e164 = normalizePhone('612-555-4417')!;

  const found = await withTenant(
    { organizationId: DEMO.organizationId, locationId: DEMO.locationId },
    async (c) => (await c.query(
      `select phone_last4, phone_key_version from organization_customer
        where phone_lookup_hash = $1 and deleted_at is null limit 1`,
      [phoneLookupHash(DEMO.organizationId, e164)])).rows[0] ?? null);

  assert.ok(found,
    'seeded customer did not resolve. Either the peppers in dev.env drifted from ' +
    'the ones the seed used, or db/test/isolation.sql replaced the demo fixture ' +
    '(it deletes all organizations). Run `bash db/reset.sh` and try again, or use ' +
    '`npm run verify`, which sequences these correctly.');
  assert.equal(found.phone_last4, '4417');
  assert.equal(found.phone_key_version, 1);
});

test.after(async () => {
  const { closePool } = await import('./client');
  await closePool();
});