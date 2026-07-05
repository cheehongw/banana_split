import { computeBalances, simplifyDebts, type Expense, type Settlement } from '@banana-split/shared';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { notifyGroup } from '../bot';
import { db, schema } from '../db';

export const settlementsRoute = new Hono();

/** Current net balances and simplified settle-up suggestions for a group. */
settlementsRoute.get('/balances', (c) => {
  const groupId = c.req.query('groupId');
  if (!groupId) return c.json({ error: 'groupId required' }, 400);

  const memberIds = db
    .select()
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId))
    .all()
    .map((m) => m.userId);

  const expenseRows = db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.groupId, groupId))
    .all();

  const expenseIds = expenseRows.map((e) => e.id);
  const splitRows = expenseIds.length
    ? db.select().from(schema.expenseSplits).where(inArray(schema.expenseSplits.expenseId, expenseIds)).all()
    : [];

  const settlementRows = db
    .select()
    .from(schema.settlements)
    .where(eq(schema.settlements.groupId, groupId))
    .all();

  // Reassemble Expense objects (with splits) for the shared balance math.
  const expenses: Expense[] = expenseRows.map((e) => ({
    ...e,
    splits: splitRows
      .filter((s) => s.expenseId === e.id)
      .map((s) => ({ userId: s.userId, amount: s.amount, shares: s.shares ?? undefined })),
  }));

  const balances = computeBalances(memberIds, expenses, settlementRows as Settlement[]);
  const suggestions = simplifyDebts(balances);
  return c.json({ balances, suggestions });
});

/** Record a settlement (a payment from one member to another). */
settlementsRoute.post('/', async (c) => {
  const body = await c.req.json<{ groupId: string; fromUser: number; toUser: number; amount: number }>();
  if (!body.groupId || !body.fromUser || !body.toUser || !body.amount) {
    return c.json({ error: 'missing required fields' }, 400);
  }
  if (body.fromUser === body.toUser) return c.json({ error: 'cannot settle with yourself' }, 400);

  const id = randomUUID();
  db.insert(schema.settlements)
    .values({ id, groupId: body.groupId, fromUser: body.fromUser, toUser: body.toUser, amount: body.amount })
    .run();

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, body.groupId)).get();
  if (group?.telegramChatId) {
    const amountStr = (body.amount / 100).toFixed(2);
    await notifyGroup(group.telegramChatId, `✅ Settlement recorded: ${group.currency} ${amountStr}`);
  }
  return c.json({ id }, 201);
});
