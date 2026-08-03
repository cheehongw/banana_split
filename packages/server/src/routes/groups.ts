import { categoryLabel, currencyDecimals } from '@banana-split/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { assertMember } from '../authz';
import { db, schema } from '../db';
import { memberNames } from '../groupBalances';

export const groupsRoute = new Hono();

/** List the groups the current user belongs to. */
groupsRoute.get('/', (c) => {
  const user = c.get('user');
  const rows = db
    .select({ group: schema.groups })
    .from(schema.groupMembers)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
    .where(eq(schema.groupMembers.userId, user.id))
    .all();
  return c.json(rows.map((r) => r.group));
});

/** Create a group; the creator becomes its first member. */
groupsRoute.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ title?: string; currency?: string }>();
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);

  // Upsert the creating user so foreign keys resolve.
  db.insert(schema.users)
    .values({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      photoUrl: user.photo_url,
    })
    .onConflictDoNothing()
    .run();

  const id = randomUUID();
  db.insert(schema.groups)
    .values({ id, title: body.title.trim(), currency: body.currency ?? 'USD' })
    .run();
  db.insert(schema.groupMembers).values({ groupId: id, userId: user.id }).run();

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  return c.json(group, 201);
});

/** Group detail: the group plus its resolved members. */
groupsRoute.get('/:id', (c) => {
  const id = c.req.param('id');
  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  assertMember(id, c.get('user').id);

  const members = db
    .select({ user: schema.users })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupMembers.userId))
    .where(eq(schema.groupMembers.groupId, id))
    .all()
    .map((r) => ({
      id: r.user.id,
      firstName: r.user.firstName,
      lastName: r.user.lastName ?? undefined,
      username: r.user.username ?? undefined,
      photoUrl: r.user.photoUrl ?? undefined,
      isPlaceholder: r.user.id < 0,
    }));

  return c.json({ group, members });
});

/**
 * Add a member to a group by Telegram user id.
 * INTERIM: real member management (chat-membership sync / invite-by-username) is
 * still an open question — this manual add unblocks the add-expense flow.
 */
groupsRoute.post('/:id/members', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ userId?: number; firstName?: string; username?: string }>();
  if (!body.userId) return c.json({ error: 'userId required' }, 400);

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  // Only an existing member may add others.
  assertMember(id, c.get('user').id);

  db.insert(schema.users)
    .values({ id: body.userId, firstName: body.firstName?.trim() || `User ${body.userId}`, username: body.username })
    .onConflictDoNothing()
    .run();
  db.insert(schema.groupMembers).values({ groupId: id, userId: body.userId }).onConflictDoNothing().run();

  return c.json({ ok: true }, 201);
});

/**
 * Join a group yourself (used by the deep link the bot posts in a linked chat).
 * No membership precheck — that's the point — but the group id is an unguessable
 * uuid shared only in the linked chat. TODO: verify chat membership via the bot.
 */
groupsRoute.post('/:id/join', (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);

  db.insert(schema.users)
    .values({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      photoUrl: user.photo_url,
    })
    .onConflictDoNothing()
    .run();
  db.insert(schema.groupMembers).values({ groupId: id, userId: user.id }).onConflictDoNothing().run();

  return c.json({ ok: true }, 201);
});

/**
 * Add a PLACEHOLDER member — someone not on Telegram (e.g. a friend who hasn't
 * joined yet). Placeholders get a negative id (real Telegram ids are positive),
 * so `id < 0` unambiguously marks them with no schema change. They can pay for
 * and share expenses like anyone else, and can later be "claimed" (see below).
 */
groupsRoute.post('/:id/placeholders', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  assertMember(id, c.get('user').id);

  // Allocate a fresh negative id, below any existing one, to avoid collisions.
  const row = db.select({ min: sql<number>`min(${schema.users.id})` }).from(schema.users).get();
  const placeholderId = Math.min(0, row?.min ?? 0) - 1;

  db.insert(schema.users).values({ id: placeholderId, firstName: name }).run();
  db.insert(schema.groupMembers).values({ groupId: id, userId: placeholderId }).run();

  return c.json({ id: placeholderId, firstName: name, isPlaceholder: true }, 201);
});

