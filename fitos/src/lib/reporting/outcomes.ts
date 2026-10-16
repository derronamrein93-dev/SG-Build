/** Store-scoped reporting. No user-supplied tenant identifiers are accepted. */
import { withTenant, type TenantContext } from '../db/client';

export interface ReportRange { start: string; end: string; }
export function parseReportRange(start: string, end: string): ReportRange {
  const a = new Date(start), b = new Date(end);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || a >= b)
    throw new Error('Invalid reporting date range');
  if (b.getTime() - a.getTime() > 366 * 86400000)
    throw new Error('Reporting window cannot exceed 366 days');
  return { start: a.toISOString(), end: b.toISOString() };
}

export async function storeOutcomes(ctx: TenantContext, range: ReportRange) {
  const { start, end } = parseReportRange(range.start, range.end);
  return withTenant(ctx, async c => {
    // Count distinct sessions; a fitting may have many scans and linked sales.
    const { rows: fittings } = await c.query(`
      select count(*)::int as completed_fittings
      from fitting_session f
      where f.organization_id=$1 and f.location_id=$2
        and f.status='completed' and f.completed_at >= $3 and f.completed_at < $4
    `, [ctx.organizationId, ctx.locationId, start, end]);
    const { rows: scans } = await c.query(`
      select count(*)::int as scans
      from scan sc join fitting_session f on f.id=sc.fitting_session_id
      where f.organization_id=$1 and f.location_id=$2
        and sc.captured_at >= $3 and sc.captured_at < $4
    `, [ctx.organizationId, ctx.locationId, start, end]);
    const { rows: linked } = await c.query(`
      with eligible as (
        select f.id from fitting_session f
        where f.organization_id=$1 and f.location_id=$2 and f.status='completed'
          and f.completed_at >= $3 and f.completed_at < $4
      ), qualified as (
        select distinct a.fitting_session_id, a.sale_id
        from fitting_sale_attribution a
        join eligible e on e.id=a.fitting_session_id
        join retail_sale s on s.id=a.sale_id
        where a.method='explicit' and s.status='completed'
      )
      select
        (select count(distinct fitting_session_id)::int from qualified) as converted_fittings,
        (select count(distinct sale_id)::int from qualified) as linked_transactions,
        (select coalesce(sum(s.total),0)::text from retail_sale s
          where s.id in (select sale_id from qualified)) as linked_revenue
    `, [ctx.organizationId, ctx.locationId, start, end]);
    const { rows: sales } = await c.query(`
      select count(*)::int as transactions, coalesce(sum(total),0)::text as gross_sales
      from retail_sale where organization_id=$1 and location_id=$2
        and status='completed' and occurred_at >= $3 and occurred_at < $4
    `, [ctx.organizationId, ctx.locationId, start, end]);
    const { rows: refunds } = await c.query(`
      select count(*)::int as refund_events, coalesce(sum(r.amount),0)::text as refunded_total
      from retail_refund r join retail_sale s on s.id=r.sale_id
      where s.organization_id=$1 and s.location_id=$2
        and r.occurred_at >= $3 and r.occurred_at < $4
    `, [ctx.organizationId, ctx.locationId, start, end]);
    const completed = Number(fittings[0].completed_fittings);
    const converted = Number(linked[0].converted_fittings);
    return {
      start, end, completedFittings: completed, scans: Number(scans[0].scans),
      convertedFittings: converted,
      directConversionPercent: completed ? Math.round(converted / completed * 10000) / 100 : null,
      linkedTransactions: Number(linked[0].linked_transactions),
      linkedRevenue: linked[0].linked_revenue,
      storeTransactions: Number(sales[0].transactions),
      storeGrossSales: sales[0].gross_sales,
      refundEvents: Number(refunds[0].refund_events),
      refundedTotal: refunds[0].refunded_total,
      // This is a period-based receipts proxy, not a cohort's net sales.
      periodNetReceipts: (Number(sales[0].gross_sales) - Number(refunds[0].refunded_total)).toFixed(2),
      // Missing POS linkage is not evidence of no purchase.
      caveat: 'Linked sales are observational, not incremental revenue. Missing POS coverage may understate conversion.',
    };
  });
}

export async function customerOutcomes(ctx: TenantContext, customerId: string, range: ReportRange) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId))
    throw new Error('Invalid customer identifier');
  const { start, end } = parseReportRange(range.start, range.end);
  return withTenant(ctx, async c => {
    const { rows: customer } = await c.query(
      `select id, first_name, last_name, local_customer_number
       from organization_customer where id=$1 and organization_id=$2`,
      [customerId, ctx.organizationId]);
    if (!customer.length) return null;
    const { rows: fittings } = await c.query(`
      select f.id, f.status, f.started_at, f.completed_at, count(sc.id)::int as scans
      from fitting_session f left join scan sc on sc.fitting_session_id=f.id
      where f.organization_customer_id=$1 and f.organization_id=$2
        and f.location_id=$3 and f.started_at >= $4 and f.started_at < $5
      group by f.id order by f.started_at desc limit 500
    `, [customerId, ctx.organizationId, ctx.locationId, start, end]);
    const { rows: sales } = await c.query(`
      select id, occurred_at, total::text, currency, source
      from retail_sale where organization_customer_id=$1 and organization_id=$2
        and location_id=$3 and status='completed'
        and occurred_at >= $4 and occurred_at < $5
      order by occurred_at desc limit 500
    `, [customerId, ctx.organizationId, ctx.locationId, start, end]);
    return { customer: customer[0], fittings, sales, start, end };
  });
}
