/**
 * Report access tests — run against the real database, because the thing being
 * tested is a query boundary, and a mocked one would prove nothing.
 *
 * Requires: bash db/reset.sh
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'crypto';
import { withService, withTenant, closePool } from '../db/client';
import { loadReportByToken, loadReport } from '../reports';
import { DEMO } from '../session';

async function seedReport(opts: { expired?: boolean; revoked?: boolean } = {}) {
  const token = randomBytes(24).toString('base64url');
  const hash = createHash('sha256').update(token).digest();
  const sessionId = await withService(async (c) => {
    const { rows } = await c.query(
      `insert into fitting_session (organization_id,location_id,user_id,status,completed_at,shopping_purpose)
       values ($1,$2,$3,'completed',now(),'work') returning id`,
      [DEMO.organizationId, DEMO.locationId, DEMO.userId]);
    await c.query(
      `insert into report (fitting_session_id,access_token_hash,expires_at,revoked_at,content_snapshot)
       values ($1,$2,$3,$4,$5)`,
      [rows[0].id, hash,
       opts.expired ? new Date(Date.now() - 86400000) : new Date(Date.now() + 86400000),
       opts.revoked ? new Date() : null,
       { fitProfile: { category: 'work_support', support_level: 'stability', cushioning_level: 'plush',
                       width: 'wide', toe_box: 'standard', heel_fit: 'structured', insole: 'anti_fatigue',
                       volume: 'standard' },
         why: 'Composed paragraph.', toldUs: [{ label: 'Shopping for', value: 'Work' }], evidence: 'high' }]);
    return rows[0].id as string;
  });
  return { token, sessionId };
}

test('P01 a valid token resolves the right report', async () => {
  const { token, sessionId } = await seedReport();
  const report = await loadReportByToken(token);
  assert.ok(report, 'valid token should resolve');
  assert.equal(report.fitting_session_id, sessionId);
  assert.equal(report.content_snapshot.why, 'Composed paragraph.');
});

test('P02 an unknown token resolves nothing', async () => {
  await seedReport();
  assert.equal(await loadReportByToken(randomBytes(24).toString('base64url')), null);
});

test('P03 malformed and empty tokens resolve nothing', async () => {
  for (const bad of ['', 'x', 'short', '../../etc/passwd', 'null', 'undefined']) {
    assert.equal(await loadReportByToken(bad), null, `resolved on: ${bad}`);
  }
});

test('P04 a session id is not a token', async () => {
  const { sessionId } = await seedReport();
  // The public route takes a token. Feeding it the session id — the thing an
  // associate can see in their own URL bar — must not open the customer report.
  assert.equal(await loadReportByToken(sessionId), null);
});

test('P05 the token hash is what is stored, not the token', async () => {
  const { token } = await seedReport();
  const stored = await withService(async (c) => {
    const { rows } = await c.query("select encode(access_token_hash,'hex') h from report order by generated_at desc limit 1");
    return rows[0].h as string;
  });
  assert.ok(!stored.includes(token), 'raw token must never be stored');
  assert.equal(stored, createHash('sha256').update(token).digest('hex'));
});

test('P06 an expired token resolves nothing', async () => {
  const { token } = await seedReport({ expired: true });
  assert.equal(await loadReportByToken(token), null);
});

test('P07 a revoked token resolves nothing', async () => {
  const { token } = await seedReport({ revoked: true });
  assert.equal(await loadReportByToken(token), null);
});

test('P08 viewing a report is logged', async () => {
  const { token } = await seedReport();
  const before = await withService(async (c) =>
    Number((await c.query('select count(*) n from report_view')).rows[0].n));
  await loadReportByToken(token);
  const after = await withService(async (c) =>
    Number((await c.query('select count(*) n from report_view')).rows[0].n));
  assert.equal(after, before + 1);
});

test('P09 the internal view stays tenant-scoped and needs no token', async () => {
  const { sessionId } = await seedReport();
  const internal = await loadReport(sessionId);
  assert.ok(internal, 'associate can open their own store’s report by session');

  // ...and RLS still blocks another organization from the same query.
  const other = await withService(async (c) => {
    const { rows } = await c.query(
      `insert into organization (name) values ('Other Retailer') returning id`);
    return rows[0].id as string;
  });
  const leaked = await withTenant(
    { organizationId: other, locationId: DEMO.locationId },
    async (c) => (await c.query('select count(*) n from report')).rows[0].n);
  assert.equal(Number(leaked), 0, 'reports must not leak across organizations');
});

test('P10 a token resolves only its own report', async () => {
  // "A valid token works" is weaker than it sounds: it passes even if the query
  // ignores the token and returns the newest report. Two live tokens at once is
  // what makes the claim exclusivity rather than existence.
  const a = await seedReport();
  const b = await seedReport();

  const ra = await loadReportByToken(a.token);
  const rb = await loadReportByToken(b.token);

  assert.equal(ra?.fitting_session_id, a.sessionId);
  assert.equal(rb?.fitting_session_id, b.sessionId);
  assert.notEqual(ra?.id, rb?.id, 'two tokens must not resolve the same report');
});

test('P11 an unrelated organization cannot infer that a report exists', async () => {
  // Isolation is not only "cannot read". If a foreign tenant can tell a real
  // session id from a fabricated one — different row count, different error,
  // anything — the boundary leaks existence even while withholding content.
  const { sessionId } = await seedReport();

  const other = await withService(async (c) => {
    const { rows } = await c.query(
      `insert into organization (name) values ('Unrelated Retailer') returning id`);
    return rows[0].id as string;
  });

  const probe = (id: string) => withTenant(
    { organizationId: other, locationId: DEMO.locationId },
    async (c) => (await c.query(
      `select r.id from report r
         join fitting_session s on s.id = r.fitting_session_id
        where r.fitting_session_id = $1 limit 1`, [id])).rows[0] ?? null);

  const real = await probe(sessionId);
  const fake = await probe('00000000-0000-0000-0000-000000000000');

  assert.equal(real, null, 'a foreign tenant must not resolve a real session id');
  assert.deepEqual(real, fake, 'real and fabricated ids must be indistinguishable');

  // Not proven here: that the two take the same TIME. See docs/05, "Connection
  // model and trust boundaries" — accepted residual risk, mitigated by rate
  // limiting at the edge rather than by a query change.
});

test('P12 opening a report logs a view carrying the owning organization', async () => {
  // 0007 made report_view tenant-scoped. The organization comes from the
  // resolved fitting session, never from anything the anonymous viewer supplies.
  const { token, sessionId } = await seedReport();
  await loadReportByToken(token);

  const logged = await withService(async (c) => (await c.query(
    `select rv.organization_id, s.organization_id as expected
       from report_view rv
       join report r on r.id = rv.report_id
       join fitting_session s on s.id = r.fitting_session_id
      where s.id = $1
      order by rv.viewed_at desc limit 1`, [sessionId])).rows[0]);

  assert.ok(logged, 'a view must be logged');
  assert.equal(logged.organization_id, logged.expected);
  assert.equal(logged.organization_id, DEMO.organizationId);
});

test('P13 a failed token lookup logs nothing', async () => {
  const before = await withService(async (c) =>
    Number((await c.query('select count(*) n from report_view')).rows[0].n));
  await loadReportByToken('this-is-not-a-real-token-at-all-0001');
  const after = await withService(async (c) =>
    Number((await c.query('select count(*) n from report_view')).rows[0].n));
  assert.equal(after, before, 'an unresolved token must not create an access-log row');
});

// Close the pool rather than exiting the process: process.exit races the
// final test and silently swallows its result.
test.after(async () => { await closePool(); });
