/**
 * All monetary arithmetic happens in BigInt minor units. These helpers are the
 * only place we cross between BigInt and number, so rounding decisions live in
 * one file rather than being re-invented per service.
 */

/** Largest value we can hand to the frontend as a plain JSON number. */
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** Parse a major-unit amount from a request body into minor units. */
export function parseMoney(major: number | string | undefined | null): bigint {
  if (major === undefined || major === null || major === '') return 0n;
  const value = typeof major === 'string' ? Number(major) : major;
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid monetary amount: ${major}`);
  }
  return BigInt(Math.round(value * 100));
}

/** Convert minor units to a plain number for JSON responses. */
export function toNumber(minor: bigint): number {
  if (minor > MAX_SAFE_MINOR || minor < -MAX_SAFE_MINOR) {
    // 90 trillion RWF. If a real business hits this, the bug is upstream.
    throw new Error('Monetary value exceeds the safe JSON integer range');
  }
  return Number(minor);
}

/** Multiply a money amount by an integer quantity. */
export function multiply(minor: bigint, quantity: number): bigint {
  return minor * BigInt(Math.trunc(quantity));
}

/**
 * Apply a rate given in basis points (1800 = 18%), rounding half-up.
 * Integer-only so the result never drifts by a franc.
 */
export function applyBps(minor: bigint, bps: number): bigint {
  if (!bps) return 0n;
  const numerator = minor * BigInt(Math.round(bps));
  const denominator = 10000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  // Round half away from zero.
  const roundUp = remainder * 2n >= denominator;
  const roundDown = remainder * 2n <= -denominator;
  if (roundUp) return quotient + 1n;
  if (roundDown) return quotient - 1n;
  return quotient;
}

export function sum(values: bigint[]): bigint {
  return values.reduce((acc, value) => acc + value, 0n);
}

export function clampNonNegative(minor: bigint): bigint {
  return minor < 0n ? 0n : minor;
}
