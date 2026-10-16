import { randomUUID } from 'crypto';
import { withTenant, type TenantContext } from './db/client';
import { normalizePhone, phoneLookupHash, last4, PHONE_KEY_VERSION } from './db/identity';
import { consumeCustomerSms } from './customerSms';

/** Atomic verified check-in. No identified fitting is started without SMS proof. */
export async function startVerifiedFitting(ctx: TenantContext, input: {
  challengeId: string; phone: string; firstName?: string; lastName?: string;
  consent?: boolean;
}) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('A valid phone number is required');
  return withTenant(ctx, async c => {
    await consumeCustomerSms(c, ctx, input.challengeId, phone);
    const { rows } = await c.query(`
      select s.id, s.first_name, s.last_name from organization_customer m
      join organization_customer s on s.id=app_resolve_customer(m.id)
      where m.organization_id=$1 and m.phone_lookup_hash=$2
        and m.deleted_at is null and s.deleted_at is null
      limit 1
    `, [ctx.organizationId,phoneLookupHash(ctx.organizationId,phone)]);
    let customerId: string;
    if (rows.length) {
      customerId = rows[0].id;
    } else {
      if (!input.consent || !input.firstName?.trim() || !input.lastName?.trim())
        throw new Error('Customer name and fitting-history consent are required');
      customerId = randomUUID();
      await c.query(`
        insert into organization_customer
        (id,organization_id,created_at_location_id,first_name,last_name,
         phone_lookup_hash,phone_last4,phone_key_version,identification_method)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'phone')
      `, [customerId,ctx.organizationId,ctx.locationId,input.firstName.trim(),
          input.lastName.trim(),phoneLookupHash(ctx.organizationId,phone),last4(phone),PHONE_KEY_VERSION]);
      for (const type of ['fit_history_storage','privacy_ack']) {
        await c.query(`
          insert into consent_record
          (scope,organization_customer_id,location_id,type,granted,
           consent_text_version,privacy_policy_version,method,captured_by_user_id)
          values ('organization',$1,$2,$3,true,'consent-fit-v1.0',
                  'privacy-v1.0','tablet_checkbox',$4)
        `, [customerId,ctx.locationId,type,ctx.userId]);
      }
    }
    const { rows: visits } = await c.query(`
      select count(*)::int+1 as n from fitting_session
      where organization_customer_id=$1 and status='completed'
    `, [customerId]);
    const { rows: fitting } = await c.query(`
      insert into fitting_session
      (organization_id,location_id,organization_customer_id,user_id,status,visit_number)
      values ($1,$2,$3,$4,'draft',$5) returning id
    `, [ctx.organizationId,ctx.locationId,customerId,ctx.userId,visits[0].n]);
    await c.query(`
      update customer_sms_verification set fitting_session_id=$1 where id=$2
    `, [fitting[0].id,input.challengeId]);
    return { fittingId: fitting[0].id as string, returning: rows.length > 0 };
  });
}
