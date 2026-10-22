import { withTenant } from './db/client';
import { currentContext } from './session';

export interface FittingOutcome {
  fitting_session_id: string;
  outcome: string;
  purchased_model_id: string | null;
  purchased_size: string | null;
  sale_value: string | null;
  returned: boolean | null;
  return_reason: string | null;
  returned_at: string | null;
  satisfaction: string | null;
  recorded_at: string;
  follow_up_status: string | null;
  response: string | null;
  response_note: string | null;
}

/**
 * Retailer-authorized history. Filter through organization_customer AND
 * app_can_access_customer, rather than trusting the existing outcome policy
 * (which only verifies organization membership).
 */
export async function customerPurchaseAndFeedback(customerId: string): Promise<FittingOutcome[]> {
  return withTenant(currentContext(), async (db) => {
    const { rows } = await db.query<FittingOutcome>(
      `select o.fitting_session_id, o.outcome::text, o.purchased_model_id,
              o.purchased_size::text, o.sale_value::text, o.returned,
              o.return_reason, o.returned_at, o.satisfaction, o.recorded_at,
              f.follow_up_status::text, f.response, f.response_note
         from organization_customer c
         join fitting_session s on s.organization_customer_id = c.id
         join outcome o on o.fitting_session_id = s.id
         left join lateral (
           select follow_up_status, response, response_note
           from follow_up
           where fitting_session_id = s.id
             and organization_customer_id = c.id
             and location_id = s.location_id
           order by follow_up_due_at desc limit 1
         ) f on true
        where c.id = $1
          and c.deleted_at is null
          and c.organization_id = app_current_org()
          and app_can_access_customer(c.id)
        order by o.recorded_at desc`, [customerId]);
    return rows;
  });
}
