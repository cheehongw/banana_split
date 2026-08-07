import { describe, expect, it } from 'vitest';
import { resolveItemizedSplit } from './items';

const sum = (splits: { amount: number }[]) => splits.reduce((s, x) => s + x.amount, 0);
const byUser = (splits: { userId: number; amount: number }[]) =>
  Object.fromEntries(splits.map((s) => [s.userId, s.amount]));

describe('resolveItemizedSplit', () => {
  it('assigns each item to its sole claimant', () => {
    const { total, splits } = resolveItemizedSplit(
      [
        { amount: 1000, claimants: [1] },
        { amount: 500, claimants: [2] },
      ],
      {},
      [1, 2],
    );
    expect(total).toBe(1500);
    expect(byUser(splits)).toEqual({ 1: 1000, 2: 500 });
  });

  it('splits a shared item equally, leftover cent to the first claimant', () => {
    const { splits } = resolveItemizedSplit([{ amount: 1001, claimants: [1, 2] }], {}, [1, 2]);
    expect(byUser(splits)).toEqual({ 1: 501, 2: 500 });
    expect(sum(splits)).toBe(1001);
  });

  it('splits an unclaimed item across all participants', () => {
    const { total, splits } = resolveItemizedSplit([{ amount: 900, claimants: [] }], {}, [1, 2, 3]);
    expect(total).toBe(900);
    expect(byUser(splits)).toEqual({ 1: 300, 2: 300, 3: 300 });
  });

  it('allocates tax + tip proportionally to item subtotals', () => {
    // Subtotals: user1 = 1000, user2 = 500 → 2:1. Tax+tip = 150 → 100 / 50.
    const { total, splits } = resolveItemizedSplit(
      [
        { amount: 1000, claimants: [1] },
        { amount: 500, claimants: [2] },
      ],
      { tax: 100, tip: 50 },
      [1, 2],
    );
    expect(total).toBe(1650);
    expect(byUser(splits)).toEqual({ 1: 1100, 2: 550 });
    expect(sum(splits)).toBe(1650);
  });

  it('subtracts a discount proportionally and still sums exactly', () => {
    const { total, splits } = resolveItemizedSplit(
      [
        { amount: 1000, claimants: [1] },
        { amount: 1000, claimants: [2] },
      ],
      { discount: 101 }, // odd amount forces a remainder cent
      [1, 2],
    );
    expect(total).toBe(1899);
    expect(sum(splits)).toBe(1899);
    // 101 discount split 50/51 (or 51/50) across the two equal subtotals.
    expect(splits.every((s) => s.amount === 949 || s.amount === 950)).toBe(true);
  });

  it('falls back to an equal adjustment split when no item has weight', () => {
    // Everyone claims nothing distinct; a single unclaimed item, plus tip.
    const { total, splits } = resolveItemizedSplit([{ amount: 300, claimants: [] }], { tip: 30 }, [1, 2, 3]);
    expect(total).toBe(330);
    expect(byUser(splits)).toEqual({ 1: 110, 2: 110, 3: 110 });
  });

  it('rejects an item claimed by a non-participant', () => {
    expect(() => resolveItemizedSplit([{ amount: 100, claimants: [99] }], {}, [1, 2])).toThrow(/not a participant/);
  });

  it('rejects empty items or participants, and non-positive totals', () => {
    expect(() => resolveItemizedSplit([], {}, [1])).toThrow(/at least one item/);
    expect(() => resolveItemizedSplit([{ amount: 100, claimants: [1] }], {}, [])).toThrow(/at least one participant/);
    expect(() => resolveItemizedSplit([{ amount: 100, claimants: [1] }], { discount: 100 }, [1])).toThrow(/positive/);
  });
});
