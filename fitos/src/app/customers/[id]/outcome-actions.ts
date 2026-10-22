'use server';

import { revalidatePath } from 'next/cache';
import { withTenant } from '../../../lib/db/client';
import { currentContext } from '../../../lib/session';
import { customerConsent } from '../../../lib/consent';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const outcomes = ['purchased', 'purchased_other', 'considering', 'no_purchase', 'ordered'];

export async function recordFittingOutcome(form: FormData) {
  const customerId = String(form.get('customerId') ?? '');
  const sessionId = String(form.get('sessionId') ?? '');
  const outcome = String(form.get('outcome') ?? '');
  const saleText = String(form.get('saleValue') ?? '').trim();
  const satisfaction = String(form.get('satisfaction') ?? '').trim();
  const returnReason = String(form.get('returnReason') ?? '').trim();
  const returnStatus = String(form.get('returnStatus') ?? 'unknown');
  if (!['unknown', 'not_returned', 'returned'].includes(returnStatus)) throw new Error('Invalid return status.');
  const returned = returnStatus === 'returned' ? true : returnStatus === 'not_returned' ? false : null;
  if (returnReason && returnStatus !== 'returned') throw new Error('A return reason requires a confirmed return.');
  if (!uuid.test(customerId) || !uuid.test(sessionId) || !outcomes.includes(outcome)) throw new Error('Invalid fitting or outcome.');
  if (saleText && (!/^\d+(\.\d{1,2})?$/.test(saleText) || Number(saleText) > 99999999)) throw new Error('Invalid sale amount.');
  if (satisfaction.length > 500 || returnReason.length > 500) throw new Error('Feedback is too long.');
  await withTenant(currentContext(), async db => {
    const { rows } = await db.query(
      `select s.id from fitting_session s
       join organization_customer c on c.id = s.organization_customer_id
       where s.id = $1 and c.id = $2 and c.deleted_at is null
         and c.organization_id = app_current_org()
         and app_can_access_customer(c.id) and s.status = 'completed'`,
      [sessionId, customerId]);
    if (!rows.length) throw new Error('Fitting not available.');
    if (!(await customerConsent(db, customerId, 'fit_history_storage'))) throw new Error('Customer consent is not active.');
    await db.query(
      `insert into outcome (fitting_session_id, outcome, sale_value, returned, return_reason, returned_at, satisfaction)
       values ($1,$2::outcome_kind,$3,$4,$5,case when $4 is true then now() else null end,$6)
       on conflict (fitting_session_id) do update set
         outcome = excluded.outcome, sale_value = excluded.sale_value,
         returned = excluded.returned, return_reason = excluded.return_reason,
         returned_at = excluded.returned_at, satisfaction = excluded.satisfaction`,
      [sessionId, outcome, saleText || null, returned, returnReason || null, satisfaction || null]);
    await db.query(
      `insert into outcome_event (fitting_session_id, event_type, outcome, sale_value, return_status, return_reason, satisfaction, recorded_by_user_id)
       values ($1,'purchase_recorded',$2::outcome_kind,$3,$4,$5,$6,$7)`,
      [sessionId, outcome, saleText || null, returnStatus, returnReason || null, satisfaction || null, currentContext().userId]);
  });
  revalidatePath(`/customers/${customerId}`);
}
