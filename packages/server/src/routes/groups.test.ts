import { eq } from 'drizzle-orm';
import { createHmac, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TelegramUser } from '../auth';

const BOT_TOKEN = 'test-bot-token';

// Sign initData exactly the way Telegram does, so requests go through the real
// auth middleware (not the dev bypass) and we can act as arbitrary users.
function authHeader(user: TelegramUser): Record<string, string> {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('user', JSON.stringify(user));
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return { 'X-Telegram-Init-Data': params.toString() };
}

// Lazily bound after env is set, so db/index.ts opens the temp DB (not the real one).
let app: Hono;
let db: typeof import('../db').db;
let schema: typeof import('../db').schema;

const creator: TelegramUser = { id: 100, first_name: 'Creator' };
const joiner: TelegramUser = { id: 200, first_name: 'Jane' };

async function jsonReq(path: string, user: TelegramUser, method: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader(user) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}

beforeAll(async () => {
  process.env.BOT_TOKEN = BOT_TOKEN;
  process.env.NODE_ENV = 'test'; // dev bypass off; real initData required
  process.env.DATABASE_URL = join(tmpdir(), `bs-groups-test-${process.pid}-${Date.now()}.sqlite`);

  const dbMod = await import('../db');
  db = dbMod.db;
  schema = dbMod.schema;
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle') });

  app = (await import('../app')).createApp();
});

describe('placeholder claim on join', () => {
  it('lets a joiner take over their placeholder, inheriting its ledger', async () => {
    // Creator makes a group and a placeholder for the not-yet-onboarded friend.
    const groupRes = await jsonReq('/api/groups', creator, 'POST', { title: 'Trip', currency: 'USD' });
    expect(groupRes.status).toBe(201);
    const group = (await groupRes.json()) as { id: string };

    const phRes = await jsonReq(`/api/groups/${group.id}/placeholders`, creator, 'POST', { name: 'Jane' });
    expect(phRes.status).toBe(201);
    const placeholder = (await phRes.json()) as { id: number };
    expect(placeholder.id).toBeLessThan(0);

    // Give the placeholder some history: an expense it paid, split with the creator.
    const expenseId = randomUUID();
    db.insert(schema.expenses)
      .values({
        id: expenseId,
        groupId: group.id,
        description: 'Taxi',
        amount: 1000,
        currency: 'USD',
        paidBy: placeholder.id,
        splitType: 'equal',
        createdBy: creator.id,
      })
      .run();
    db.insert(schema.expenseSplits).values([
      { expenseId, userId: creator.id, amount: 500 },
      { expenseId, userId: placeholder.id, amount: 500 },
    ]).run();

    // The real Jane opens the app via the deep link and auto-joins.
    const joinRes = await jsonReq(`/api/groups/${group.id}/join`, joiner, 'POST');
    expect(joinRes.status).toBe(201);

    // She now sees the group under her real id...
    const listRes = await jsonReq('/api/groups', joiner, 'GET');
    expect((await listRes.json()) as unknown[]).toHaveLength(1);

    // ...and claims the placeholder that stands in for her.
    const claimRes = await jsonReq(`/api/groups/${group.id}/claim`, joiner, 'POST', {
      placeholderId: placeholder.id,
    });
    expect(claimRes.status).toBe(200);

    // The placeholder is gone; its expense and split now belong to Jane.
    const placeholderRow = db.select().from(schema.users).where(eq(schema.users.id, placeholder.id)).get();
    expect(placeholderRow).toBeUndefined();

    const expense = db.select().from(schema.expenses).where(eq(schema.expenses.id, expenseId)).get();
    expect(expense?.paidBy).toBe(joiner.id);

    const splits = db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, expenseId)).all();
    expect(splits.map((s) => s.userId).sort()).toEqual([creator.id, joiner.id].sort());

    // The group members are just the creator and Jane — no duplicate identity.
    const detailRes = await jsonReq(`/api/groups/${group.id}`, joiner, 'GET');
    const detail = (await detailRes.json()) as { members: { id: number }[] };
    expect(detail.members.map((m) => m.id).sort()).toEqual([creator.id, joiner.id].sort());
  });

  it('refuses to claim before the caller has joined the group', async () => {
    const groupRes = await jsonReq('/api/groups', creator, 'POST', { title: 'Solo' });
    const group = (await groupRes.json()) as { id: string };
    const phRes = await jsonReq(`/api/groups/${group.id}/placeholders`, creator, 'POST', { name: 'Bob' });
    const placeholder = (await phRes.json()) as { id: number };

    // Caller is not a member yet — assertMember must block the claim.
    const claimRes = await jsonReq(`/api/groups/${group.id}/claim`, joiner, 'POST', {
      placeholderId: placeholder.id,
    });
    expect(claimRes.status).toBe(403);
  });

  it('rejects a non-placeholder (non-negative) id', async () => {
    const groupRes = await jsonReq('/api/groups', creator, 'POST', { title: 'Guard' });
    const group = (await groupRes.json()) as { id: string };
    await jsonReq(`/api/groups/${group.id}/join`, joiner, 'POST');

    const claimRes = await jsonReq(`/api/groups/${group.id}/claim`, joiner, 'POST', {
      placeholderId: creator.id, // a real, positive id
    });
    expect(claimRes.status).toBe(400);
  });
});
