import type { ExpenseSplit, SplitType } from './types';

// Split resolution: turn a chosen split type + inputs into EXACT per-user amounts
// (integer minor units) that always sum to the expense total.

/** Divide `total` evenly among users, giving leftover cents to the first users. */
export function resolveEqualSplit(total: number, userIds: number[]): ExpenseSplit[] {
  const n = userIds.length;
  if (n === 0) return [];
  const base = Math.floor(total / n);
  const remainder = total - base * n; // 0 <= remainder < n
  return userIds.map((userId, i) => ({ userId, amount: base + (i < remainder ? 1 : 0) }));
}

/**
 * Divide `total` proportionally to integer weights.
 * Uses the largest-remainder method to distribute leftover cents fairly.
 */
export function resolveSharesSplit(total: number, weights: Record<number, number>): ExpenseSplit[] {
  const entries = Object.entries(weights).map(([id, w]) => ({ userId: Number(id), shares: w }));
  const totalShares = entries.reduce((sum, e) => sum + e.shares, 0);
  if (totalShares <= 0) throw new Error('shares must sum to a positive number');

  const raw = entries.map((e) => {
    const exact = (total * e.shares) / totalShares;
    const floor = Math.floor(exact);
    return { userId: e.userId, shares: e.shares, amount: floor, frac: exact - floor };
  });

  let remainder = total - raw.reduce((sum, r) => sum + r.amount, 0);
  // Hand the leftover cents to the largest fractional parts first.
  raw.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder && i < raw.length; i++) raw[i]!.amount += 1;

  return raw.map((r) => ({ userId: r.userId, amount: r.amount, shares: r.shares }));
}

/** Use caller-provided exact amounts; validate they sum to the total. */
export function resolveExactSplit(total: number, amounts: Record<number, number>): ExpenseSplit[] {
  const splits = Object.entries(amounts).map(([id, amount]) => ({ userId: Number(id), amount }));
  const sum = splits.reduce((s, x) => s + x.amount, 0);
  if (sum !== total) throw new Error(`exact splits (${sum}) must sum to total (${total})`);
  return splits;
}

export interface SplitOptions {
  shares?: Record<number, number>;
  exact?: Record<number, number>;
}

/** Dispatch to the right split resolver based on `splitType`. */
export function resolveSplits(
  splitType: SplitType,
  total: number,
  participants: number[],
  opts: SplitOptions = {},
): ExpenseSplit[] {
  switch (splitType) {
    case 'equal':
      return resolveEqualSplit(total, participants);
    case 'shares':
      if (!opts.shares) throw new Error('shares map required for shares split');
      return resolveSharesSplit(total, opts.shares);
    case 'exact':
      if (!opts.exact) throw new Error('exact map required for exact split');
      return resolveExactSplit(total, opts.exact);
    default:
      throw new Error(`unknown split type: ${splitType as string}`);
  }
}
