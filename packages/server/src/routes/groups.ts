import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { db, schema } from '../db';

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

// TODO: GET /:id  -> group detail with members + balances
// TODO: POST /:id/members  -> add a member (by Telegram user id / username)
// TODO: DELETE /:id/members/:userId