/**
 * Claim (take over) a placeholder: re-attribute all of the placeholder's
 * expenses, splits, and settlements to the CALLER (whose id comes from the
 * validated initData — never the client), then delete the placeholder. If the
 * caller already had activity, the two combine (splits on the same expense are
 * summed). Destructive + irreversible by design.
 */
groupsRoute.post('/:id/claim', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ placeholderId?: number }>();
  const placeholderId = body.placeholderId;
  const user = c.get('user');

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  assertMember(id, user.id); // caller must already be in the group (deep link auto-joins)

  if (typeof placeholderId !== 'number' || placeholderId >= 0) {
    return c.json({ error: 'not a placeholder' }, 400);
  }
  if (placeholderId === user.id) return c.json({ error: 'cannot claim yourself' }, 400);
  const inGroup = db
    .select()
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, id), eq(schema.groupMembers.userId, placeholderId)))
    .get();
  if (!inGroup) return c.json({ error: 'placeholder not in this group' }, 404);

  // Make sure the caller's real user row exists before we point rows at it.
  db.insert(schema.users)
    .values({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      photoUrl: user.photo_url,
    })
    .onConflictDoNothing()
    .run();

  mergeUser(placeholderId, user.id);
  return c.json({ ok: true, userId: user.id });
});

/**
 * Merge one user's ledger rows into another, in a single transaction. Used by
 * claim (placeholder → real user). Handles the (expenseId, userId) and
 * (groupId, userId) composite-PK collisions that arise if `toId` already has
 * rows on the same expense/group.
 */
function mergeUser(fromId: number, toId: number): void {
  db.transaction((tx) => {
    tx.update(schema.expenses).set({ paidBy: toId }).where(eq(schema.expenses.paidBy, fromId)).run();
    tx.update(schema.expenses).set({ createdBy: toId }).where(eq(schema.expenses.createdBy, fromId)).run();

    // expense_splits: (expenseId, userId) is the PK — merge if `toId` is already
    // a participant on the same expense, else just repoint.
    const fromSplits = tx.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.userId, fromId)).all();
    for (const s of fromSplits) {
      const existing = tx
        .select()
        .from(schema.expenseSplits)
        .where(and(eq(schema.expenseSplits.expenseId, s.expenseId), eq(schema.expenseSplits.userId, toId)))
        .get();
      if (existing) {
        const shares = (existing.shares ?? 0) + (s.shares ?? 0);
        tx.update(schema.expenseSplits)
          .set({ amount: existing.amount + s.amount, shares: shares || null })
          .where(and(eq(schema.expenseSplits.expenseId, s.expenseId), eq(schema.expenseSplits.userId, toId)))
          .run();
        tx.delete(schema.expenseSplits)
          .where(and(eq(schema.expenseSplits.expenseId, s.expenseId), eq(schema.expenseSplits.userId, fromId)))
          .run();
      } else {
        tx.update(schema.expenseSplits)
          .set({ userId: toId })
          .where(and(eq(schema.expenseSplits.expenseId, s.expenseId), eq(schema.expenseSplits.userId, fromId)))
          .run();
      }
    }

    tx.update(schema.settlements).set({ fromUser: toId }).where(eq(schema.settlements.fromUser, fromId)).run();
    tx.update(schema.settlements).set({ toUser: toId }).where(eq(schema.settlements.toUser, fromId)).run();

    // group_members: (groupId, userId) is the PK — ensure `toId` membership, drop `fromId`.
    const memberships = tx.select().from(schema.groupMembers).where(eq(schema.groupMembers.userId, fromId)).all();
    for (const m of memberships) {
      tx.insert(schema.groupMembers).values({ groupId: m.groupId, userId: toId }).onConflictDoNothing().run();
    }
    tx.delete(schema.groupMembers).where(eq(schema.groupMembers.userId, fromId)).run();

    tx.delete(schema.users).where(eq(schema.users.id, fromId)).run();
  });
}

