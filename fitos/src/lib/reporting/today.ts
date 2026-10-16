export function localToday(timezone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal')
    .map(x => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day;
}
