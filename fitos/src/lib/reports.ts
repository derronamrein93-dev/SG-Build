/**
 * Report access. Deliberately NOT marked `server-only`: it is exercised
 * directly by the access tests, and it imports `pg`, so it can never end up in
 * a client bundle regardless.
 */
import { createHash } from 'crypto';
import { withTenant, withService } from './db/client';
import { currentContext } from './session';

/**
 * Public report access — token only.
 *
 * The customer is anonymous: there is no session, no tenant context, and
 * therefore no RLS predicate to satisfy. Resolution runs through the service
 * role against the HASHED token and nothing else. A session id is not an input
 * to this function and cannot become one.
 */
export async function loadReportByToken(token: string) {
  if (!token || token.length < 16) return null;
  const hash = createHash('sha256').update(token).digest();
  return withService(async (c) => {
    const { rows } = await c.query(
      `select r.*, s.shopping_purpose, s.visit_number, s.completed_at,
              s.organization_id,
              c.first_name, c.last_name, u.first_name as fitter,
              l.name as location_name, l.address_line1, l.city, l.region, l.phone as location_phone
         from report r
         join fitting_session s on s.id = r.fitting_session_id
         left join organization_customer c on c.id = s.organization_customer_id
         join app_user u on u.id = s.user_id
         join location l on l.id = s.location_id
        where r.access_token_hash = $1
          and r.revoked_at is null
          and r.expires_at > now()
        limit 1`, [hash]);
    if (!rows.length) return null;
    // The access log carries the owning organization so it can be tenant-scoped
    // (0007). It is taken from the resolved fitting session, never from input:
    // the viewer is anonymous and supplies nothing but a token.
    await c.query(
      `insert into report_view (report_id, organization_id, user_agent_class, referrer_class)
       values ($1,$2,'unknown','direct')`,
      [rows[0].id, rows[0].organization_id]);
    return rows[0];
  });
}

/** Internal associate view — tenant-scoped, RLS applies, no token involved. */
export async function loadReport(sessionId: string) {
  const ctx = currentContext();
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select r.*, s.shopping_purpose, s.visit_number, s.completed_at,
              c.first_name, c.last_name, u.first_name as fitter,
              l.name as location_name, l.address_line1, l.city, l.region, l.phone as location_phone
         from report r
         join fitting_session s on s.id = r.fitting_session_id
         left join organization_customer c on c.id = s.organization_customer_id
         join app_user u on u.id = s.user_id
         join location l on l.id = s.location_id
        where r.fitting_session_id = $1
        order by r.report_version desc limit 1`, [sessionId]);
    return rows[0] ?? null;
  });
}
