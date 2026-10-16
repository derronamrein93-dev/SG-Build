/** Transactional retail sale ingestion, with source-scoped idempotency. */
import { withTenant, type TenantContext } from '../db/client';

export type SaleInput = {
  source: string;
  externalTransactionId: string;
  occurredAt: string;
  customerId?: string | null;
  currency?: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  lines: Array<{
    sku?: string;
    brand?: string;
    model?: string;
    quantity: number;
    unitPriceCents: number;
    discountCents?: number;
  }>;
};

function cents(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000000)
    throw new Error('Invalid monetary amount');
  return (value / 100).toFixed(2);
}

export function validateSale(input: SaleInput): void {
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(input.source))
    throw new Error('Invalid sale source');
  if (!input.externalTransactionId || input.externalTransactionId.length > 200)
    throw new Error('A stable transaction identifier is required');
  if (!Number.isFinite(Date.parse(input.occurredAt)) ||
      !/(?:Z|[+-]\d\d:\d\d)$/i.test(input.occurredAt))
    throw new Error('Sale timestamp must include a timezone');
  if ((input.currency ?? 'USD') !== 'USD')
    throw new Error('Only USD sales are currently supported');
  if (input.customerId && !/^[0-9a-f-]{36}$/i.test(input.customerId))
    throw new Error('Invalid customer identifier');
  for (const n of [input.subtotalCents, input.discountCents, input.taxCents, input.totalCents])
    cents(n);
  if (input.totalCents !== input.subtotalCents - input.discountCents + input.taxCents)
    throw new Error('Transaction totals do not reconcile');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 250)
    throw new Error('Sale must contain 1–250 line items');
  let subtotal = 0;
  let lineDiscount = 0;
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000)
      throw new Error('Invalid line quantity');
    cents(line.unitPriceCents);
    cents(line.discountCents ?? 0);
    subtotal += line.quantity * line.unitPriceCents;
    lineDiscount += line.discountCents ?? 0;
    if (!Number.isSafeInteger(subtotal)) throw new Error('Line total overflow');
  }
  if (subtotal !== input.subtotalCents || lineDiscount > input.discountCents)
    throw new Error('Line totals do not reconcile');
}

export async function ingestSale(ctx: TenantContext, input: SaleInput) {
  validateSale(input);
  const timestamp = new Date(input.occurredAt).toISOString();
  return withTenant(ctx, async c => {
    const params = [
      ctx.organizationId, ctx.locationId, input.customerId ?? null,
      input.source, input.externalTransactionId, timestamp, 'USD',
      cents(input.subtotalCents), cents(input.discountCents),
      cents(input.taxCents), cents(input.totalCents),
    ];
    const { rows } = await c.query(`
      insert into retail_sale
        (organization_id, location_id, organization_customer_id, source,
         external_transaction_id, occurred_at, currency, subtotal,
         discount_total, tax_total, total)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (organization_id,source,external_transaction_id) do nothing
      returning id
    `, params);
    if (!rows.length) {
      const existing = await c.query(`
        select id, location_id, organization_customer_id, occurred_at,
               subtotal::text, discount_total::text, tax_total::text, total::text
        from retail_sale
        where organization_id=$1 and source=$2 and external_transaction_id=$3
      `, [ctx.organizationId, input.source, input.externalTransactionId]);
      const sale = existing.rows[0];
      if (!sale || sale.location_id !== ctx.locationId ||
          sale.organization_customer_id !== (input.customerId ?? null) ||
          new Date(sale.occurred_at).toISOString() !== timestamp ||
          sale.subtotal !== cents(input.subtotalCents) ||
          sale.discount_total !== cents(input.discountCents) ||
          sale.tax_total !== cents(input.taxCents) ||
          sale.total !== cents(input.totalCents))
        throw new Error('Conflicting or inaccessible transaction identifier');
      const lines = await c.query(
        'select line_number, sku, brand, model, quantity::text, unit_price::text, discount::text from retail_sale_line where sale_id=$1 order by line_number', [sale.id]);
      if (lines.rows.length !== input.lines.length ||
          lines.rows.some((row, i) => {
            const line = input.lines[i];
            return row.line_number !== i + 1 ||
              row.sku !== (line.sku ?? null) ||
              row.brand !== (line.brand ?? null) ||
              row.model !== (line.model ?? null) ||
              Number(row.quantity) !== line.quantity ||
              row.unit_price !== cents(line.unitPriceCents) ||
              row.discount !== cents(line.discountCents ?? 0);
          }))
        throw new Error('Conflicting transaction line items');
      return { id: sale.id as string, inserted: false };
    }
    const saleId = rows[0].id as string;
    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      await c.query(`
        insert into retail_sale_line
          (sale_id,line_number,sku,brand,model,quantity,unit_price,discount)
        values ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [saleId, i + 1, line.sku ?? null, line.brand ?? null, line.model ?? null,
           line.quantity, cents(line.unitPriceCents), cents(line.discountCents ?? 0)]);
    }
    return { id: saleId, inserted: true };
  });
}
