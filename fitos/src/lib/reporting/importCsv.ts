import { validateSale, type SaleInput } from './ingest';

const HEADER = [
  'transaction_id', 'occurred_at', 'customer_id', 'sku', 'brand', 'model',
  'quantity', 'unit_price_cents', 'line_discount_cents',
  'sale_discount_cents', 'tax_cents', 'total_cents',
] as const;

function readRows(csv: string): string[][] {
  if (csv.length > 1024 * 1024) throw new Error('CSV exceeds 1 MiB');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, ended = false;
  const input = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; ended = true; }
      } else cell += ch;
    } else if (ch === '"') {
      if (cell.length || ended) throw new Error('Invalid CSV quote');
      quoted = true;
    } else if (ch === ',') {
      row.push(cell); cell = ''; ended = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = ''; ended = false;
      if (row.some(v => v.length)) rows.push(row);
      row = [];
      if (rows.length > 5001) throw new Error('CSV exceeds 5000 records');
    } else {
      if (ended) throw new Error('Unexpected text after CSV quote');
      cell += ch;
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some(v => v.length)) rows.push(row);
  }
  return rows;
}

function integer(value: string, field: string): number {
  if (!/^\d{1,12}$/.test(value)) throw new Error('Invalid ' + field);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid ' + field);
  return n;
}

/**
 * Import preview only: parsing does not write anything.
 * A transaction can occupy multiple CSV lines; sale totals repeat per line.
 * Transaction identifiers must not be reused for noncontiguous rows.
 */
export function previewSalesCsv(csv: string, source: string): SaleInput[] {
  const rows = readRows(csv);
  if (!rows.length || rows[0].join('\u0000') !== HEADER.join('\u0000'))
    throw new Error('Unexpected CSV headers');
  const byId = new Map<string, SaleInput>();
  for (const [index, values] of rows.slice(1).entries()) {
    if (values.length !== HEADER.length) throw new Error('CSV column count on row ' + (index + 2));
    const [
      id, occurredAt, customerId, sku, brand, model, quantity,
      unitPrice, lineDiscount, saleDiscount, tax, total,
    ] = values;
    if (!id) throw new Error('Missing transaction identifier on row ' + (index + 2));
    const line = {
      sku: sku || undefined, brand: brand || undefined, model: model || undefined,
      quantity: integer(quantity, 'quantity'),
      unitPriceCents: integer(unitPrice, 'unit price'),
      discountCents: integer(lineDiscount, 'line discount'),
    };
    let sale = byId.get(id);
    if (!sale) {
      sale = {
        source, externalTransactionId: id, occurredAt,
        customerId: customerId || null,
        subtotalCents: 0,
        discountCents: integer(saleDiscount, 'sale discount'),
        taxCents: integer(tax, 'tax'),
        totalCents: integer(total, 'total'),
        lines: [],
      };
      byId.set(id, sale);
    } else if (sale.occurredAt !== occurredAt ||
        (sale.customerId ?? '') !== customerId ||
        sale.discountCents !== integer(saleDiscount, 'sale discount') ||
        sale.taxCents !== integer(tax, 'tax') ||
        sale.totalCents !== integer(total, 'total')) {
      throw new Error('Conflicting transaction metadata for ' + id);
    }
    sale.lines.push(line);
    sale.subtotalCents += line.quantity * line.unitPriceCents;
  }
  const sales = [...byId.values()];
  for (const sale of sales) validateSale(sale);
  return sales;
}

export const SALES_CSV_HEADER = HEADER.join(',');
