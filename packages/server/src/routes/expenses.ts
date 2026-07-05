import { formatMoney, isKnownCategory, resolveSplits, type SplitType } from '@banana-split/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { assertAllMembers, assertMember } from '../authz';
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
  category?: string; // optional category id
  currency?: string; // ISO 4217; defaults to the group's currency
  shares?: Record<number, number>; // required for 'shares'
  exact?: Record<number, number>; // required for 'exact'
}

/** List expenses in a group, most recent first, each with its splits attached. */
expensesRoute.get('/', (c) => {
  const groupId = c.req.query('groupId');
  if (!groupId) return c.json({ error: 'groupId required' }, 400);
  assertMember(groupId, c.get('user').id);

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

  // The caller, the payer, and every participant must belong to the group.
  assertMember(body.groupId, user.id);
  assertAllMembers(body.groupId, [body.paidBy, ...body.participants]);

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
  const currency = body.currency && /^[A-Za-z]{3}$/.test(body.currency) ? body.currency.toUpperCase() : group.currency;
  db.insert(schema.expenses)
    .values({
      id,
      groupId: body.groupId,
      description: body.description.trim(),
      amount: body.amount,
      currency,
      paidBy: body.paidBy,
      splitType: body.splitType,
      category: body.category && isKnownCategory(body.category) ? body.category : null,
      createdBy: user.id,
    })
    .run();

  db.insert(schema.expenseSplits)
    .values(splits.map((s) => ({ expenseId: id, userId: s.userId, amount: s.amount, shares: s.shares ?? null })))
    .run();

  if (group.telegramChatId && group.notificationsEnabled) {
    await notifyGroup(
      group.telegramChatId,
      `🍌 New expense: ${body.description.trim()} — ${formatMoney(body.amount, currency)}`,
    );
  }

  return c.json({ id }, 201);
});
