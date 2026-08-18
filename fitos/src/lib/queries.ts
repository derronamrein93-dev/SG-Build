import 'server-only';
import { withTenant } from './db/client';
import { currentContext } from './session';
import { normalizePhone, phoneLookupHash, last4, PHONE_KEY_VERSION } from './db/identity';
import type { CatalogItem } from './rules/engine';

export async function dashboard() {
  const ctx = currentContext();
  return withTenant(ctx, async (c) => {
    const today = await c.query(`
      select count(*) filter (where status = 'completed' and completed_at::date = current_date) as fittings,
             count(*) filter (where status in ('draft','in_progress')) as in_progress
        from fitting_session where location_id = $1`, [ctx.locationId]);
    const reports = await c.query(`
      select count(*) as sent from report r
        join fitting_session s on s.id = r.fitting_session_id
       where s.location_id = $1 and r.generated_at::date = current_date`, [ctx.locationId]);
    const recent = await c.query(`
      select s.id, s.status, s.started_at, s.completed_at, s.shopping_purpose,
             c.first_name, c.last_name, c.local_customer_number
        from fitting_session s
        left join organization_customer c on c.id = s.organization_customer_id
       where s.location_id = $1
       order by s.started_at desc limit 8`, [ctx.locationId]);
    const followUps = await c.query(`
      select f.id, f.follow_up_reason, f.follow_up_due_at, c.first_name, c.last_name
        from follow_up f
        left join organization_customer c on c.id = f.organization_customer_id
       where f.location_id = $1 and f.follow_up_status = 'scheduled'
       order by f.follow_up_due_at asc limit 5`, [ctx.locationId]);
    const location = await c.query('select name from location where id = $1', [ctx.locationId]);
    return {
      locationName: location.rows[0]?.name ?? 'Store',
      fittingsToday: Number(today.rows[0].fittings),
      inProgress: Number(today.rows[0].in_progress),
      reportsSent: Number(reports.rows[0].sent),
      followUpsDue: followUps.rows.length,
      recent: recent.rows,
      followUps: followUps.rows,
    };
  });
}

/** Exact-match only: the lookup runs against a keyed hash (docs/05 §10). */
export async function findCustomerByPhone(raw: string) {
  const ctx = currentContext();
  const e164 = normalizePhone(raw);
  if (!e164) return null;
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select id, first_name, last_name, local_customer_number, phone_last4
         from organization_customer
        where phone_lookup_hash = $1 and deleted_at is null limit 1`,
      [phoneLookupHash(ctx.organizationId, e164)]);
    if (!rows.length) return null;
    const visits = await c.query(
      `select count(*) n, max(completed_at) last from fitting_session
        where organization_customer_id = $1 and status = 'completed'`, [rows[0].id]);
    return { ...rows[0], visits: Number(visits.rows[0].n), lastVisit: visits.rows[0].last };
  });
}

export async function createCustomer(input: {
  firstName: string; lastName: string; phone: string; consent: boolean;
}) {
  const ctx = currentContext();
  const e164 = normalizePhone(input.phone);
  if (!e164) throw new Error('A complete phone number is required.');
  if (!input.consent) throw new Error('Consent is required before storing fitting information.');
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `insert into organization_customer
        (organization_id,created_at_location_id,first_name,last_name,
         phone_lookup_hash,phone_encrypted,phone_last4,phone_key_version,identification_method)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'phone')
       returning id, first_name, last_name, local_customer_number`,
      [ctx.organizationId, ctx.locationId, input.firstName, input.lastName,
       phoneLookupHash(ctx.organizationId, e164), Buffer.from(e164), last4(e164), PHONE_KEY_VERSION]);
    // Five consent types, never one boolean (docs/05 §11).
    for (const type of ['fit_history_storage', 'privacy_ack']) {
      await c.query(
        `insert into consent_record
          (scope,organization_customer_id,location_id,type,granted,consent_text_version,privacy_policy_version,method,captured_by_user_id)
         values ('organization',$1,$2,$3,true,'consent-fit-v1.0','privacy-v1.0','tablet_checkbox',$4)`,
        [rows[0].id, ctx.locationId, type, ctx.userId]);
    }
    return rows[0];
  });
}

export async function startSession(customerId: string | null) {
  const ctx = currentContext();
  return withTenant(ctx, async (c) => {
    const visit = customerId
      ? await c.query(`select count(*) + 1 n from fitting_session
                        where organization_customer_id = $1 and status = 'completed'`, [customerId])
      : { rows: [{ n: 1 }] };
    const { rows } = await c.query(
      `insert into fitting_session (organization_id,location_id,organization_customer_id,user_id,status,visit_number)
       values ($1,$2,$3,$4,'draft',$5) returning id`,
      [ctx.organizationId, ctx.locationId, customerId, ctx.userId, Number(visit.rows[0].n)]);
    return rows[0].id as string;
  });
}

export async function loadSession(id: string) {
  const ctx = currentContext();
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select s.*, c.first_name, c.last_name, c.local_customer_number
         from fitting_session s
         left join organization_customer c on c.id = s.organization_customer_id
        where s.id = $1`, [id]);
    if (!rows.length) return null;
    const a = await c.query('select * from assessment where fitting_session_id = $1', [id]);
    const prev = rows[0].organization_customer_id
      ? await c.query(
          `select s.completed_at, s.shopping_purpose, a.arch_type, a.width, a.size_left, a.size_right,
                  a.pronation_tendency, a.wear_pattern
             from fitting_session s left join assessment a on a.fitting_session_id = s.id
            where s.organization_customer_id = $1 and s.status = 'completed' and s.id <> $2
            order by s.completed_at desc limit 1`,
          [rows[0].organization_customer_id, id])
      : { rows: [] };
    return { session: rows[0], assessment: a.rows[0] ?? null, previous: prev.rows[0] ?? null };
  });
}

export async function loadCatalog(): Promise<CatalogItem[]> {
  const ctx = currentContext();
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select p.id, p.brand, p.model, p.category, p.support_level, p.cushioning_level,
              p.toe_box_shape, p.heel_structure, p.volume, p.removable_insole, p.best_for,
              i.widths_stocked
         from location_inventory i join product_model p on p.id = i.product_model_id
        where i.location_id = $1 and i.stocked`, [ctx.locationId]);
    return rows.map((r) => ({
      productModelId: r.id, brand: r.brand, model: r.model, category: r.category,
      supportLevel: r.support_level, cushioningLevel: r.cushioning_level,
      widthsStocked: r.widths_stocked ?? [], toeBoxShape: r.toe_box_shape,
      heelStructure: r.heel_structure, volume: r.volume,
      removableInsole: r.removable_insole, bestFor: r.best_for ?? [],
    }));
  });
}

