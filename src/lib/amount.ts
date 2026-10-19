/**
 * Exact decimal amounts.
 *
 * On-chain, escrow amounts are `i128` stroops (7 decimals). In the UI they were
 * JavaScript `number`s, so `0.1 + 0.2` displayed as `0.30000000000000004` and the
 * Release guard (`funded - released >= next`) could be wrongly false.
 *
 * This module is the single place amounts are parsed, compared and formatted.
 * Values are `bigint` stroops; nothing here goes through a float, so precision
 * does not depend on magnitude.
 */

/** Decimal places of a stroop. Stellar uses 7. */
export const STROOP_DECIMALS = 7;

const TEN = 10n;

/** Why a string could not be read as an amount. */
export type AmountErrorReason =
  | 'empty'
  | 'invalid-characters'
  | 'exponent'
  | 'grouping'
  | 'too-many-decimals'
  | 'negative';

const REASON_MESSAGES: Record<AmountErrorReason, string> = {
  empty: 'Enter an amount.',
  'invalid-characters': 'Amounts may only contain digits and a decimal point.',
  exponent: 'Exponent notation is not supported. Write the amount out in full.',
  grouping: 'Digit grouping is malformed. Use groups of three, like 1,000.25.',
  'too-many-decimals': `Amounts support at most ${STROOP_DECIMALS} decimal places.`,
  negative: 'Amounts cannot be negative.',
};

export class AmountError extends Error {
  readonly reason: AmountErrorReason;

  constructor(reason: AmountErrorReason, message?: string) {
    super(message ?? REASON_MESSAGES[reason]);
    this.name = 'AmountError';
    this.reason = reason;
    Object.setPrototypeOf(this, AmountError.prototype);
  }
}

export interface ParseAmountOptions {
  /** Decimal places to scale by. Defaults to {@link STROOP_DECIMALS}. */
  decimals?: number;
  /** Accept `1,000.25`. Off by default, so a stray comma is an error. */
  allowGrouping?: boolean;
  /** Accept a leading `-`. Off by default. */
  allowNegative?: boolean;
}

export interface FormatAmountOptions {
  /** Appended after the number, e.g. `XLM`. */
  token?: string;
  /** BCP-47 locale. Defaults to the runtime locale. */
  locale?: string;
  /** Cap the fraction digits shown. Trailing zeros are always trimmed. */
  maxFractionDigits?: number;
}

/** `10n ** BigInt(decimals)`, the number of stroops in one unit. */
function unit(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  return TEN ** BigInt(decimals);
}

function resolveDecimals(decimalsOrOptions: number | ParseAmountOptions | undefined): Required<ParseAmountOptions> {
  const opts = typeof decimalsOrOptions === 'number'
    ? { decimals: decimalsOrOptions }
    : decimalsOrOptions ?? {};
  return {
    decimals: opts.decimals ?? STROOP_DECIMALS,
    allowGrouping: opts.allowGrouping ?? false,
    allowNegative: opts.allowNegative ?? false,
  };
}

/**
 * Read a decimal string into scaled `bigint` units.
 *
 * Accepts `1`, `1.5`, `.5`, `5.` and — only when `allowGrouping` is set —
 * `1,000.25`. Rejects exponent notation, a negative sign unless allowed, more
 * fraction digits than `decimals`, and anything non-numeric.
 *
 * @throws {AmountError} with a `reason` suitable for choosing UI copy.
 */
export function parseAmount(
  input: string,
  decimalsOrOptions?: number | ParseAmountOptions,
): bigint {
  const { decimals, allowGrouping, allowNegative } = resolveDecimals(decimalsOrOptions);

  const raw = (input ?? '').trim();
  if (raw === '') throw new AmountError('empty');

  // Checked before anything else so `1e3` is reported as exponent notation
  // rather than as an invalid character.
  if (/[eE]/.test(raw)) throw new AmountError('exponent');

  let body = raw;
  let negative = false;
  if (body.startsWith('-')) {
    if (!allowNegative) throw new AmountError('negative');
    negative = true;
    body = body.slice(1);
  } else if (body.startsWith('+')) {
    body = body.slice(1);
  }

  if (body === '') throw new AmountError('invalid-characters');

  if (body.includes(',')) {
    if (!allowGrouping) throw new AmountError('grouping');
    // Well-formed grouping only: 1,000 / 12,345,678. A leading, trailing or
    // short group is a typo, not a number.
    const [intPart = ''] = body.split('.');
    if (!/^\d{1,3}(,\d{3})+$/.test(intPart)) throw new AmountError('grouping');
    body = body.replace(/,/g, '');
  }

  if (!/^\d*\.?\d*$/.test(body)) throw new AmountError('invalid-characters');

  const [intPart = '', fracPart = ''] = body.split('.');
  if (intPart === '' && fracPart === '') throw new AmountError('invalid-characters');
  if (fracPart.length > decimals) throw new AmountError('too-many-decimals');

  // Pad the fraction to the target scale so the multiplication is exact.
  const scaled = BigInt(intPart || '0') * unit(decimals) +
    BigInt(fracPart.padEnd(decimals, '0') || '0');

  return negative ? -scaled : scaled;
}

