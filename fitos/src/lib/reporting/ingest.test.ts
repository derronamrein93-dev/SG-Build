import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSale, type SaleInput } from './ingest';

const valid: SaleInput = {
 source: 'manual', externalTransactionId: 'store-001-123',
 occurredAt: '2026-10-16T11:00:00-04:00',
 subtotalCents: 12000, discountCents: 1000, taxCents: 770,
 totalCents: 11770, lines: [
  { sku: 'SHOE-01', quantity: 1, unitPriceCents: 12000, discountCents: 1000 },
 ],
};

test('accepts a reconciled sale with an offset-aware timestamp', () => {
 assert.doesNotThrow(() => validateSale(valid));
});
test('rejects mismatched totals, missing source ids and unsupported currency', () => {
 assert.throws(() => validateSale({ ...valid, totalCents: 11771 }), /reconcile/);
 assert.throws(() => validateSale({ ...valid, externalTransactionId: '' }), /required/);
 assert.throws(() => validateSale({ ...valid, currency: 'EUR' }), /USD/);
});
test('rejects inconsistent line items and invalid quantities', () => {
 assert.throws(() => validateSale({ ...valid, subtotalCents: 12001 }), /reconcile/);
 assert.throws(() => validateSale({ ...valid, lines: [{ ...valid.lines[0], quantity: -1 }] }), /quantity/);
});
test('rejects timestamps without explicit timezone', () => {
 assert.throws(() => validateSale({ ...valid, occurredAt: '2026-10-16T11:00:00' }), /timezone/);
});
