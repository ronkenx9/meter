// The one place money changes units. Three scales meet in METER:
//   - USDZ base units: 18-decimal integers, what the chain and Clearing deposits use.
//   - Millionths: 1e-6 *USDZ, what Clearing counts in; every price and deposit is a whole number of these.
//   - Cents: USD minor units. Airwallex takes major units (0.75), so we hold cents and format at the edge.
// 1 *USDZ is treated as 1 USD. Every conversion is exact or throws.

export type Millionths = bigint & { readonly __unit: "millionths" };
export type BaseUnits = bigint & { readonly __unit: "usdz-base" };
export type Cents = bigint & { readonly __unit: "cents" };

export const MILLIONTHS_PER_USD = 1_000_000n;
export const MILLIONTHS_PER_CENT = 10_000n;
export const BASE_UNITS_PER_MILLIONTH = 1_000_000_000_000n;

export class UnitError extends Error {
  override name = "UnitError";
}

export const millionths = (n: bigint): Millionths => n as Millionths;
export const cents = (n: bigint): Cents => n as Cents;
export const baseUnits = (n: bigint): BaseUnits => n as BaseUnits;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

function parseFixed(value: string, places: number, what: string): bigint {
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new UnitError(`${what}: "${value}" is not a non-negative decimal`);
  const [, whole = "0", frac = ""] = m;
  if (frac.length > places && /[^0]/.test(frac.slice(places))) {
    throw new UnitError(`${what}: "${value}" has more than ${places} decimal places`);
  }
  const padded = (frac + "0".repeat(places)).slice(0, places);
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(padded || "0");
}

function formatFixed(value: bigint, places: number): string {
  if (value < 0n) return "-" + formatFixed(-value, places);
  const scale = 10n ** BigInt(places);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(places, "0");
  return places === 0 ? whole.toString() : `${whole}.${frac}`;
}

/** "0.02" *USDZ -> 20000 millionths. Rejects anything finer than a millionth. */
export function parseUsdz(value: string): Millionths {
  return millionths(parseFixed(value, 6, "USDZ amount"));
}

/** "0.75" USD -> 75 cents. Rejects anything finer than a cent. */
export function parseUsd(value: string | number): Cents {
  const text = typeof value === "number" ? numberToPlainString(value) : value;
  return cents(parseFixed(text, 2, "USD amount"));
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new UnitError(`USD amount: ${n} is not a finite non-negative number`);
  // Airwallex returns JSON numbers like 0.75; 6 places is enough to reveal sub-cent garbage without float noise.
  return n.toFixed(6);
}

export function millionthsToBaseUnits(m: Millionths): BaseUnits {
  return baseUnits(m * BASE_UNITS_PER_MILLIONTH);
}

export function baseUnitsToMillionths(b: bigint): Millionths {
  if (b % BASE_UNITS_PER_MILLIONTH !== 0n) {
    throw new UnitError(`${b} base units is not a whole number of millionths`);
  }
  return millionths(b / BASE_UNITS_PER_MILLIONTH);
}

export function centsToMillionths(c: Cents): Millionths {
  return millionths(c * MILLIONTHS_PER_CENT);
}

/** Exact only: a sub-cent spend cannot be captured on a card, so it throws instead of rounding. */
export function millionthsToCents(m: Millionths): Cents {
  if (m % MILLIONTHS_PER_CENT !== 0n) {
    throw new UnitError(`${formatUsdz(m)} *USDZ is not a whole number of cents`);
  }
  return cents(m / MILLIONTHS_PER_CENT);
}

/** Smallest whole-cent amount covering m; used only to size a hold raise, never a capture. */
export function millionthsToCentsCeil(m: Millionths): Cents {
  return cents((m + MILLIONTHS_PER_CENT - 1n) / MILLIONTHS_PER_CENT);
}

/** Airwallex request body amount: major units as a JSON number, e.g. 75n -> 0.75. */
export function centsToMajor(c: Cents): number {
  return Number(formatFixed(c, 2));
}

export function formatUsd(c: Cents): string {
  return `$${formatFixed(c, 2)}`;
}

export function formatUsdz(m: Millionths): string {
  return formatFixed(m, 6);
}

/** For metal-pay calls that take a decimal string price, e.g. "0.020000". */
export function millionthsToDecimal(m: Millionths): string {
  return formatFixed(m, 6);
}

export function sumMillionths(values: Iterable<Millionths>): Millionths {
  let total = 0n;
  for (const v of values) total += v;
  return millionths(total);
}
