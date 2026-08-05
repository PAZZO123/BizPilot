/**
 * Every money value crossing the API is an integer in minor units (RWF x100).
 * Nothing here ever does float arithmetic on money — it only formats for
 * display and parses what the user types at the single input boundary.
 */

const ZERO_DECIMAL = new Set(['RWF', 'UGX', 'TZS', 'BIF', 'JPY', 'KRW']);

export function formatMoney(minor: number, currency = 'RWF'): string {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-RW', {
      style: 'currency',
      currency,
      // `currencyDisplay: 'code'` prints the ISO code — "RWF 1,200". Left to
      // itself Intl uses the local symbol and renders RWF as "RF", which reads
      // as a typo to anyone who has not seen it before.
      currencyDisplay: 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(digits)}`;
  }
}

/** Compact form for chart axes and stat tiles: RWF 1.2M rather than RWF 1,200,000. */
export function formatMoneyShort(minor: number, currency = 'RWF'): string {
  const major = minor / 100;
  const abs = Math.abs(major);

  if (abs >= 1_000_000) return `${currency} ${(major / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${currency} ${(major / 1_000).toFixed(0)}K`;
  return `${currency} ${major.toFixed(0)}`;
}

/** Turns what the user typed ("1,200" or "1200.50") into minor units. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^\d.-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** Minor units back into a plain editable string for an input field. */
export function toMoneyInput(minor: number, currency = 'RWF'): string {
  return ZERO_DECIMAL.has(currency) ? String(Math.round(minor / 100)) : (minor / 100).toFixed(2);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-RW').format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "2 hours ago" — friendlier than a timestamp in an activity list. */
export function formatRelative(value: string | Date): string {
  const date = new Date(value);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first, so
 * for a shop in Kigali (UTC+2) the 1st of the month comes back as the 31st of
 * the previous one, and just after midnight "today" is yesterday. Report ranges
 * have to follow the shopkeeper's calendar, not Greenwich's.
 */
function localIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return localIso(new Date());
}

export function firstOfMonthIso(): string {
  const now = new Date();
  return localIso(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function daysAgoIso(days: number): string {
  return localIso(new Date(Date.now() - days * 86_400_000));
}
