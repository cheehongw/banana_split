import {
  formatMoney,
  isKnownCategory,
  resolveItemizedSplit,
  resolveSplits,
  type SplitType,
} from '@banana-split/shared';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { assertAllMembers, assertMember } from '../authz';
import { notifyGroup } from '../bot';
import { db, schema } from '../db';

export const expensesRoute = new Hono();

interface ItemizedInputLine {
  description: string;
  amount: number; // minor units, > 0
  claimants?: number[]; // user ids; empty/omitted ⇒ shared by all participants
}

interface CreateExpenseBody {
  groupId: string;
  description: string;
  amount: number; // total, minor units (DERIVED for itemized — ignored there)
  paidBy: number; // Telegram user id
  splitType: SplitType;
  participants: number[]; // user ids sharing the expense
  category?: string; // optional category id
  currency?: string; // ISO 4217; defaults to the group's currency
  shares?: Record<number, number>; // required for 'shares'
  exact?: Record<number, number>; // required for 'exact'
  items?: ItemizedInputLine[]; // required for 'itemized'
  tax?: number; // itemized only, minor units
  tip?: number; // itemized only, minor units
  discount?: number; // itemized only, minor units
}

interface ItemRow {
  description: string;
  amount: number;
  kind: 'item' | 'tax' | 'tip' | 'discount';
  claimants: number[];
}

interface ResolvedExpense {
  amount: number;
  currency: string;
  splits: { userId: number; amount: number; shares?: number }[];
  itemRows: ItemRow[]; // non-empty only for itemized expenses
}

/**
 * Turn a request body into the exact per-user splits (and, for itemized
 * expenses, the item rows to persist). Throws on invalid input; callers map
 * that to a 400. Shared by create and edit so both stay consistent.
 */
function resolveExpense(body: CreateExpenseBody, groupCurrency: string, fallbackCurrency?: string): ResolvedExpense {
  const currency =
    body.currency && /^[A-Za-z]{3}$/.test(body.currency)
      ? body.currency.toUpperCase()
      : (fallbackCurrency ?? groupCurrency);

  if (body.splitType === 'itemized') {
    const items = body.items ?? [];
    const lines = items.map((it) => ({ amount: it.amount, claimants: it.claimants ?? [] }));
    const { total, splits } = resolveItemizedSplit(
      lines,
      { tax: body.tax, tip: body.tip, discount: body.discount },
      body.participants,
    );
    const itemRows: ItemRow[] = [
      ...items.map((it) => ({
        description: it.description?.trim() || 'Item',
        amount: it.amount,
        kind: 'item' as const,
        claimants: it.claimants ?? [],
      })),
      ...(body.tax ? [{ description: 'Tax', amount: body.tax, kind: 'tax' as const, claimants: [] }] : []),
      ...(body.tip ? [{ description: 'Tip', amount: body.tip, kind: 'tip' as const, claimants: [] }] : []),
      ...(body.discount
        ? [{ description: 'Discount', amount: body.discount, kind: 'discount' as const, claimants: [] }]
        : []),
    ];
    return { amount: total, currency, splits, itemRows };
  }

  const splits = resolveSplits(body.splitType, body.amount, body.participants, {
    shares: body.shares,
    exact: body.exact,
  });
  return { amount: body.amount, currency, splits, itemRows: [] };
}

/** The transaction handle drizzle passes to `db.transaction(cb)`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Persist the item rows + their claims for an expense (inside a transaction). */
function insertItems(tx: Tx, expenseId: string, itemRows: ItemRow[]): void {
  itemRows.forEach((row, i) => {
    const itemId = randomUUID();
    tx.insert(schema.expenseItems)
      .values({ id: itemId, expenseId, description: row.description, amount: row.amount, kind: row.kind, sortOrder: i })
      .run();
    if (row.claimants.length > 0) {
      tx.insert(schema.expenseItemClaims).values(row.claimants.map((userId) => ({ itemId, userId }))).run();
    }
  });
}

/** Delete an expense's item rows and their claims (inside a transaction). */
function deleteItems(tx: Tx, expenseId: string): void {
  const ids = tx
    .select({ id: schema.expenseItems.id })
    .from(schema.expenseItems)
    .where(eq(schema.expenseItems.expenseId, expenseId))
    .all()
    .map((r) => r.id);
  if (ids.length > 0) {
    tx.delete(schema.expenseItemClaims).where(inArray(schema.expenseItemClaims.itemId, ids)).run();
    tx.delete(schema.expenseItems).where(eq(schema.expenseItems.expenseId, expenseId)).run();
  }
}

