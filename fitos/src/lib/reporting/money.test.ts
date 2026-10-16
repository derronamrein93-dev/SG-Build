import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtractUsd } from './money';

test('subtracts decimal amounts without floating-point drift', () => {
 assert.equal(subtractUsd('100.01','0.02'), '99.99');
 assert.equal(subtractUsd('0.01','0.02'), '-0.01');
 assert.equal(subtractUsd('1234567890123.45','0.05'), '1234567890123.40');
});
test('rejects non-cent monetary strings', () => {
 assert.throws(() => subtractUsd('1.001','0.00'), /Invalid/);
});
