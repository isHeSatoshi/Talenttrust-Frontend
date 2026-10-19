import { describe, expect, it } from 'vitest';
import {
  formatStroops,
  fromStroops,
  nextMilestoneStroops,
  parseStroops,
  remainingStroops,
  toDecimalString,
  toStroops,
  validateDeposit,
  type FundableContract,
} from './deposit';

const contract = (over: Partial<FundableContract> = {}): FundableContract => ({
  token: 'XLM',
  totalAmount: 1000,
  fundedAmount: 0,
  releasedAmount: 0,
  milestones: [
    { amount: 300, released: false },
    { amount: 700, released: false },
  ],
  ...over,
});

/** XLM to stroops, so the expectations below read in the unit the fixtures use. */
const xlm = (amount: number) => BigInt(amount) * 10_000_000n;

describe('parseStroops', () => {
  it.each([
    ['1', 10_000_000n],
    ['1.5', 15_000_000n],
    ['.5', 5_000_000n],
    ['5.', 50_000_000n],
    ['0', 0n],
    ['0.0000001', 1n],
    ['  12.25  ', 122_500_000n],
  ])('parses %s', (input, expected) => {
    expect(parseStroops(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['abc', 'non-numeric'],
    ['1e3', 'exponent notation'],
    ['1E3', 'upper-case exponent'],
    ['-1', 'negative'],
    ['+1', 'explicit plus'],
    ['1,000', 'grouping'],
    ['1.2.3', 'two decimal points'],
    ['$5', 'currency symbol'],
    ['0.00000001', 'eight decimal places'],
    ['1.12345678', 'eight decimal places on a whole'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
  ])('rejects %s (%s)', (input) => {
    expect(parseStroops(input)).toBeNull();
  });
});

describe('stroop conversion', () => {
  it('snaps a double to the stroop the chain holds', () => {
    // The API sends these exact doubles for milestones of 0.1 and 0.2.
    expect(toStroops(0.30000000000000004)).toBe(3_000_000n);
    expect(toStroops(0.7999999999999999)).toBe(8_000_000n);
    expect(toStroops(5.551115123125783e-17)).toBe(0n);
    expect(toStroops(0.1)).toBe(1_000_000n);
  });

  it('handles zero, negatives and non-finite input', () => {
    expect(toStroops(0)).toBe(0n);
    expect(toStroops(-1.5)).toBe(-15_000_000n);
    expect(toStroops(NaN)).toBe(0n);
    expect(toStroops(Infinity)).toBe(0n);
  });

  it('round-trips through the API double', () => {
    expect(fromStroops(3_000_000n)).toBe(0.3);
    expect(fromStroops(1n)).toBe(1e-7);
    expect(fromStroops(0n)).toBe(0);
  });

  it('renders plain and grouped forms', () => {
    expect(toDecimalString(3_000_000n)).toBe('0.3');
    expect(toDecimalString(1n)).toBe('0.0000001');
    expect(toDecimalString(0n)).toBe('0');
    expect(formatStroops(12_500_000_000n)).toBe('1,250');
    expect(formatStroops(3_000_000n)).toBe('0.3');
    expect(formatStroops(-15_000_000n)).toBe('-1.5');
  });
});

describe('remainingStroops', () => {
  it('is the gap between total and funded', () => {
    expect(remainingStroops(contract())).toBe(xlm(1000));
    expect(remainingStroops(contract({ fundedAmount: 300 }))).toBe(xlm(700));
  });

  it('never goes negative', () => {
    expect(remainingStroops(contract({ fundedAmount: 1200 }))).toBe(0n);
  });

  it('is exact when the doubles are not', () => {
    // 0.3 - 0.1 is 0.19999999999999998 as a double; the remaining balance is 0.2.
    const fractional = contract({
      totalAmount: 0.3,
      fundedAmount: 0.1,
      milestones: [{ amount: 0.2, released: false }],
    });
    expect(remainingStroops(fractional)).toBe(2_000_000n);
  });
});

describe('nextMilestoneStroops', () => {
  it('is the next milestone when nothing is funded', () => {
    expect(nextMilestoneStroops(contract())).toBe(xlm(300));
  });

  it('is reduced by what is already available', () => {
    expect(nextMilestoneStroops(contract({ fundedAmount: 100 }))).toBe(xlm(200));
  });

  it('is zero once the next milestone is covered', () => {
    expect(nextMilestoneStroops(contract({ fundedAmount: 300 }))).toBe(0n);
  });

  it('accounts for what has already been released', () => {
    // 400 funded, 300 released, so 100 is available against a 700 milestone.
    expect(
      nextMilestoneStroops(
        contract({
          fundedAmount: 400,
          releasedAmount: 300,
          milestones: [
            { amount: 300, released: true },
            { amount: 700, released: false },
          ],
        }),
      ),
    ).toBe(xlm(600));
  });

  it('is zero when there is no unreleased milestone', () => {
    expect(
      nextMilestoneStroops(
        contract({ milestones: [{ amount: 300, released: true }] }),
      ),
    ).toBe(0n);
  });

  it('is zero rather than negative when the next milestone is over-funded', () => {
    expect(nextMilestoneStroops(contract({ fundedAmount: 500 }))).toBe(0n);
  });
});

describe('validateDeposit', () => {
  it.each([
    ['', 'Enter an amount to deposit.'],
    ['   ', 'Enter an amount to deposit.'],
    ['abc', 'Enter a number, for example 0.5.'],
    ['1e3', 'Enter a number, for example 0.5.'],
    ['-5', 'Enter a number, for example 0.5.'],
    ['1,000', 'Enter a number, for example 0.5.'],
    ['$5', 'Enter a number, for example 0.5.'],
    ['0', 'Enter an amount greater than 0.'],
    ['0.0', 'Enter an amount greater than 0.'],
    ['1.12345678', 'Use at most 7 decimal places.'],
    ['1000.1', 'Enter at most 1,000 XLM, the remaining balance.'],
  ])('rejects %s', (input, error) => {
    expect(validateDeposit(input, contract())).toEqual({ ok: false, error });
  });

  it('rejects a deposit against a fully funded escrow', () => {
    expect(validateDeposit('1', contract({ fundedAmount: 1000 }))).toEqual({
      ok: false,
      error: 'This escrow is already fully funded.',
    });
  });

  it('accepts a partial deposit and returns the number for the API body', () => {
    expect(validateDeposit('300', contract())).toEqual({ ok: true, amount: 300 });
    expect(validateDeposit('0.5', contract())).toEqual({ ok: true, amount: 0.5 });
  });

  it('accepts the smallest representable amount, one stroop', () => {
    expect(validateDeposit('0.0000001', contract())).toEqual({ ok: true, amount: 1e-7 });
  });

  it('accepts exactly the remaining balance', () => {
    expect(validateDeposit('1000', contract())).toEqual({ ok: true, amount: 1000 });
    expect(validateDeposit('700', contract({ fundedAmount: 300 }))).toEqual({
      ok: true,
      amount: 700,
    });
  });

  it('rejects one stroop more than the remaining balance', () => {
    expect(validateDeposit('1000.0000001', contract())).toEqual({
      ok: false,
      error: 'Enter at most 1,000 XLM, the remaining balance.',
    });
  });

  describe('the fractional boundary, where doubles are not enough', () => {
    const fractional = contract({
      totalAmount: 0.3,
      fundedAmount: 0.1,
      milestones: [{ amount: 0.2, released: false }],
    });

    it('accepts exactly the remainder even though 0.3 - 0.1 is 0.19999999999999998', () => {
      // A naive `amount > total - funded` comparison rejects this valid deposit.
      expect(0.3 - 0.1).toBeLessThan(0.2);
      expect(validateDeposit('0.2', fractional)).toEqual({ ok: true, amount: 0.2 });
    });

    it('rejects one stroop more', () => {
      expect(validateDeposit('0.2000001', fractional)).toEqual({
        ok: false,
        error: 'Enter at most 0.2 XLM, the remaining balance.',
      });
    });
  });

  it('treats a total that arrived with float noise as fully funded', () => {
    // 0.1 + 0.2 arrives as 0.30000000000000004; funding 0.3 completes it.
    const noisy = contract({
      totalAmount: 0.30000000000000004,
      fundedAmount: 0.3,
      milestones: [{ amount: 0.1, released: false }],
    });
    expect(remainingStroops(noisy)).toBe(0n);
    expect(validateDeposit('0.1', noisy)).toEqual({
      ok: false,
      error: 'This escrow is already fully funded.',
    });
  });
});
