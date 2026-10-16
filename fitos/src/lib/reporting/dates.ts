/** Resolve local calendar midnight to an ISO UTC instant, including DST. */
export function localMidnightUtc(day: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day + 'T00:00:00Z')) ||
      new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day)
    throw new Error('Invalid calendar date');
  const utc = Date.parse(day + 'T00:00:00Z');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const localParts = (ms: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(ms))
      .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day,
      parts.hour, parts.minute, parts.second);
  };
  let guess = utc;
  for (let i = 0; i < 4; i++) {
    const next = guess + (utc - localParts(guess));
    if (next === guess) break;
    guess = next;
  }
  if (localParts(guess) !== utc) throw new Error('Unresolvable local date boundary');
  return new Date(guess).toISOString();
}

export function localCalendarRange(from: string, through: string, timezone: string) {
  const start = localMidnightUtc(from, timezone);
  const endDay = new Date(Date.parse(through + 'T00:00:00Z') + 86400000);
  if (!Number.isFinite(endDay.getTime())) throw new Error('Invalid end date');
  const end = localMidnightUtc(endDay.toISOString().slice(0, 10), timezone);
  if (start >= end) throw new Error('Invalid date range');
  return { start, end };
}
