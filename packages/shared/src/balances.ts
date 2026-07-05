import type { Balance, Expense, Settlement, SettlementSuggestion } from './types';

/**
 * Compute each member's net balance PER CURRENCY from a group's expenses and
 * settlements. Currencies never mix — yen debts net only against yen — so a
 * member can simultaneously owe in one currency and be owed in another. Positive
 * net = the member is owed; negative = they owe. Within each currency the nets
 * sum to zero (modulo integer minor units).
 */
export function computeBalances(
  memberIds: number[],
  expenses: Expense[],
  settlements: Settlement[],
): Balance[] {
  const currencies = new Set<string>();
  for (const e of expenses) currencies.add(e.currency);
  for (const s of settlements) currencies.add(s.currency);

  const result: Balance[] = [];
  for (const currency of currencies) {
    const net = new Map<number, number>();
    for (const id of memberIds) net.set(id, 0);

    for (const e of expenses) {
      if (e.currency !== currency) continue;
      net.set(e.paidBy, (net.get(e.paidBy) ?? 0) + e.amount);
      for (const s of e.splits) net.set(s.userId, (net.get(s.userId) ?? 0) - s.amount);
    }
    for (const s of settlements) {
      if (s.currency !== currency) continue;
      net.set(s.fromUser, (net.get(s.fromUser) ?? 0) + s.amount);
      net.set(s.toUser, (net.get(s.toUser) ?? 0) - s.amount);
    }

    for (const [userId, n] of net) result.push({ userId, currency, net: n });
  }
  return result;
}

/**
 * Debt simplification via greedy min-cash-flow, run independently per currency
 * (balances are partitioned by `currency`, so suggestions never convert between
 * currencies). Each suggestion is a payment in a single currency.
 */
export function simplifyDebts(balances: Balance[]): SettlementSuggestion[] {
  const byCurrency = new Map<string, Balance[]>();
  for (const b of balances) {
    const list = byCurrency.get(b.currency);
    if (list) list.push(b);
    else byCurrency.set(b.currency, [b]);
  }

  const suggestions: SettlementSuggestion[] = [];
  for (const [currency, bals] of byCurrency) {
    const creditors = bals
      .filter((b) => b.net > 0)
      .map((b) => ({ userId: b.userId, amount: b.net }))
      .sort((a, b) => b.amount - a.amount);
    const debtors = bals
      .filter((b) => b.net < 0)
      .map((b) => ({ userId: b.userId, amount: -b.net }))
      .sort((a, b) => b.amount - a.amount);

    let i = 0; // debtor index
    let j = 0; // creditor index
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i]!;
      const creditor = creditors[j]!;
      const pay = Math.min(debtor.amount, creditor.amount);

      if (pay > 0) {
        suggestions.push({ fromUser: debtor.userId, toUser: creditor.userId, amount: pay, currency });
        debtor.amount -= pay;
        creditor.amount -= pay;
      }

      if (debtor.amount === 0) i++;
      if (creditor.amount === 0) j++;
    }
  }
  return suggestions;
}
