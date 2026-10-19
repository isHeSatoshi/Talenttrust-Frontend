import { describe, expect, it } from 'vitest';
import {
  AmountError,
  add,
  formatAmount,
  formatUnits,
  fromApiNumber,
  gte,
  isZero,
  lt,
  parseAmount,
  percentage,
  STROOP_DECIMALS,
  sub,
  sumAmounts,
  toApiNumber,
} from './amount';

/** Deterministic PRNG so a failing property case is reproducible from its seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNIT = 10n ** BigInt(STROOP_DECIMALS);

describe('parseAmount — accepted forms', () => {
  const cases: Array<[string, bigint]> = [
    ['0', 0n],
    ['1', 1n * UNIT],
    ['1.5', (15n * UNIT) / 10n],
    ['.5', UNIT / 2n],
    ['5.', 5n * UNIT],
    ['0.0000001', 1n], // one stroop
    ['1.2345678', 12345678n],
    ['+2', 2n * UNIT],
    ['  3.25  ', (325n * UNIT) / 100n],
  ];

  it.each(cases)('parses %j', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('accepts grouping only when explicitly allowed', () => {
    expect(() => parseAmount('1,000.25')).toThrow(AmountError);
    expect(parseAmount('1,000.25', { allowGrouping: true })).toBe(1000n * UNIT + UNIT / 4n);
    expect(parseAmount('12,345,678', { allowGrouping: true })).toBe(12345678n * UNIT);
  });

  it('rejects malformed grouping even when grouping is allowed', () => {
    for (const bad of ['1,00.25', ',100', '100,', '1,0000', '1,,000']) {
      expect(() => parseAmount(bad, { allowGrouping: true })).toThrow(AmountError);
    }
  });

  it('accepts a negative only when allowed', () => {
    expect(() => parseAmount('-1')).toThrow(AmountError);
    expect(parseAmount('-1', { allowNegative: true })).toBe(-1n * UNIT);
    expect(parseAmount('-0.5', { allowNegative: true })).toBe(-UNIT / 2n);
  });

  it('honours a custom scale', () => {
    // 2 decimals: 1.23 -> 123
    expect(parseAmount('1.23', 2)).toBe(123n);
    expect(() => parseAmount('1.234', 2)).toThrow(AmountError);
  });
});

describe('parseAmount — rejection table', () => {
  const table: Array<[string, string]> = [
    ['1e3', 'exponent'],
    ['1E3', 'exponent'],
    ['-1', 'negative'],
    ['1.12345678', 'too-many-decimals'],
    ['abc', 'invalid-characters'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['1.2.3', 'invalid-characters'],
    ['1,000.25', 'grouping'],
    ['$5', 'invalid-characters'],
  ];

  it.each(table)('rejects %j with reason %s', (input, reason) => {
    try {
      parseAmount(input);
      throw new Error(`expected ${JSON.stringify(input)} to be rejected`);
    } catch (err) {
      expect(err).toBeInstanceOf(AmountError);
      expect((err as AmountError).reason).toBe(reason);
    }
  });

  it('carries copy suitable for display', () => {
    const err = (() => {
      try {
        parseAmount('1e3');
      } catch (e) {
        return e as AmountError;
      }
      throw new Error('unreachable');
    })();
    expect(err.message).toMatch(/exponent notation/i);
  });
});

describe('formatAmount', () => {
  it('trims trailing zeros', () => {
    expect(formatAmount(1n * UNIT, { locale: 'en-US' })).toBe('1');
    expect(formatAmount((15n * UNIT) / 10n, { locale: 'en-US' })).toBe('1.5');
    expect(formatAmount(UNIT / 2n, { locale: 'en-US' })).toBe('0.5');
    expect(formatAmount(0n, { locale: 'en-US' })).toBe('0');
  });

  it('groups thousands and appends the token', () => {
    expect(formatAmount(1000n * UNIT + UNIT / 4n, { locale: 'en-US', token: 'XLM' }))
      .toBe('1,000.25 XLM');
  });

  it('uses the locale decimal separator', () => {
    // German uses '.' for grouping and ',' for decimals.
    expect(formatAmount((15n * UNIT) / 10n, { locale: 'de-DE' })).toBe('1,5');
  });

  it('is exact beyond Number.MAX_SAFE_INTEGER', () => {
    // 2^100 stroops = 126765060022822940149670.3205376 units. A double cannot
    // hold this: Number(2n ** 100n) is 1.2676506002282294e+30, which has lost
    // the low digits entirely.
    const huge = 2n ** 100n;
    const rendered = formatAmount(huge, { locale: 'en-US' });
    expect(rendered).not.toMatch(/e\+/i);
    expect(rendered).toBe('126,765,060,022,822,940,149,670.3205376');
    // ...and it survives the round trip, which a double could not.
    expect(parseAmount(rendered, { allowGrouping: true })).toBe(huge);
  });

  it('keeps the sign of a value between -1 and 0', () => {
    // Regression: the sign used to be applied to the integer part, and BigInt
    // has no negative zero, so -2097151 stroops rendered as "0.2097151" and
    // parsed back positive. Caught by the property test below.
    expect(formatAmount(-2097151n, { locale: 'en-US' })).toBe('-0.2097151');
    expect(formatAmount(-1n, { locale: 'en-US' })).toBe('-0.0000001');
    expect(formatAmount(-UNIT, { locale: 'en-US' })).toBe('-1');
    expect(formatAmount(-UNIT, { locale: 'en-US', token: 'XLM' })).toBe('-1 XLM');
    expect(parseAmount('-0.2097151', { allowNegative: true })).toBe(-2097151n);
  });

  it('caps fraction digits when asked', () => {
    expect(formatAmount((1234567n * UNIT) / 10000000n, { locale: 'en-US', maxFractionDigits: 3 }))
      .toBe('0.123');
  });
});

describe('round trip (property-style)', () => {
  it('parseAmount(formatAmount(x)) === x for random values up to 2^100', () => {
    const rand = mulberry32(20261019);
    const LIMIT = 2n ** 100n;
    for (let i = 0; i < 400; i += 1) {
      // Build a random value across the whole range, mixing magnitudes so small
      // values are covered as well as huge ones.
      const bits = BigInt(Math.floor(rand() * 101));
      const value = BigInt(Math.floor(rand() * Number.MAX_SAFE_INTEGER)) % (2n ** bits || 1n);
      const signed = rand() < 0.5 ? value : -value;
      const text = formatAmount(signed, { locale: 'en-US' });
      expect(parseAmount(text, { allowGrouping: true, allowNegative: true })).toBe(signed);
      expect(signed).toBeLessThan(LIMIT + 1n);
    }
  });

  it('formatUnits round-trips exactly with no grouping involved', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 300; i += 1) {
      const value = BigInt(Math.floor(rand() * Number.MAX_SAFE_INTEGER)) * 7n - 3n;
      expect(parseAmount(formatUnits(value))).toBe(value);
    }
  });
});

describe('fromApiNumber / toApiNumber', () => {
  it('converts the API number path exactly', () => {
    expect(fromApiNumber(0.3)).toBe((3n * UNIT) / 10n);
    expect(fromApiNumber(300)).toBe(300n * UNIT);
    expect(fromApiNumber(0.0000001)).toBe(1n);
  });

  it('rejects a non-finite number', () => {
    expect(() => fromApiNumber(Number.NaN)).toThrow(AmountError);
    expect(() => fromApiNumber(Number.POSITIVE_INFINITY)).toThrow(AmountError);
  });

  it('round-trips through the API representation', () => {
    for (const n of [0, 1, 0.1, 0.3, 12.3456789, 1_000_000.25]) {
      expect(toApiNumber(fromApiNumber(n))).toBe(n);
    }
  });
});

describe('arithmetic helpers', () => {
  it('does exact arithmetic that float math gets wrong', () => {
    // The headline bug: 0.1 + 0.2 !== 0.3 as doubles.
    const tenth = fromApiNumber(0.1);
    const fifth = fromApiNumber(0.2);
    const threeTenths = fromApiNumber(0.3);
    expect(add(tenth, fifth)).toBe(threeTenths);
    expect(sub(threeTenths, fifth)).toBe(tenth);
    expect(gte(threeTenths, threeTenths)).toBe(true);
    expect(lt(threeTenths, fifth)).toBe(false);
    expect(isZero(sub(threeTenths, threeTenths))).toBe(true);
    expect(sumAmounts([tenth, fifth])).toBe(threeTenths);
  });

  it('sums an empty list to zero', () => {
    expect(sumAmounts([])).toBe(0n);
  });

  it('computes a percentage without float artefacts', () => {
    expect(percentage(threeTenths(), 1n * UNIT)).toBe(30);
    expect(percentage(0n, 1n * UNIT)).toBe(0);
    expect(percentage(1n * UNIT, 0n)).toBe(0); // not NaN
    expect(percentage(1n * UNIT, 3n * UNIT)).toBe(33);
  });
});

/** The regression fixture from the issue: milestones 0.1 + 0.2, funded 0.3. */
function threeTenths(): bigint {
  return fromApiNumber(0.3);
}

describe('regression: milestones 0.1 and 0.2 funded 0.3', () => {
  const milestoneA = fromApiNumber(0.1);
  const milestoneB = fromApiNumber(0.2);
  const funded = fromApiNumber(0.3);
  const released = 0n;

  it('the release guard is true for both milestones', () => {
    // The bug: with doubles, 0.1 + 0.2 > 0.3, so the guard could be wrongly false.
    const inEscrow = sub(funded, released);
    expect(gte(inEscrow, milestoneA)).toBe(true);
    expect(gte(inEscrow, milestoneB)).toBe(true);
  });

  it('displays 0.3 XLM, not 0.30000000000000004', () => {
    const inEscrow = sub(funded, released);
    expect(formatAmount(inEscrow, { token: 'XLM', locale: 'en-US' })).toBe('0.3 XLM');
    expect(formatAmount(inEscrow, { token: 'XLM', locale: 'en-US' }))
      .not.toMatch(/0\.3000/);
  });

  it('the total funded by both milestones equals the funded amount', () => {
    expect(sumAmounts([milestoneA, milestoneB])).toBe(funded);
  });
});
