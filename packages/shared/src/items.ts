import { resolveEqualSplit } from './splits';
import type { ExpenseSplit } from './types';

// Itemized-split resolution: turn a receipt's line items (each claimed by some
// subset of participants) plus tax/tip/discount into EXACT per-user amounts in
// integer minor units that always sum to the derived total. Shared by the
// server (source of truth) and the client (live preview), like resolveSplits.

/** One claimable line item. `claimants` empty ⇒ shared equally by all participants. */
export interface ItemizedLine {
  amount: number; // minor units, > 0
  claimants: number[]; // user ids sharing this item
}

/** Whole-receipt adjustments, allocated proportionally to each person's item subtotal. */
export interface ItemizedAdjustments {
  tax?: number; // minor units, >= 0
  tip?: number; // minor units, >= 0
  discount?: number; // minor units, >= 0 (subtracted)
}

export interface ItemizedResult {
  /** sum(items) + tax + tip − discount */
  total: number;
  /** per-participant exact amounts; sum === total */
  splits: ExpenseSplit[];
}

/**
 * Distribute `total` (can be negative) across `participants`, weighted by
 * `weights` (item subtotals). Falls back to an equal split when every weight is
 * zero. Largest-remainder rounding keeps the result summing exactly to `total`.
 */
function distributeProportionally(
  total: number,
  weights: Map<number, number>,
  participants: number[],
): Map<number, number> {
  const totalWeight = participants.reduce((s, id) => s + Math.max(0, weights.get(id) ?? 0), 0);
  const useWeights = totalWeight > 0;
  const n = participants.length;

  const raw = participants.map((id) => {
    const exact = useWeights ? (total * Math.max(0, weights.get(id) ?? 0)) / totalWeight : total / n;
    const floor = Math.floor(exact); // toward -∞ so the remainder stays in [0, n)
    return { id, floor, frac: exact - floor };
  });

  let remainder = total - raw.reduce((s, r) => s + r.floor, 0);
  raw.sort((a, b) => b.frac - a.frac); // hand leftover units to the largest fractional parts
  for (let i = 0; i < remainder && i < raw.length; i++) raw[i]!.floor += 1;

  return new Map(raw.map((r) => [r.id, r.floor]));
}

/**
 * Resolve an itemized expense to exact per-user amounts.
 *
 * Each item is split equally among its claimants (an unclaimed item is split
 * across all participants, so nothing is lost). Tax/tip/discount are then
 * allocated in proportion to each person's item subtotal. The derived total is
 * `sum(items) + tax + tip − discount` and must be a positive integer.
 */
export function resolveItemizedSplit(
  items: ItemizedLine[],
  adjustments: ItemizedAdjustments,
  participants: number[],
): ItemizedResult {
  if (participants.length === 0) throw new Error('itemized split needs at least one participant');
  if (items.length === 0) throw new Error('itemized split needs at least one item');

  const allowed = new Set(participants);
  const perUser = new Map<number, number>(participants.map((p) => [p, 0]));

  // 1. Distribute each item among its claimants (or everyone if unclaimed).
  for (const item of items) {
    if (!Number.isInteger(item.amount) || item.amount <= 0) {
      throw new Error('each item amount must be a positive integer in minor units');
    }
    for (const c of item.claimants) {
      if (!allowed.has(c)) throw new Error(`item claimed by user ${c} who is not a participant`);
    }
    const claimers = item.claimants.length > 0 ? item.claimants : participants;
    for (const s of resolveEqualSplit(item.amount, claimers)) {
      perUser.set(s.userId, (perUser.get(s.userId) ?? 0) + s.amount);
    }
  }

  // 2. Allocate tax + tip − discount proportionally to item subtotals.
  const tax = adjustments.tax ?? 0;
  const tip = adjustments.tip ?? 0;
  const discount = adjustments.discount ?? 0;
  for (const [label, v] of [['tax', tax], ['tip', tip], ['discount', discount]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${label} must be a non-negative integer in minor units`);
  }

  const subtotals = new Map(perUser); // weights BEFORE adjustments
  const adjustment = tax + tip - discount;
  if (adjustment !== 0) {
    for (const [id, a] of distributeProportionally(adjustment, subtotals, participants)) {
      perUser.set(id, (perUser.get(id) ?? 0) + a);
    }
  }

  const total = [...perUser.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) throw new Error('itemized total must be a positive integer in minor units');

  return { total, splits: participants.map((id) => ({ userId: id, amount: perUser.get(id) ?? 0 })) };
}
