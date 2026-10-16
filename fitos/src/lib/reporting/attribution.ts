/** Explicit association of a verified transaction with a completed fitting. */
import { withTenant, type TenantContext } from '../db/client';

export async function linkFittingSale(
  ctx: TenantContext, fittingId: string, saleId: string,
): Promise<{ linked: boolean }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(fittingId) || !uuid.test(saleId))
    throw new Error('Invalid fitting or sale identifier');
  return withTenant(ctx, async c => {
    const { rows: fit } = await c.query(`
      select organization_customer_id from fitting_session
      where id=$1 and organization_id=$2 and location_id=$3 and status='completed'
      for update
    `, [fittingId, ctx.organizationId, ctx.locationId]);
    const { rows: sale } = await c.query(`
      select organization_customer_id from retail_sale
      where id=$1 and organization_id=$2 and location_id=$3 and status='completed'
      for update
    `, [saleId, ctx.organizationId, ctx.locationId]);
    if (!fit.length || !sale.length) throw new Error('Completed fitting and sale required');
    // A known mismatch must never be silently linked. Anonymous sessions
    // require an associate's explicit confirmation upstream.
    if (fit[0].organization_customer_id && sale[0].organization_customer_id &&
        fit[0].organization_customer_id !== sale[0].organization_customer_id)
      throw new Error('Customer mismatch between fitting and sale');
    const { rowCount } = await c.query(`
      insert into fitting_sale_attribution
        (fitting_session_id,sale_id,organization_id,location_id,method,recorded_by_user_id)
      values ($1,$2,$3,$4,'explicit',$5)
      on conflict (fitting_session_id,sale_id) do update
      set method='explicit', recorded_by_user_id=excluded.recorded_by_user_id,
          recorded_at=now()
      where fitting_sale_attribution.method <> 'explicit'
    `, [fittingId, saleId, ctx.organizationId, ctx.locationId, ctx.userId ?? null]);
    return { linked: Boolean(rowCount) };
  });
}