/** Render scaled `bigint` units as a plain decimal string, with no grouping. */
export function formatUnits(value: bigint, decimals = STROOP_DECIMALS): string {
  const scale = unit(decimals);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const int = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = frac ? `${int}.${frac}` : `${int}`;
  return negative ? `-${body}` : body;
}

/**
 * Format for display, e.g. `1,000.25 XLM`.
 *
 * The integer part is grouped by `Intl.NumberFormat` using the `bigint` form,
 * and the fraction is appended as a string, so a value larger than
 * `Number.MAX_SAFE_INTEGER` is still rendered exactly.
 */
export function formatAmount(value: bigint, options: FormatAmountOptions = {}): string {
  const { token, locale, maxFractionDigits = STROOP_DECIMALS } = options;

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = unit(STROOP_DECIMALS);
  const int = abs / scale;
  let frac = (abs % scale).toString().padStart(STROOP_DECIMALS, '0').replace(/0+$/, '');
  if (frac.length > maxFractionDigits) frac = frac.slice(0, maxFractionDigits);
  frac = frac.replace(/0+$/, '');

  const grouping = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  // Group the MAGNITUDE and add the sign to the finished string. BigInt has no
  // negative zero, so signing the integer part would silently drop the sign of
  // any value between -1 and 0 (e.g. -2097151 stroops rendered as "0.2097151").
  const groupedInt = grouping.format(int);

  // The decimal separator is locale-dependent (`,` in much of Europe), so it is
  // read from the formatter rather than assumed to be `.`.
  const decimalSeparator = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((p) => p.type === 'decimal')?.value ?? '.';

  const body = frac ? `${groupedInt}${decimalSeparator}${frac}` : groupedInt;
  const signed = negative ? `-${body}` : body;
  return token ? `${signed} ${token}` : signed;
}

/**
 * Read a number from the API.
 *
 * The API sends JSON numbers, so the value is already an IEEE-754 double and
 * precision beyond ~15 significant digits is gone before we see it. This
 * converts exactly what the double holds, via its shortest decimal
 * representation rounded to `decimals` places — it does not invent digits.
 */
export function fromApiNumber(n: number, decimals = STROOP_DECIMALS): bigint {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new AmountError('invalid-characters', `Not a finite number: ${String(n)}`);
  }
  const fixed = n.toFixed(decimals);
  const negative = fixed.startsWith('-');
  return parseAmount(negative ? fixed.slice(1) : fixed, {
    decimals,
    allowNegative: false,
  }) * (negative ? -1n : 1n);
}

/** Convert scaled units back to a number for a request body. */
export function toApiNumber(value: bigint, decimals = STROOP_DECIMALS): number {
  return Number(formatUnits(value, decimals));
}

// --- Arithmetic -------------------------------------------------------------
// Plain bigint operations. Exported so call sites do not reach for `-` and `>=`
// on numbers by habit and reintroduce the bug this module exists to prevent.

export const sub = (a: bigint, b: bigint): bigint => a - b;
export const add = (a: bigint, b: bigint): bigint => a + b;
export const gte = (a: bigint, b: bigint): boolean => a >= b;
export const lt = (a: bigint, b: bigint): boolean => a < b;
export const isZero = (a: bigint): boolean => a === 0n;

/** Sum scaled units, exactly. */
export const sumAmounts = (values: readonly bigint[]): bigint =>
  values.reduce((acc, v) => acc + v, 0n);

/**
 * `part / whole` as a whole-number percentage.
 *
 * Computed in bigint with explicit rounding so the result cannot inherit a
 * float artefact; `whole === 0` yields 0 rather than `NaN`.
 */
export function percentage(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  const pct = (part * 100n) / whole;
  return Number(pct);
}
