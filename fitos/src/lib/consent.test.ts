/**
 * Consent chokepoint. Run against the real database: the guarantees being
 * tested are half RLS policy and half query semantics, and a mock has neither.
 *
 * Requires: bash db/reset.sh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { withTenant, withService, closePool } from './db/client';
import { hasConsent, customerConsent, CONSENT_TYPES } from './consent';
import { DEMO } from './session';

const ctx = { organizationId: DEMO.organizationId, locationId: DEMO.locationId };

/** A customer in the demo organization, with no consent rows of its own. */
async function makeCustomer(): Promise<string> {
  return withService(async (c) => {
    const { rows } = await c.query(
      `insert into organization_customer
         (organization_id, created_at_location_id, first_name, last_name,
          phone_lookup_hash, phone_key_version)
       values ($1,$2,'Test','Subject',$3,1) returning id`,
      [DEMO.organizationId, DEMO.locationId, Buffer.from(randomUUID().replace(/-/g, ''), 'hex')]);
    // The location grant is created by the organization_customer_default_access
    // trigger, per the organization's default_customer_access setting. Inserting
    // one here collides with it.
    return rows[0].id as string;
  });
}

async function capture(customerId: string, type: string, granted: boolean) {
  await withService((c) => c.query(
    `insert into consent_record (scope, organization_customer_id, location_id, type, granted,
                                 consent_text_version, privacy_policy_version, method)
     values ('organization',$1,$2,$3,$4,'consent-fit-v1.0','privacy-v1.0','tablet_checkbox')`,
    [customerId, DEMO.locationId, type, granted]));
}

test('CH01 active organization-scoped consent returns true', async () => {
  const id = await makeCustomer();
  await capture(id, 'receive_report', true);
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, id, 'receive_report')), true);
});

test('CH02 withdrawn consent returns false', async () => {
  const id = await makeCustomer();
  await capture(id, 'marketing_email', true);
  await capture(id, 'marketing_email', false);   // withdrawal is a new row
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, id, 'marketing_email')), false);
});

test('CH03 consent re-granted after withdrawal returns true again', async () => {
  const id = await makeCustomer();
  await capture(id, 'marketing_sms', true);
  await capture(id, 'marketing_sms', false);
  await capture(id, 'marketing_sms', true);
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, id, 'marketing_sms')), true);
});

test('CH04 missing consent returns false', async () => {
  const id = await makeCustomer();
  for (const type of CONSENT_TYPES) {
    assert.equal(await withTenant(ctx, (c) => customerConsent(c, id, type)), false,
      `expected no consent for ${type}`);
  }
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, randomUUID(), 'privacy_ack')), false,
    'an unknown customer id must fail closed, not error');
});

test('CH05 another organization’s consent returns false', async () => {
  const id = await makeCustomer();
  await capture(id, 'fit_history_storage', true);

  const other = await withService(async (c) =>
    (await c.query(`insert into organization (name) values ('Consent Outsider') returning id`)).rows[0].id as string);

  // Same customer id, foreign tenant context. RLS hides the row; the helper
  // must report false rather than throwing or leaking existence.
  assert.equal(
    await withTenant({ organizationId: other, locationId: DEMO.locationId },
      (c) => customerConsent(c, id, 'fit_history_storage')),
    false);
});

test('CH06 captured person-scoped consent holds at the capturing location', async () => {
  const person = await withService(async (c) =>
    (await c.query(`insert into person_identity (identity_lookup_hash) values ($1) returning id`,
      [Buffer.from(randomUUID().replace(/-/g, ''), 'hex')])).rows[0].id as string);
  await withService((c) => c.query(
    `insert into consent_record (scope, person_identity_id, location_id, type, granted,
                                 consent_text_version, privacy_policy_version, method)
     values ('person',$1,$2,'identity_resolution',true,'consent-identity-v1.0','privacy-v1.0','mystrideid_account')`,
    [person, DEMO.locationId]));

  assert.equal(
    await withTenant(ctx, (c) => hasConsent(c,
      { kind: 'person', personIdentityId: person, locationId: DEMO.locationId }, 'identity_resolution')),
    true);
});

