export const scales: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
};

export function minor(value: string, currency: string): bigint {
  const scale = scales[currency];

  if (scale === undefined || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error('Invalid amount');

  const [whole, fraction = ''] = value.replace('-', '').split('.');

  if (fraction.length > scale)
    throw new Error(`Use at most ${scale} decimal places for ${currency}.`);

  const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');

  if (result > 9223372036854775807n) throw new Error('Amount exceeds the supported range.');

  return value.startsWith('-') ? -result : result;
}
export function money(value: string, currency: string, withCurrency = false): string {
  const [whole, fraction = ''] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const scale = scales[currency] ?? 2;
  const text = grouped + (scale ? '.' + fraction.padEnd(scale, '0') : '');

  return withCurrency ? `${currency} ${text}` : text;
}
export function utilization(reserved: string, limit: string, currency: string): number {
  const denominator = minor(limit, currency);

  if (denominator === 0n) return minor(reserved, currency) > 0n ? 100 : 0;

  const result = (minor(reserved, currency) * 10000n) / denominator;

  return Number(result > 10000n ? 10000n : result) / 100;
}
