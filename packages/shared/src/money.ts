// Currency-aware money helpers, shared by server, bot, and webapp so every
// surface formats/parses amounts identically.
//
// Amounts are integer MINOR UNITS in each currency's own smallest unit — but the
// number of minor units per major unit varies: 2 for USD/SGD (cents), 0 for JPY
// (a yen has no sub-unit), 3 for KWD/BHD. Never assume /100.

const DECIMALS: Record<string, number> = {
  // zero-decimal currencies
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  CLP: 0,
  ISK: 0,
  HUF: 0,
  // three-decimal currencies
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

/** Minor-unit decimal places for a currency (default 2). */
export function currencyDecimals(code?: string | null): number {
  if (!code) return 2;
  return DECIMALS[code.toUpperCase()] ?? 2;
}

/** A short list of common currencies for pickers. */
export const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'SGD', 'JPY', 'AUD', 'CAD', 'INR', 'CNY', 'HKD', 'KRW', 'THB', 'MYR', 'TWD',
];

/** Format integer minor units for display, e.g. formatMoney(5000, 'JPY') -> "JPY 5000". */
export function formatMoney(minorUnits: number, currency?: string): string {
  const d = currencyDecimals(currency);
  const sign = minorUnits < 0 ? '-' : '';
  const major = (Math.abs(minorUnits) / 10 ** d).toFixed(d);
  return currency ? `${sign}${currency} ${major}` : `${sign}${major}`;
}

/** Parse a user-entered major-unit string into integer minor units, or null if invalid. */
export function parseMoney(input: string, currency?: string): number | null {
  const d = currencyDecimals(currency);
  const normalized = input.trim().replace(',', '.');
  const re = d === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${d}})?$`);
  if (!re.test(normalized)) return null;
  return Math.round(parseFloat(normalized) * 10 ** d);
}
