import { computeBalances, simplifyDebts, type Balance, type Expense, type Settlement, type SettlementSuggestion } from '@banana-split/shared';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from './db';

/**
 * Compute a group's net balances and simplified settle-up suggestions from its
 * expenses, splits, and settlements. Shared by the balances API route and the
 * bot's /balance command so the two never diverge.
 */
export function computeGroupBalances(groupId: string): { balances: Balance[]; suggestions: SettlementSuggestion[] } {
  const memberIds = db
    .select()
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId))
    .all()
    .map((m) => m.userId);

  const expenseRows = db.select().from(schema.expenses).where(eq(schema.expenses.groupId, groupId)).all();
  const expenseIds = expenseRows.map((e) => e.id);
  const splitRows = expenseIds.length
    ? db.select().from(schema.expenseSplits).where(inArray(schema.expenseSplits.expenseId, expenseIds)).all()
    : [];
  const settlementRows = db.select().from(schema.settlements).where(eq(schema.settlements.groupId, groupId)).all();

  const expenses: Expense[] = expenseRows.map((e) => ({
    ...e,
    splits: splitRows
      .filter((s) => s.expenseId === e.id)
      .map((s) => ({ userId: s.userId, amount: s.amount, shares: s.shares ?? undefined })),
  }));

  const balances = computeBalances(memberIds, expenses, settlementRows as Settlement[]);
  return { balances, suggestions: simplifyDebts(balances) };
}

/** Map the given user ids to their display (first) names for rendering. */
export function memberNames(userIds: number[]): Map<number, string> {
  if (userIds.length === 0) return new Map();
  const rows = db.select().from(schema.users).where(inArray(schema.users.id, userIds)).all();
  return new Map(rows.map((u) => [u.id, u.firstName]));
}
