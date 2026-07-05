import type { Balance, Expense, Settlement, SettlementSuggestion } from './types';

/**
 * Compute each member's net balance in a group from its expenses and settlements.
 * Positive net = the member is owed money; negative = they owe money.
 * The returned nets always sum to zero (modulo integer cents).
 */
export function computeBalances(
  memberIds: number[],
  expenses: Expense[],
  settlements: Settlement[],
): Balance[] {
  const net = new Map<number, number>();
  for (const id of memberIds) net.set(id, 0);

  for (const e of expenses) {
    // Whoever paid is owed the full amount they fronted...
    net.set(e.paidBy, (net.get(e.paidBy) ?? 0) + e.amount);
    // ...and each participant owes their share of it.
    for (const s of e.splits) {
      net.set(s.userId, (net.get(s.userId) ?? 0) - s.amount);
    }
  }

  for (const s of settlements) {
    // A settlement pays down a debt: the payer's net rises, the payee's falls.
    net.set(s.fromUser, (net.get(s.fromUser) ?? 0) + s.amount);
    net.set(s.toUser, (net.get(s.toUser) ?? 0) - s.amount);
  }

  return [...net.entries()].map(([userId, n]) => ({ userId, net: n }));
}

/**
 * Debt simplification via greedy min-cash-flow.
 *
 * Given each member's net balance, produce a small set of payments that settles
 * everyone to zero by repeatedly matching the biggest debtor with the biggest
 * creditor. This is the classic heuristic Splitwise-style apps use — it doesn't
 * always hit the theoretical minimum number of transfers (that's NP-hard), but
 * it's optimal in practice for typical group sizes.
 *
 * All amounts are integer minor units.
 */
export function simplifyDebts(balances: Balance[]): SettlementSuggestion[] {
  const creditors = balances
    .filter((b) => b.net > 0)
    .map((b) => ({ userId: b.userId, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.net < 0)
    .map((b) => ({ userId: b.userId, amount: -b.net }))
    .sort((a, b) => b.amount - a.amount);

  const suggestions: SettlementSuggestion[] = [];
  let i = 0; // debtor index
  let j = 0; // creditor index

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!;
    const creditor = creditors[j]!;
    const pay = Math.min(debtor.amount, creditor.amount);

    if (pay > 0) {
      suggestions.push({ fromUser: debtor.userId, toUser: creditor.userId, amount: pay });
      debtor.amount -= pay;
      creditor.amount -= pay;
    }

    if (debtor.amount === 0) i++;
    if (creditor.amount === 0) j++;
  }

  return suggestions;
}
