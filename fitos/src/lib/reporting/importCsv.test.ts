import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewSalesCsv, SALES_CSV_HEADER } from './importCsv';

const data = SALES_CSV_HEADER + '\n' +
 'A-101,2026-10-16T09:30:00-04:00,,SKU-1,"Brand, Inc.",Model X,1,12000,1000,1500,770,18270\n' +
 'A-101,2026-10-16T09:30:00-04:00,,SKU-2,Brand,Model Y,1,7000,500,1500,770,18270\n';

test('CSV groups multi-line transactions, quoted commas, and reconciles totals', () => {
 const sales = previewSalesCsv(data, 'manual_csv');
 assert.equal(sales.length, 1);
 assert.equal(sales[0].lines.length, 2);
 assert.equal(sales[0].lines[0].brand, 'Brand, Inc.');
 assert.equal(sales[0].subtotalCents, 19000);
});
test('CSV rejects conflicting repeated sale metadata', () => {
 assert.throws(() => previewSalesCsv(data.replace('1500,770,18270\n', '1500,770,18271\n'), 'manual_csv'), /Conflicting|reconcile/);
});
test('CSV rejects bad headers and unbalanced quotes', () => {
 assert.throws(() => previewSalesCsv('foo,bar\n1,2', 'manual_csv'), /headers/);
 assert.throws(() => previewSalesCsv(data + '"', 'manual_csv'), /quote/);
});
test('CSV accepts BOM and CRLF', () => {
 assert.equal(previewSalesCsv('\uFEFF' + data.replace(/\n/g, '\r\n'), 'manual_csv').length, 1);
});
