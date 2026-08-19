/**
 * Customer lookup and session creation.
 *
 * Deliberately NOT marked `server-only`: the merge redirect and the tombstone
 * guard are the two behaviours most worth testing directly, and `server-only`
 * throws under node:test. It imports `pg`, so it can never reach a client bundle
 * regardless. Same reasoning as ./reports.
 */
import { withTenant } from './db/client';
import { currentContext } from './session';
import { normalizePhone, phoneLookupHash, last4, PHONE_KEY_VERSION } from './db/identity';

export async function findCustomerByPhone(raw: string) {
  const ctx = currentContext();
  const e164 = normalizePhone(raw);
  if (!e164) return null;
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      // Reads resolve through the merge redirect: typing either of a merged
      // customer's numbers must reach the surviving record, or the returning
      // customer the product exists to recognise shows up as a stranger.
      `select s.id, s.first_name, s.last_name, s.local_customer_number, s.phone_last4,
              (m.id <> s.id) as reached_via_merge
         from organization_customer m
         join organization_customer s on s.id = app_resolve_customer(m.id)
        where m.phone_lookup_hash = $1 and m.deleted_at is null limit 1`,
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
  // This gates on the checkbox in front of the associate — it is consent
  // CAPTURE, not a consent check. Anything asking whether consent *holds* for a
  // stored customer goes through hasConsent() in src/lib/consent.ts.
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
    // Five consent types, never one boolean (docs/05 §11). Withdrawal is a new
    // row with granted=false, never an update — which is why reads must resolve
    // the most recent row and belong in the chokepoint rather than here.
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
    if (customerId) {
      const { rows: t } = await c.query(
        `select merged_into_customer_id from organization_customer where id = $1`, [customerId]);
      if (t[0]?.merged_into_customer_id) {
        throw new Error(
          'This customer record was merged into another one. Search again and start the ' +
          'fitting on the surviving record.');
      }
    }
    const visit = customerId
      ? await c.query(`select count(*) + 1 n from fitting_session
                        where organization_customer_id = $1 and status = 'completed'`, [customerId])
      : { rows: [{ n: 1 }] };
    const { rows } = await c.query(
      // Writes never resolve. Silently retargeting an insert is how a fitting
      // lands on a record the associate did not choose; the trigger on
      // fitting_session raises, and this pre-check turns that into a message an
      // associate can act on.
      `insert into fitting_session (organization_id,location_id,organization_customer_id,user_id,status,visit_number)
       values ($1,$2,$3,$4,'draft',$5) returning id`,
      [ctx.organizationId, ctx.locationId, customerId, ctx.userId, Number(visit.rows[0].n)]);
    return rows[0].id as string;
  });
}

