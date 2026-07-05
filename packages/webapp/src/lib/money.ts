// Currency-aware money helpers live in @banana-split/shared so the server and
// webapp format/parse identically (incl. zero-decimal currencies like JPY).
export { currencyDecimals, formatMoney, parseMoney, COMMON_CURRENCIES } from '@banana-split/shared';
