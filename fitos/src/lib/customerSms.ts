import { withTenant, type TenantContext } from './db/client';
import { normalizePhone, phoneLookupHash, last4 } from './db/identity';
import { randomUUID } from 'crypto';

function providerConfig() {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!account || !token || !service || !/^AC[a-f0-9]{32}$/i.test(account) ||
      !/^VA[a-f0-9]{32}$/i.test(service)) throw new Error('SMS provider is not configured');
  return { account, token, service };
}
async function verifyApi(path: 'Verifications' | 'VerificationCheck', data: Record<string,string>) {
  const { account, token, service } = providerConfig();
  const response = await fetch(
    'https://verify.twilio.com/v2/Services/' + service + '/' + path, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(account + ':' + token).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data), cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  if (!response.ok) throw new Error('SMS verification service unavailable');
  return await response.json() as { sid?: string; status?: string; valid?: boolean };
}

/** Request code without returning customer existence or sensitive information. */
export async function requestCustomerSms(ctx: TenantContext, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Invalid phone number');
  providerConfig(); // fail before creating a challenge
  const hash = phoneLookupHash(ctx.organizationId, phone);
  const id = randomUUID();
  await withTenant(ctx, async c => {
    const { rows } = await c.query(`
      select count(*)::int as n from customer_sms_verification
      where organization_id=$1 and phone_lookup_hash=$2
        and created_at > now() - interval '1 hour'
    `, [ctx.organizationId, hash]);
    if (rows[0].n >= 3) throw new Error('Too many verification requests; try later');
    await c.query(`
      insert into customer_sms_verification
        (id,organization_id,location_id,phone_lookup_hash,phone_last4)
      values ($1,$2,$3,$4,$5)
    `, [id,ctx.organizationId,ctx.locationId,hash,last4(phone)]);
  });
  try {
    const result = await verifyApi('Verifications', { To: phone, Channel: 'sms' });
    if (!result.sid || result.status !== 'pending') throw new Error('SMS was not accepted');
    await withTenant(ctx, c => c.query(`
      update customer_sms_verification set provider_challenge_id=$1
      where id=$2 and state='pending'
    `, [result.sid,id]));
  } catch {
    await withTenant(ctx, c => c.query(`
      update customer_sms_verification set state='expired' where id=$1
    `, [id]));
    throw new Error('Unable to send verification code');
  }
  return { challengeId: id, phoneLast4: last4(phone) };
}

/** A successful provider check only marks the challenge verified; no customer access yet. */
export async function confirmCustomerSms(ctx: TenantContext, id: string, code: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4,10}$/.test(code))
    throw new Error('Invalid verification input');
  const challenge = await withTenant(ctx, async c => {
    const { rows } = await c.query(`
      update customer_sms_verification set attempts=attempts+1
      where id=$1 and organization_id=$2 and location_id=$3
        and state='pending' and expires_at>now()
        and attempts<5 and provider_challenge_id is not null
      returning provider_challenge_id
    `, [id,ctx.organizationId,ctx.locationId]);
    return rows[0];
  });
  if (!challenge) throw new Error('Verification expired or attempts exhausted');
  const result = await verifyApi('VerificationCheck', {
    VerificationSid: challenge.provider_challenge_id, Code: code,
  });
  if (result.status !== 'approved' || result.valid === false)
    throw new Error('Incorrect verification code');
  await withTenant(ctx, async c => {
    const { rowCount } = await c.query(`
      update customer_sms_verification set state='verified',verified_at=now()
      where id=$1 and state='pending' and expires_at>now()
    `, [id]);
    if (!rowCount) throw new Error('Verification expired');
  });
  return { verified: true };
}

/** Must be called inside the same transaction that creates an identified fitting. */
export async function consumeCustomerSms(
  c: import('pg').PoolClient, ctx: TenantContext, id: string, rawPhone: string,
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error('Invalid phone');
  const { rowCount } = await c.query(`
    update customer_sms_verification
    set state='consumed', consumed_at=now()
    where id=$1 and organization_id=$2 and location_id=$3
      and phone_lookup_hash=$4 and state='verified'
      and expires_at>now()
  `, [id,ctx.organizationId,ctx.locationId,phoneLookupHash(ctx.organizationId,phone)]);
  if (rowCount !== 1) throw new Error('SMS verification required for this phone');
}
