import { formatMoney } from '@banana-split/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { assertAllMembers, assertMember } from '../authz';
import { notifyGroup } from '../bot';
import { db, schema } from '../db';
import { computeGroupBalances } from '../groupBalances';

export const settlementsRoute = new Hono();

/** Current net balances and simplified settle-up suggestions for a group. */
settlementsRoute.get('/balances', (c) => {
  const groupId = c.req.query('groupId');
  if (!groupId) return c.json({ error: 'groupId required' }, 400);
  assertMember(groupId, c.get('user').id);

  return c.json(computeGroupBalances(groupId));
});

/** Record a settlement (a payment from one member to another). */
settlementsRoute.post('/', async (c) => {
  const body = await c.req.json<{ groupId: string; fromUser: number; toUser: number; amount: number; currency?: string }>();
  if (!body.groupId || !body.fromUser || !body.toUser) {
    return c.json({ error: 'missing required fields' }, 400);
  }
  if (!Number.isInteger(body.amount) || body.amount <= 0) {
    return c.json({ error: 'amount must be a positive integer in minor units' }, 400);
  }
  if (body.fromUser === body.toUser) return c.json({ error: 'cannot settle with yourself' }, 400);

  const group = db.select().from(schema.groups).where(eq(schema.groups.id, body.groupId)).get();
  if (!group) return c.json({ error: 'group not found' }, 404);

  // Caller and both parties to the payment must belong to the group.
  assertMember(body.groupId, c.get('user').id);
  assertAllMembers(body.groupId, [body.fromUser, body.toUser]);

  const currency = body.currency && /^[A-Za-z]{3}$/.test(body.currency) ? body.currency.toUpperCase() : group.currency;
  const id = randomUUID();
  db.insert(schema.settlements)
    .values({ id, groupId: body.groupId, fromUser: body.fromUser, toUser: body.toUser, amount: body.amount, currency })
    .run();

  if (group.telegramChatId && group.notificationsEnabled) {
    await notifyGroup(group.telegramChatId, `✅ Settlement recorded: ${formatMoney(body.amount, currency)}`);
  }
  return c.json({ id }, 201);
});
