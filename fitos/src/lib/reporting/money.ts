/** Decimal money math: no binary floating-point for stored currency totals. */
export function subtractUsd(a: string, b: string): string {
  const toCents = (v: string): bigint => {
    if (!/^-?\d+\.\d{2}$/.test(v)) throw new Error('Invalid USD amount');
    const negative = v.startsWith('-');
    const digits = (negative ? v.slice(1) : v).replace('.', '');
    return BigInt(digits) * (negative ? -1n : 1n);
  };
  const n = toCents(a) - toCents(b);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return (negative ? '-' : '') + (abs / 100n).toString() + '.' +
    (abs % 100n).toString().padStart(2, '0');
}
