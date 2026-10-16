import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRows } from './csv';
test('quotes commas, quotes and line breaks', () => {
 assert.equal(csvCell('a,"b"'), '"a,""b"""');
 assert.equal(csvRows([['name','value'],['A','12']]), '"name","value"\r\n"A","12"\r\n');
});
test('neutralizes spreadsheet formula prefixes, including leading whitespace', () => {
 for (const value of ['=SUM(A1:A2)','+cmd','-1+2','@SUM(1)','  =cmd','\t=cmd'])
   assert.equal(csvCell(value).startsWith('"\''), true);
});
