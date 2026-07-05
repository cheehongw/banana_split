import { describe, expect, it } from 'vitest';
import { computeBalances, simplifyDebts } from './balances';
import type { Balance, Expense, Settlement } from './types';

function expense(paidBy: number, amount: number, splits: [number, number][], currency = 'USD'): Expense {
  return {
    id: `e-${paidBy}-${amount}-${currency}`,
    groupId: 'g1',
    description: 'test',
    amount,
    currency,
    paidBy,
    splitType: 'equal',
    splits: splits.map(([userId, amt]) => ({ userId, amount: amt })),
    createdBy: paidBy,
    createdAt: 0,
  };
}

function settlement(fromUser: number, toUser: number, amount: number, currency = 'USD'): Settlement {
  return { id: `s-${fromUser}-${toUser}-${currency}`, groupId: 'g1', fromUser, toUser, amount, currency, createdAt: 0 };
}

const netOf = (balances: Balance[], userId: number, currency = 'USD') =>
  balances.find((b) => b.userId === userId && b.currency === currency)?.net;

describe('computeBalances', () => {
  it('credits the payer and debits each participant their share', () => {
    const balances = computeBalances([1, 2, 3], [expense(1, 3000, [[1, 1000], [2, 1000], [3, 1000]])], []);
    expect(netOf(balances, 1)).toBe(2000);
    expect(netOf(balances, 2)).toBe(-1000);
    expect(netOf(balances, 3)).toBe(-1000);
  });

  it('always nets to zero within a currency', () => {
    const balances = computeBalances(
      [1, 2, 3],
      [
        expense(1, 3000, [[1, 1000], [2, 1000], [3, 1000]]),
        expense(2, 1500, [[1, 500], [2, 500], [3, 500]]),
      ],
      [],
    );
    expect(balances.reduce((s, b) => s + b.net, 0)).toBe(0);
  });

  it('applies settlements within the same currency', () => {
    const expenses = [expense(1, 3000, [[1, 1000], [2, 1000], [3, 1000]])];
    const balances = computeBalances([1, 2, 3], expenses, [settlement(2, 1, 1000)]);
    expect(netOf(balances, 1)).toBe(1000);
    expect(netOf(balances, 2)).toBe(0);
    expect(netOf(balances, 3)).toBe(-1000);
  });

  it('keeps currencies independent — yen and sgd never mix', () => {
    // Alice fronts ¥3000 (split 3 ways) and Bob fronts S$30 (split 3 ways).
    const balances = computeBalances(
      [1, 2, 3],
      [
        expense(1, 3000, [[1, 1000], [2, 1000], [3, 1000]], 'JPY'),
        expense(2, 3000, [[1, 1000], [2, 1000], [3, 1000]], 'SGD'),
      ],
      [],
    );
    // In JPY: Alice +2000, Bob -1000, Carol -1000.
    expect(netOf(balances, 1, 'JPY')).toBe(2000);
    expect(netOf(balances, 2, 'JPY')).toBe(-1000);
    // In SGD: Bob +2000, Alice -1000, Carol -1000.
    expect(netOf(balances, 2, 'SGD')).toBe(2000);
    expect(netOf(balances, 1, 'SGD')).toBe(-1000);
  });

  it('lets a member owe in one currency and be owed in another (no cross-netting)', () => {
    const balances = computeBalances(
      [1, 2],
      [
        expense(1, 1000, [[1, 500], [2, 500]], 'JPY'), // Bob owes Alice ¥500
        expense(2, 1000, [[1, 500], [2, 500]], 'SGD'), // Alice owes Bob S$500
      ],
      [],
    );
    expect(netOf(balances, 1, 'JPY')).toBe(500);
    expect(netOf(balances, 1, 'SGD')).toBe(-500);
  });
});

describe('simplifyDebts', () => {
  it('settles a simple two-debtor / one-creditor case with a currency tag', () => {
    const suggestions = simplifyDebts([
      { userId: 1, currency: 'USD', net: 2000 },
      { userId: 2, currency: 'USD', net: -1000 },
      { userId: 3, currency: 'USD', net: -1000 },
    ]);
    expect(suggestions).toEqual([
      { fromUser: 2, toUser: 1, amount: 1000, currency: 'USD' },
      { fromUser: 3, toUser: 1, amount: 1000, currency: 'USD' },
    ]);
  });

  it('produces separate per-currency suggestions', () => {
    const suggestions = simplifyDebts([
      { userId: 1, currency: 'JPY', net: 1000 },
      { userId: 2, currency: 'JPY', net: -1000 },
      { userId: 1, currency: 'SGD', net: -500 },
      { userId: 2, currency: 'SGD', net: 500 },
    ]);
    expect(suggestions).toContainEqual({ fromUser: 2, toUser: 1, amount: 1000, currency: 'JPY' });
    expect(suggestions).toContainEqual({ fromUser: 1, toUser: 2, amount: 500, currency: 'SGD' });
  });

  it('zeros out every balance within each currency', () => {
    const balances: Balance[] = [
      { userId: 1, currency: 'USD', net: 5000 },
      { userId: 2, currency: 'USD', net: -2000 },
      { userId: 3, currency: 'USD', net: -3000 },
    ];
    const suggestions = simplifyDebts(balances);
    const applied = new Map(balances.map((b) => [b.userId, b.net]));
    for (const s of suggestions) {
      applied.set(s.fromUser, (applied.get(s.fromUser) ?? 0) + s.amount);
      applied.set(s.toUser, (applied.get(s.toUser) ?? 0) - s.amount);
    }
    for (const net of applied.values()) expect(net).toBe(0);
  });

  it('returns no transfers when everyone is settled', () => {
    expect(simplifyDebts([{ userId: 1, currency: 'USD', net: 0 }])).toEqual([]);
  });
});
