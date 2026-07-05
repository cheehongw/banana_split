import { resolveSplits, type SplitType } from '@banana-split/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { notifyGroup } from '../bot';
import { db, schema } from '../db';

export const expensesRoute = new Hono();

interface CreateExpenseBody {
  groupId: string;
  description: string;
  amount: number; // total, minor units
  paidBy: number; // Telegram user id
  splitType: SplitType;
  participants: number[]; // user ids sharing the expense
  shares?: Record<number, number>; // required for 'shares'
  exact?: Record<number, number>; // required for 'exact'
}

/** List expenses in a group, most recent first, each with its splits attached. */
expensesRoute.get('/', (c) => {
  const groupId = c.req.query('groupId');
  if (!groupId) return c.json({ error: 'groupId required' }, 400);

  const rows = db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.groupId, groupId))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt);

  const withSplits = rows.map((e) => ({
    ...e,
    splits: db
      .select()
      .from(schema.expenseSplits)
      .where(eq(schema.expenseSplits.expenseId, e.id))
      .all()
      .map((s) => ({ userId: s.userId, amount: s.amount, shares: s.shares ?? undefined })),
  }));
  return c.json(withSplits);
});

/** Add an expense: resolve the split, persist it, and notify the linked chat. */
expensesRoute.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<CreateExpenseBody>();

  if (!body.groupId || !body.description?.trim() || !body.amount || !body.participants?.length) {
    return c.json({ error: 'missing required fields' }, 400);
  }

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, body.groupId)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);

  // Turn the chosen split type into exact per-user amounts.
  let splits;
  try {
    splits = resolveSplits(body.splitType, body.amount, body.participants, {
      shares: body.shares,
      exact: body.exact,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  const id = randomUUID();
  db.insert(schema.expenses)
    .values({
      id,
      groupId: body.groupId,
      description: body.description.trim(),
      amount: body.amount,
      currency: group.currency,
      paidBy: body.paidBy,
      splitType: body.splitType,
      createdBy: user.id,
    })
    .run();

  db.insert(schema.expenseSplits)
    .values(splits.map((s) => ({ expenseId: id, userId: s.userId, amount: s.amount, shares: s.shares ?? null })))
    .run();

  if (group.telegramChatId) {
    const amountStr = (body.amount / 100).toFixed(2);
    await notifyGroup(
      group.telegramChatId,
      `🍌 New expense: ${body.description.trim()} — ${group.currency} ${amountStr}`,
    );
  }

  return c.json({ id }, 201);
});