// TODO: DELETE /:id/members/:userId
/** Export all of a group's expenses and settlements as a CSV download. */
groupsRoute.get('/:id/export', (c) => {
  const id = c.req.param('id');
  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  assertMember(id, c.get('user').id);

  const expenses = db
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.groupId, id))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
  const settlements = db
    .select()
    .from(schema.settlements)
    .where(eq(schema.settlements.groupId, id))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);

  const ids = new Set<number>();
  expenses.forEach((e) => ids.add(e.paidBy));
  settlements.forEach((s) => ids.add(s.fromUser) && ids.add(s.toUser));
  const names = memberNames([...ids]);
  const nameOf = (uid: number) => names.get(uid) ?? `User ${uid}`;
  const money = (amount: number, cur: string) => (amount / 10 ** currencyDecimals(cur)).toFixed(currencyDecimals(cur));
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const iso = (unix: number) => new Date(unix * 1000).toISOString();

  const rows = ['Type,Date,Description,Category,Paid by,From,To,Amount,Currency,Split'];
  for (const e of expenses) {
    rows.push(
      ['expense', iso(e.createdAt), esc(e.description), esc(categoryLabel(e.category)), esc(nameOf(e.paidBy)), '', '', money(e.amount, e.currency), e.currency, e.splitType].join(','),
    );
  }
  for (const s of settlements) {
    rows.push(
      ['settlement', iso(s.createdAt), esc('Settlement'), '', '', esc(nameOf(s.fromUser)), esc(nameOf(s.toUser)), money(s.amount, s.currency), s.currency, ''].join(','),
    );
  }

  const safeName = group.title.replace(/[^a-z0-9]+/gi, '_');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${safeName}_export.csv"`);
  return c.body(rows.join('\n') + '\n');
});

/** Update group settings (title / currency / avatar / notifications). */
groupsRoute.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  assertMember(id, c.get('user').id);

  const body = await c.req.json<{ title?: string; currency?: string; avatar?: string | null; notificationsEnabled?: boolean }>();
  const patch: Partial<typeof schema.groups.$inferInsert> = {};
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency)) patch.currency = body.currency.toUpperCase();
  if (body.avatar === null || typeof body.avatar === 'string') patch.avatar = body.avatar || null;
  if (typeof body.notificationsEnabled === 'boolean') patch.notificationsEnabled = body.notificationsEnabled;

  if (Object.keys(patch).length > 0) {
    db.update(schema.groups).set(patch).where(eq(schema.groups.id, id)).run();
  }
  return c.json(db.select().from(schema.groups).where(eq(schema.groups.id, id)).get());
});

/**
 * Remove a member from a group. Refused if they're referenced by any expense or
 * settlement (would orphan balances) or if they're the last member.
 */
groupsRoute.delete('/:id/members/:userId', (c) => {
  const id = c.req.param('id');
  const target = Number(c.req.param('userId'));
  if (!target) return c.json({ error: 'invalid userId' }, 400);

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);
  assertMember(id, c.get('user').id);

  const memberCount = db.select().from(schema.groupMembers).where(eq(schema.groupMembers.groupId, id)).all().length;
  if (memberCount <= 1) return c.json({ error: 'cannot remove the last member' }, 400);

  const expenseIds = db
    .select({ id: schema.expenses.id })
    .from(schema.expenses)
    .where(eq(schema.expenses.groupId, id))
    .all()
    .map((r) => r.id);

  const isPayer = db
    .select()
    .from(schema.expenses)
    .where(and(eq(schema.expenses.groupId, id), eq(schema.expenses.paidBy, target)))
    .get();
  const inSplit =
    expenseIds.length > 0 &&
    db
      .select()
      .from(schema.expenseSplits)
      .where(and(inArray(schema.expenseSplits.expenseId, expenseIds), eq(schema.expenseSplits.userId, target)))
      .get();
  const inSettlement = db
    .select()
    .from(schema.settlements)
    .where(and(eq(schema.settlements.groupId, id), or(eq(schema.settlements.fromUser, target), eq(schema.settlements.toUser, target))))
    .get();

  if (isPayer || inSplit || inSettlement) {
    return c.json({ error: 'member has expenses or settlements and cannot be removed' }, 409);
  }

  db.delete(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, id), eq(schema.groupMembers.userId, target)))
    .run();
  return c.json({ ok: true });
});
