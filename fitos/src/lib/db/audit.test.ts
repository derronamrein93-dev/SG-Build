/**
 * audit_log — helper validation and the append-only boundary.
 *
 * RLS assertions live in db/test/isolation.sql, which is where tenant policy is
 * proven. These tests cover the write helper and the privileges, against the
 * real database, because a mocked one would prove nothing about either.
 *
 * Requires: bash db/reset.sh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { withTenant, withService, closePool } from './client';
import { writeAudit, writeMergeAudit, validateAuditEntry, AUDIT_ACTIONS } from './audit';
import { DEMO } from '../session';

const ctx = { organizationId: DEMO.organizationId, locationId: DEMO.locationId };

test('AU01 an organization can read the audit rows it wrote', async () => {
  const id = await withTenant(ctx, (c) => writeAudit(c, {
    organizationId: DEMO.organizationId,
    action: AUDIT_ACTIONS.MERGE_REQUESTED,
    subjectType: 'organization_customer',
    subjectId: randomUUID(),
  }));
  const found = await withTenant(ctx, async (c) =>
    (await c.query('select id, actor_type, created_at from audit_log where id = $1', [id])).rows[0]);
  assert.ok(found, 'the writing organization must be able to read its own row');
  assert.equal(found.actor_type, 'user');
  assert.ok(found.created_at instanceof Date, 'created_at is server-generated');
});

test('AU02 an organization cannot read another organization’s audit rows', async () => {
  const id = await withTenant(ctx, (c) => writeAudit(c, {
    organizationId: DEMO.organizationId,
    action: AUDIT_ACTIONS.MERGE_COMPLETED,
    subjectType: 'organization_customer',
    subjectId: randomUUID(),
  }));
  const other = await withService(async (c) =>
    (await c.query(`insert into organization (name) values ('Audit Outsider') returning id`)).rows[0].id as string);

  const seen = await withTenant({ organizationId: other, locationId: DEMO.locationId },
    async (c) => (await c.query('select id from audit_log where id = $1', [id])).rows.length);
  assert.equal(seen, 0, 'audit rows must not cross the tenant boundary');
});

test('AU03 the app role cannot update an audit row', async () => {
  const id = await withTenant(ctx, (c) => writeAudit(c, {
    organizationId: DEMO.organizationId,
    action: AUDIT_ACTIONS.MERGE_REQUESTED,
    subjectType: 'organization_customer',
  }));
  await assert.rejects(
    () => withTenant(ctx, (c) => c.query(`update audit_log set action = 'x.y' where id = $1`, [id])),
    /permission denied|row-level security/i);
});

test('AU04 the app role cannot delete an audit row', async () => {
  const id = await withTenant(ctx, (c) => writeAudit(c, {
    organizationId: DEMO.organizationId,
    action: AUDIT_ACTIONS.MERGE_REQUESTED,
    subjectType: 'organization_customer',
  }));
  await assert.rejects(
    () => withTenant(ctx, (c) => c.query('delete from audit_log where id = $1', [id])),
    /permission denied|row-level security/i);
});

test('AU05 an insert outside the current tenant scope is refused', async () => {
  const other = await withService(async (c) =>
    (await c.query(`insert into organization (name) values ('Audit Foreign Writer') returning id`)).rows[0].id as string);
  // The tenant context is DEMO; the row claims to belong to another organization.
  await assert.rejects(
    () => withTenant(ctx, (c) => writeAudit(c, {
      organizationId: other,
      action: AUDIT_ACTIONS.MERGE_COMPLETED,
      subjectType: 'organization_customer',
    })),
    /row-level security|permission denied/i);
});

test('AU06 metadata with PII-shaped keys is rejected before it reaches the database', async () => {
  for (const metadata of [
    { customer_name: 'Marisol Alvarez' },
    { phone: '+16125554417' },
    { contact: { email_address: 'x@y.test' } },
    { attempts: [{ street_address: '11 Grand Ave' }] },
    { access_token: 'abc' },
  ]) {
    const problems = validateAuditEntry({
      organizationId: DEMO.organizationId,
      action: AUDIT_ACTIONS.MERGE_REQUESTED,
      subjectType: 'organization_customer',
      metadata,
    });
    assert.ok(problems.length > 0, `should have rejected: ${JSON.stringify(metadata)}`);
  }
});

test('AU07 PII-shaped values are rejected even under an innocent key', async () => {
  const problems = validateAuditEntry({
    organizationId: DEMO.organizationId,
    action: AUDIT_ACTIONS.MERGE_REQUESTED,
    subjectType: 'organization_customer',
    metadata: { note: 'marisol@example.test' },
  });
  assert.ok(problems.some((p) => /email/i.test(p)), 'an email value should be caught by shape');
});

test('AU08 the database refuses PII keys even when the helper is bypassed', async () => {
  await assert.rejects(
    () => withTenant(ctx, (c) => c.query(
      `insert into audit_log (organization_id, action, subject_type, metadata)
       values ($1,'customer_identity.merge_requested','organization_customer',$2)`,
      [DEMO.organizationId, JSON.stringify({ deep: { last_name: 'Alvarez' } })])),
    /audit_log_metadata_no_pii_keys/i);
});

test('AU09 malformed actions and subject types are refused', async () => {
  const base = { organizationId: DEMO.organizationId, subjectType: 'organization_customer' };
  assert.ok(validateAuditEntry({ ...base, action: 'MergeCompleted' }).length);
  assert.ok(validateAuditEntry({ ...base, action: 'nodot' }).length);
  assert.ok(validateAuditEntry({ ...base, action: '' }).length);
  assert.ok(validateAuditEntry({ organizationId: DEMO.organizationId, action: 'a.b', subjectType: '' }).length);
  assert.equal(validateAuditEntry({ ...base, action: AUDIT_ACTIONS.MERGE_REVERTED }).length, 0);
});

test('AU10 the merge helper writes a valid, correlated event pair', async () => {
  const surviving = randomUUID();
  const merged = randomUUID();
  const correlationId = randomUUID();

  await withTenant(ctx, async (c) => {
    await writeMergeAudit(c, {
      organizationId: DEMO.organizationId, action: AUDIT_ACTIONS.MERGE_REQUESTED,
      survivingCustomerId: surviving, mergedCustomerId: merged, correlationId,
    });
    await writeMergeAudit(c, {
      organizationId: DEMO.organizationId, action: AUDIT_ACTIONS.MERGE_COMPLETED,
      survivingCustomerId: surviving, mergedCustomerId: merged, correlationId,
      metadata: { moved: { fitting_session: 3, report: 1 } },
    });
  });

  const rows = await withTenant(ctx, async (c) => (await c.query(
    `select action, subject_id, target_id, metadata, created_at from audit_log
      where correlation_id = $1 order by created_at`, [correlationId])).rows);

  assert.equal(rows.length, 2, 'both events must share one correlation id');
  // Ordering within a single transaction is the point of clock_timestamp():
  // under now() both rows carry transaction start time and the trail cannot say
  // which came first.
  assert.ok(rows[0].created_at < rows[1].created_at,
    'events in one transaction must still be orderable');
  assert.deepEqual(rows.map((r) => r.action),
    [AUDIT_ACTIONS.MERGE_REQUESTED, AUDIT_ACTIONS.MERGE_COMPLETED]);
  // Subject is the record that survives; target is the one merged away. Without
  // that distinction the trail cannot say which direction to reverse.
  assert.equal(rows[0].subject_id, surviving);
  assert.equal(rows[0].target_id, merged);
  assert.deepEqual(rows[1].metadata, { moved: { fitting_session: 3, report: 1 } });
});

test.after(async () => { await closePool(); });
