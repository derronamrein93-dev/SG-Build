import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReportRange } from './outcomes';

test('reporting intervals use UTC and exclusive end semantics', () => {
 const r = parseReportRange('2026-10-01T00:00:00-04:00','2026-11-01T00:00:00-04:00');
 assert.equal(r.start, '2026-10-01T04:00:00.000Z');
 assert.equal(r.end, '2026-11-01T04:00:00.000Z');
});
test('invalid, inverted, and unbounded report intervals fail closed', () => {
 assert.throws(() => parseReportRange('bad','2026-11-01'), /Invalid/);
 assert.throws(() => parseReportRange('2026-11-01','2026-10-01'), /Invalid/);
 assert.throws(() => parseReportRange('2024-01-01','2026-10-01'), /366/);
});
