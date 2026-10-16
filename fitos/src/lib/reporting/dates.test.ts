import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMidnightUtc, localCalendarRange } from './dates';

test('Eastern daylight saving spring transition has a 23-hour day', () => {
 const r = localCalendarRange('2026-03-08','2026-03-08','America/New_York');
 assert.equal(r.start, '2026-03-08T05:00:00.000Z');
 assert.equal(r.end, '2026-03-09T04:00:00.000Z');
});
test('Eastern fall transition has a 25-hour day', () => {
 const r = localCalendarRange('2026-11-01','2026-11-01','America/New_York');
 assert.equal(r.start, '2026-11-01T04:00:00.000Z');
 assert.equal(r.end, '2026-11-02T05:00:00.000Z');
});
test('UTC and invalid date cases', () => {
 assert.equal(localMidnightUtc('2026-10-16','UTC'), '2026-10-16T00:00:00.000Z');
 assert.throws(() => localMidnightUtc('2026-02-30','UTC'));
 assert.throws(() => localCalendarRange('2026-10-17','2026-10-16','UTC'), /Invalid/);
});