/** Load an itemized expense's items (with claimants), ordered as entered. */
function loadItems(expenseId: string) {
  return db
    .select()
    .from(schema.expenseItems)
    .where(eq(schema.expenseItems.expenseId, expenseId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((it) => ({
      id: it.id,
      description: it.description,
      amount: it.amount,
      kind: it.kind,
      claimants: db
        .select({ userId: schema.expenseItemClaims.userId })
        .from(schema.expenseItemClaims)
        .where(eq(schema.expenseItemClaims.itemId, it.id))
        .all()
        .map((c) => c.userId),
    }));
}

/** List expenses in a group, most recent first, each with its splits (and items if itemized). */
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
    ...(e.splitType === 'itemized' ? { items: loadItems(e.id) } : {}),
  }));
  return c.json(withSplits);
});

/** Validate the shared required fields; returns an error string or null. */
function validateBody(body: CreateExpenseBody): string | null {
  if (!body.description?.trim() || !body.participants?.length) return 'missing required fields';
  if (body.splitType === 'itemized') {
    if (!body.items?.length) return 'itemized expense needs at least one item';
  } else if (!body.amount) {
    return 'missing required fields';
  }
  return null;
}

/** Add an expense: resolve the split, persist it, and notify the linked chat. */
expensesRoute.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<CreateExpenseBody>();

  if (!body.groupId) return c.json({ error: 'groupId required' }, 400);
  const bodyError = validateBody(body);
  if (bodyError) return c.json({ error: bodyError }, 400);

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, body.groupId)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);

  // The caller, the payer, and every participant must belong to the group.
  assertMember(body.groupId, user.id);
  assertAllMembers(body.groupId, [body.paidBy, ...body.participants]);

  let resolved: ResolvedExpense;
  try {
    resolved = resolveExpense(body, group.currency);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(schema.expenses)
      .values({
        id,
        groupId: body.groupId,
        description: body.description.trim(),
        amount: resolved.amount,
        currency: resolved.currency,
        paidBy: body.paidBy,
        splitType: body.splitType,
        category: body.category && isKnownCategory(body.category) ? body.category : null,
        createdBy: user.id,
      })
      .run();
    tx.insert(schema.expenseSplits)
      .values(resolved.splits.map((s) => ({ expenseId: id, userId: s.userId, amount: s.amount, shares: s.shares ?? null })))
      .run();
    insertItems(tx, id, resolved.itemRows);
  });

  if (group.telegramChatId && group.notificationsEnabled) {
    await notifyGroup(
      group.telegramChatId,
      `🍈 New expense: ${body.description.trim()} — ${formatMoney(resolved.amount, resolved.currency)}`,
    );
  }

  return c.json({ id }, 201);
});

/** Edit an expense: re-resolve the split and replace the row + its splits + items. */
expensesRoute.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<CreateExpenseBody>();

  const existing = db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get();
  if (!existing) return c.json({ error: 'expense not found' }, 404);
  const bodyError = validateBody(body);
  if (bodyError) return c.json({ error: bodyError }, 400);

  const groupId = existing.groupId; // an expense never moves groups
  const group = db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  assertMember(groupId, user.id);
  assertAllMembers(groupId, [body.paidBy, ...body.participants]);

  let resolved: ResolvedExpense;
  try {
    resolved = resolveExpense(body, group.currency, existing.currency);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  db.transaction((tx) => {
    tx.update(schema.expenses)
      .set({
        description: body.description.trim(),
        amount: resolved.amount,
        currency: resolved.currency,
        paidBy: body.paidBy,
        splitType: body.splitType,
        category: body.category && isKnownCategory(body.category) ? body.category : null,
      })
      .where(eq(schema.expenses.id, id))
      .run(); // createdBy / createdAt are intentionally left untouched
    tx.delete(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, id)).run();
    tx.insert(schema.expenseSplits)
      .values(resolved.splits.map((s) => ({ expenseId: id, userId: s.userId, amount: s.amount, shares: s.shares ?? null })))
      .run();
    deleteItems(tx, id);
    insertItems(tx, id, resolved.itemRows);
  });

  if (group.telegramChatId && group.notificationsEnabled) {
    await notifyGroup(
      group.telegramChatId,
      `✏️ Edited expense: ${body.description.trim()} — ${formatMoney(resolved.amount, resolved.currency)}`,
    );
  }

  return c.json({ id });
});

/** Delete an expense and its splits (and items, if any). */
expensesRoute.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const existing = db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get();
  if (!existing) return c.json({ error: 'expense not found' }, 404);
  assertMember(existing.groupId, user.id);

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, existing.groupId)).get();

  db.transaction((tx) => {
    deleteItems(tx, id);
    tx.delete(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, id)).run();
    tx.delete(schema.expenses).where(eq(schema.expenses.id, id)).run();
  });

  if (group?.telegramChatId && group.notificationsEnabled) {
    await notifyGroup(
      group.telegramChatId,
      `🗑️ Removed expense: ${existing.description} — ${formatMoney(existing.amount, existing.currency)}`,
    );
  }

  return c.json({ ok: true });
});
