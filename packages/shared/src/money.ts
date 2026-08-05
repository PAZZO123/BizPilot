/**
 * Money is stored everywhere as an integer in the currency's minor unit
 * (cents for USD, and for RWF — which has no subunit in practice — we still
 * use 1/100 so a single code path handles both and rounding never surprises us).
 *
 * Never do arithmetic on floats coming off the wire; parse to minor units first.
 */

export const MINOR_UNITS_PER_MAJOR = 100;

export function toMinor(amount: number): number {
  return Math.round(amount * MINOR_UNITS_PER_MAJOR);
}

export function toMajor(minor: number): number {
  return minor / MINOR_UNITS_PER_MAJOR;
}

/** Currencies that are conventionally displayed without decimal places. */
const ZERO_DECIMAL_DISPLAY = new Set(['RWF', 'UGX', 'TZS', 'BIF', 'JPY', 'KRW']);

export function formatMoney(minor: number, currency = 'RWF', locale = 'en-RW'): string {
  const major = toMajor(minor);
  const fractionDigits = ZERO_DECIMAL_DISPLAY.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // Print the ISO code rather than the local symbol: Intl renders RWF as
      // "RF", which is unfamiliar enough to read as a mistake on an invoice or
      // in an SMS reminder a customer receives.
      currencyDisplay: 'code',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major);
  } catch {
    // Unknown currency code — fall back to a plain number with the code prefixed.
    return `${currency} ${major.toFixed(fractionDigits)}`;
  }
}

/**
 * Flutterwave expects a major-unit amount. For zero-decimal currencies it
 * rejects fractional values outright, so round before sending.
 */
export function toGatewayAmount(minor: number, currency: string): number {
  const major = toMajor(minor);
  return ZERO_DECIMAL_DISPLAY.has(currency) ? Math.round(major) : Number(major.toFixed(2));
}
