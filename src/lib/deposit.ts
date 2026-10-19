/**
 * Deposit arithmetic and validation.
 *
 * Amounts cross three representations in this app, and mixing them is the
 * reason this file exists:
 *
 *   - the API speaks IEEE-754 doubles, so a contract whose milestones are 0.1
 *     and 0.2 arrives with `totalAmount: 0.30000000000000004`, and
 *     `totalAmount - fundedAmount` computes to 0.7999999999999999;
 *   - the user types a decimal string;
 *   - the chain holds integer stroops, 7 decimal places.
 *
 * Partial deposits turn on an exact boundary: a deposit of exactly
 * `total - funded` must be accepted, and `total - funded + 0.0000001` must be
 * rejected. A double cannot answer that reliably — the two round to the same
 * number at these magnitudes — so every comparison here happens in stroops,
 * as bigint.
 */

/** Decimal places in a stroop-denominated amount. */
export const STROOP_DECIMALS = 7;

const SCALE = 10n ** BigInt(STROOP_DECIMALS);

/** Decimal shape only: no sign, no exponent, no grouping. */
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** The fields a deposit needs from a contract. */
export interface FundableContract {
  token: string;
  totalAmount: number;
  fundedAmount: number;
  releasedAmount: number;
  milestones: { amount: number; released: boolean }[];
}

export type DepositCheck = { ok: true; amount: number } | { ok: false; error: string };

/**
 * Parse a typed amount into stroops, or `null` when it is not a plain decimal
 * with at most 7 decimal places.
 */
export function parseStroops(input: string): bigint | null {
  const text = input.trim();
  if (!DECIMAL.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > STROOP_DECIMALS) return null;
  const padded = fraction.padEnd(STROOP_DECIMALS, '0');
  return BigInt(whole || '0') * SCALE + BigInt(padded);
}

/** Whether the text is at least decimal-shaped, so the error can be specific. */
export function isDecimalShape(input: string): boolean {
  return DECIMAL.test(input.trim());
}

/**
 * Convert an API double to stroops.
 *
 * `toFixed` snaps the double's representation error to the nearest stroop —
 * 0.30000000000000004 becomes "0.3000000" — which is what the chain holds. It
 * does not invent digits the double never had.
 */
export function toStroops(value: number): bigint {
  if (!Number.isFinite(value) || value === 0) return 0n;
  const magnitude = Math.abs(value);
  const fixed = magnitude.toFixed(STROOP_DECIMALS);
  // toFixed switches to exponent notation at 1e21. Past that magnitude the
  // double has no fraction left to preserve, so the integer path is exact for
  // everything the double actually holds.
  const parsed = fixed.includes('e')
    ? BigInt(Math.round(magnitude)) * SCALE
    : parseStroops(fixed) ?? 0n;
  return value < 0 ? -parsed : parsed;
}

/** Plain decimal string, suitable for an `<input>` value. */
export function toDecimalString(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(STROOP_DECIMALS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Grouped for display, e.g. "1,250.5". */
export function formatStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = new Intl.NumberFormat('en-US').format(abs / SCALE);
  const fraction = (abs % SCALE).toString().padStart(STROOP_DECIMALS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** The API takes a double; this is the closest one to the exact value. */
export function fromStroops(stroops: bigint): number {
  return Number(toDecimalString(stroops));
}

/** How much more this contract will accept. Never negative. */
export function remainingStroops(contract: FundableContract): bigint {
  const remaining = toStroops(contract.totalAmount) - toStroops(contract.fundedAmount);
  return remaining > 0n ? remaining : 0n;
}

/**
 * The smallest additional deposit that makes the next unreleased milestone
 * releasable: `max(0, milestone.amount - (funded - released))`.
 *
 * Zero means the next milestone is already covered, and the preset is hidden.
 */
export function nextMilestoneStroops(contract: FundableContract): bigint {
  const next = contract.milestones.find((m) => !m.released);
  if (!next) return 0n;
  const available = toStroops(contract.fundedAmount) - toStroops(contract.releasedAmount);
  const needed = toStroops(next.amount) - available;
  return needed > 0n ? needed : 0n;
}

/**
 * Validate a typed deposit against the contract's remaining balance.
 *
 * The upper bound is checked in stroops, so `amount == remaining` is accepted
 * and `remaining + 0.0000001` is rejected — the two are indistinguishable as
 * doubles at some magnitudes, which is exactly the case that matters here.
 */
export function validateDeposit(input: string, contract: FundableContract): DepositCheck {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter an amount to deposit.' };
  if (!isDecimalShape(text)) return { ok: false, error: 'Enter a number, for example 0.5.' };

  const stroops = parseStroops(text);
  if (stroops === null) {
    return { ok: false, error: `Use at most ${STROOP_DECIMALS} decimal places.` };
  }
  if (stroops <= 0n) return { ok: false, error: 'Enter an amount greater than 0.' };

  const remaining = remainingStroops(contract);
  if (remaining <= 0n) return { ok: false, error: 'This escrow is already fully funded.' };
  if (stroops > remaining) {
    return {
      ok: false,
      error: `Enter at most ${formatStroops(remaining)} ${contract.token}, the remaining balance.`,
    };
  }
  return { ok: true, amount: fromStroops(stroops) };
}
