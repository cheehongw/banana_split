import { describe, expect, it } from 'vitest';
import {
  resolveEqualSplit,
  resolveExactSplit,
  resolveSharesSplit,
  resolveSplits,
} from './splits';

const sum = (splits: { amount: number }[]) => splits.reduce((s, x) => s + x.amount, 0);

describe('resolveEqualSplit', () => {
  it('divides evenly when the total is divisible', () => {
    const splits = resolveEqualSplit(3000, [1, 2, 3]);
    expect(splits.map((s) => s.amount)).toEqual([1000, 1000, 1000]);
    expect(sum(splits)).toBe(3000);
  });

  it('gives leftover cents to the first members and still sums to the total', () => {
    const splits = resolveEqualSplit(1000, [1, 2, 3]); // 1000 / 3 = 333.33
    expect(splits.map((s) => s.amount)).toEqual([334, 333, 333]);
    expect(sum(splits)).toBe(1000);
  });

  it('handles a single participant', () => {
    expect(resolveEqualSplit(999, [7])).toEqual([{ userId: 7, amount: 999 }]);
  });

  it('returns nothing for no participants', () => {
    expect(resolveEqualSplit(1000, [])).toEqual([]);
  });
});

describe('resolveSharesSplit', () => {
  it('divides proportionally to weights', () => {
    const splits = resolveSharesSplit(10000, { 1: 1, 2: 1, 3: 2 });
    const byUser = Object.fromEntries(splits.map((s) => [s.userId, s.amount]));
    expect(byUser).toEqual({ 1: 2500, 2: 2500, 3: 5000 });
    expect(sum(splits)).toBe(10000);
  });

  it('distributes remainder cents by largest fractional part and sums to total', () => {
    const splits = resolveSharesSplit(1000, { 1: 1, 2: 1, 3: 1 }); // 333.33 each
    expect(sum(splits)).toBe(1000);
    for (const s of splits) expect([333, 334]).toContain(s.amount);
    // Exactly one member absorbs the leftover cent.
    expect(splits.filter((s) => s.amount === 334)).toHaveLength(1);
  });

  it('preserves the raw share weight on each split', () => {
    const splits = resolveSharesSplit(300, { 5: 2, 6: 1 });
    expect(splits.find((s) => s.userId === 5)?.shares).toBe(2);
  });

  it('throws when the weights sum to zero', () => {
    expect(() => resolveSharesSplit(100, { 1: 0, 2: 0 })).toThrow(/positive/);
  });
});

describe('resolveExactSplit', () => {
  it('accepts amounts that sum to the total', () => {
    const splits = resolveExactSplit(1000, { 1: 600, 2: 400 });
    expect(sum(splits)).toBe(1000);
  });

  it('throws when the amounts do not sum to the total', () => {
    expect(() => resolveExactSplit(1000, { 1: 600, 2: 300 })).toThrow(/must sum to total/);
  });
});

describe('resolveSplits (dispatch)', () => {
  it('routes to equal', () => {
    expect(sum(resolveSplits('equal', 1000, [1, 2, 3]))).toBe(1000);
  });

  it('routes to shares and requires a shares map', () => {
    expect(sum(resolveSplits('shares', 1000, [1, 2], { shares: { 1: 1, 2: 1 } }))).toBe(1000);
    expect(() => resolveSplits('shares', 1000, [1, 2])).toThrow(/shares map required/);
  });

  it('routes to exact and requires an exact map', () => {
    expect(sum(resolveSplits('exact', 1000, [1, 2], { exact: { 1: 500, 2: 500 } }))).toBe(1000);
    expect(() => resolveSplits('exact', 1000, [1, 2])).toThrow(/exact map required/);
  });
});
