/**
 * Postgres access. Every request runs inside a transaction that sets the tenant
 * GUCs RLS reads, as the fitos_app role — which has no BYPASSRLS. There is no
 * code path in the application that reaches the database any other way.
 */
import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'fitos_owner',
  password: process.env.PGPASSWORD ?? 'fitos',
  database: process.env.PGDATABASE ?? 'fitos',
  max: 8,
});

export interface TenantContext {
  organizationId: string;
  locationId: string;
  userId?: string;
  bypassLocationScope?: boolean;
}

/** Run work as the application role inside the tenant's context. */
export async function withTenant<T>(ctx: TenantContext, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role fitos_app');
    await client.query('select set_config($1,$2,true)', ['app.organization_id', ctx.organizationId]);
    await client.query('select set_config($1,$2,true)', ['app.location_id', ctx.locationId]);
    await client.query('select set_config($1,$2,true)', [
      'app.bypass_location_scope', ctx.bypassLocationScope ? 'true' : 'false']);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Service role: seeding, jobs, identity resolution. Never reachable from a page. */
export async function withService<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role fitos_svc');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
