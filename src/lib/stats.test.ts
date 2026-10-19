import { describe, expect, it } from 'vitest';
import { parseStats, STATUSES } from './api';

const valid = {
  contracts: 2,
  byStatus: { Funded: 1, Completed: 1 },
  totalEscrowed: 1250,
  totalReleased: 2250,
};

describe('parseStats', () => {
  it('accepts the shape the API actually returns', () => {
    const stats = parseStats(valid);
    expect(stats.contracts).toBe(2);
    expect(stats.totalEscrowed).toBe(1250);
    expect(stats.totalReleased).toBe(2250);
    expect(stats.byStatus.Funded).toBe(1);
    expect(stats.byStatus.Completed).toBe(1);
  });

  it('fills statuses the API omitted with 0', () => {
    // The endpoint only reports statuses that have contracts, so a missing key
    // must not become `undefined` in the breakdown.
    const stats = parseStats(valid);
    for (const status of STATUSES) {
      expect(typeof stats.byStatus[status]).toBe('number');
    }
    expect(stats.byStatus.Created).toBe(0);
    expect(stats.byStatus.Disputed).toBe(0);
    expect(stats.byStatus.Resolved).toBe(0);
    expect(stats.byStatus.Cancelled).toBe(0);
  });

  it('accepts an empty platform', () => {
    const stats = parseStats({ contracts: 0, byStatus: {}, totalEscrowed: 0, totalReleased: 0 });
    expect(stats.contracts).toBe(0);
    expect(STATUSES.every((s) => stats.byStatus[s] === 0)).toBe(true);
  });

  it('accepts large numbers', () => {
    const stats = parseStats({ ...valid, contracts: 1e9, totalEscrowed: 123456789012 });
    expect(stats.contracts).toBe(1e9);
    expect(stats.totalEscrowed).toBe(123456789012);
  });

  it('rejects a non-object payload', () => {
    expect(() => parseStats(null)).toThrow(/not an object/);
    expect(() => parseStats('nope')).toThrow(/not an object/);
    expect(() => parseStats(42)).toThrow(/not an object/);
    expect(() => parseStats(undefined)).toThrow(/not an object/);
  });

  it('rejects missing or non-numeric totals', () => {
    expect(() => parseStats({ byStatus: {} })).toThrow(/numeric totals/);
    expect(() => parseStats({ ...valid, contracts: '2' })).toThrow(/numeric totals/);
    expect(() => parseStats({ ...valid, totalEscrowed: null })).toThrow(/numeric totals/);
  });

  it('rejects a negative or non-finite total instead of rendering it', () => {
    expect(() => parseStats({ ...valid, totalReleased: -1 })).toThrow(/numeric totals/);
    expect(() => parseStats({ ...valid, contracts: Number.NaN })).toThrow(/numeric totals/);
    expect(() => parseStats({ ...valid, contracts: Number.POSITIVE_INFINITY })).toThrow(
      /numeric totals/,
    );
  });

  it('rejects a missing breakdown', () => {
    const { byStatus: _omitted, ...withoutStatus } = valid;
    expect(() => parseStats(withoutStatus)).toThrow(/status breakdown/);
    expect(() => parseStats({ ...valid, byStatus: null })).toThrow(/status breakdown/);
  });

  it('rejects a non-numeric count for a known status', () => {
    expect(() => parseStats({ ...valid, byStatus: { Funded: 'one' } })).toThrow(
      /non-numeric count for Funded/,
    );
    expect(() => parseStats({ ...valid, byStatus: { Disputed: -3 } })).toThrow(
      /non-numeric count for Disputed/,
    );
  });

  it('ignores unknown statuses rather than failing', () => {
    // A newer backend adding a status must not break this client.
    const stats = parseStats({ ...valid, byStatus: { Funded: 1, SomethingNew: 4 } });
    expect(stats.byStatus.Funded).toBe(1);
    expect(Object.keys(stats.byStatus).sort()).toEqual([...STATUSES].sort());
  });
});