test('CH07 person-scoped consent does not hold for an unrelated organization', async () => {
  const person = await withService(async (c) =>
    (await c.query(`insert into person_identity (identity_lookup_hash) values ($1) returning id`,
      [Buffer.from(randomUUID().replace(/-/g, ''), 'hex')])).rows[0].id as string);
  await withService((c) => c.query(
    `insert into consent_record (scope, person_identity_id, location_id, type, granted,
                                 consent_text_version, privacy_policy_version, method)
     values ('person',$1,$2,'portable_profile_share',true,'consent-identity-v1.0','privacy-v1.0','mystrideid_account')`,
    [person, DEMO.locationId]));

  const outsider = await withService(async (c) => {
    const org = (await c.query(`insert into organization (name) values ('Person Consent Outsider') returning id`)).rows[0].id;
    const loc = (await c.query(
      `insert into location (organization_id, name, phone, email)
       values ($1,'Outsider Door','555-0199','o@x.test') returning id`, [org])).rows[0].id;
    return { org, loc };
  });

  assert.equal(
    await withTenant({ organizationId: outsider.org, locationId: outsider.loc },
      (c) => hasConsent(c,
        { kind: 'person', personIdentityId: person, locationId: outsider.loc }, 'portable_profile_share')),
    false);
});

test('CH08 person-scoped consent with no location fails closed', async () => {
  const person = await withService(async (c) =>
    (await c.query(`insert into person_identity (identity_lookup_hash) values ($1) returning id`,
      [Buffer.from(randomUUID().replace(/-/g, ''), 'hex')])).rows[0].id as string);
  await withService((c) => c.query(
    `insert into consent_record (scope, person_identity_id, location_id, type, granted,
                                 consent_text_version, privacy_policy_version, method)
     values ('person',$1,null,'identity_resolution',true,'consent-identity-v1.0','privacy-v1.0','mystrideid_account')`,
    [person]));

  // There is no location that satisfies it, including the one it was seeded
  // alongside. A row nobody can attribute is a row nobody may rely on.
  assert.equal(
    await withTenant(ctx, (c) => hasConsent(c,
      { kind: 'person', personIdentityId: person, locationId: DEMO.locationId }, 'identity_resolution')),
    false);
});

test('CH09 a grant and a withdrawal in one transaction resolve to withdrawn', async () => {
  // captured_at defaults to now(), which is transaction start time, so both rows
  // tie. The tie-break must fall to the fail-closed side.
  const id = await makeCustomer();
  await withService(async (c) => {
    for (const granted of [false, true]) {
      await c.query(
        `insert into consent_record (scope, organization_customer_id, location_id, type, granted,
                                     consent_text_version, privacy_policy_version, method)
         values ('organization',$1,$2,'receive_report',$3,'consent-fit-v1.0','privacy-v1.0','tablet_checkbox')`,
        [id, DEMO.locationId, granted]);
    }
  });
  assert.equal(await withTenant(ctx, (c) => customerConsent(c, id, 'receive_report')), false);
});

test('CH10 no code outside the chokepoint queries consent_record', async () => {
  // The goal of this step is that future code cannot hand-roll consent logic.
  // Adding a file here must be a deliberate act, reviewed on its merits.
  const ALLOWED = new Set([
    'src/lib/consent.ts',        // the chokepoint itself
    'src/lib/consent.test.ts',   // this file, which seeds fixtures
    'src/lib/queries.ts',        // consent CAPTURE at customer creation, not a check
  ]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(full)) continue;
      const rel = full.slice(full.indexOf('src/'));
      if (ALLOWED.has(rel)) continue;
      if (readFileSync(full, 'utf8').includes('consent_record')) offenders.push(rel);
    }
  };
  walk('src');
  assert.deepEqual(offenders, [],
    `these files query consent_record directly; call hasConsent() instead: ${offenders.join(', ')}`);
});

test.after(async () => { await closePool(); });
