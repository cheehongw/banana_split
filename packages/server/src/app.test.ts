// In-memory integration tests for the Hono API. We drive the real app via
// `app.request(...)` (no port), against an in-memory SQLite built from the
// committed migrations, and authenticate by signing valid Telegram initData
// with a test BOT_TOKEN — so we exercise the true auth + authorization paths
// and can act as any user per request.
//
// Env must be set BEFORE importing the app/db modules (they read it at import),
// so the app/db are pulled in via dynamic import after the assignments below.
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const BOT_TOKEN = 'test-bot-token';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.DATABASE_URL = ':memory:';
delete process.env.DEV_USER_ID; // never rely on the dev bypass here

const { createApp } = await import('./app');
const { db, schema } = await import('./db');

const app = createApp();

/** A valid X-Telegram-Init-Data header for a given user (signed like Telegram). */
function initDataFor(user: { id: number; first_name?: string; username?: string }): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify({ id: user.id, first_name: user.first_name ?? `U${user.id}`, username: user.username }));
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

/** Make an authenticated API request as `user`. Returns the raw Response. */
function as(userId: number, path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initDataFor({ id: userId }),
      ...(init.headers ?? {}),
    },
  });
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** Create a group owned by `userId`; returns its id. */
async function makeGroup(userId: number, title = 'Trip', currency = 'USD'): Promise<string> {
  const res = await as(userId, '/groups', json({ title, currency }));
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

beforeAll(() => {
  migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle') });
});

beforeEach(() => {
  // Fresh state per test (children first — foreign_keys is ON).
  db.delete(schema.expenseSplits).run();
  db.delete(schema.settlements).run();
  db.delete(schema.expenses).run();
  db.delete(schema.groupMembers).run();
  db.delete(schema.groups).run();
  db.delete(schema.users).run();
});

describe('auth', () => {
  it('rejects a request with no initData', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });

  it('rejects a forged initData hash', async () => {
    const res = await app.request('/api/me', { headers: { 'X-Telegram-Init-Data': 'user=%7B%22id%22%3A1%7D&auth_date=9999999999&hash=deadbeef' } });
    expect(res.status).toBe(401);
  });

  it('accepts validly signed initData', async () => {
    const res = await as(1, '/me');
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(1);
  });
});

describe('groups + membership authorization', () => {
  it('creates a group and lists it for the creator', async () => {
    const id = await makeGroup(1);
    const res = await as(1, '/groups');
    expect(res.status).toBe(200);
    expect((await res.json()).map((g: { id: string }) => g.id)).toContain(id);
  });

  it('forbids a non-member from reading a group', async () => {
    const id = await makeGroup(1);
    const res = await as(2, `/groups/${id}`);
    expect(res.status).toBe(403);
  });

  it('lets a user self-join, then read the group', async () => {
    const id = await makeGroup(1);
    expect((await as(2, `/groups/${id}/join`, { method: 'POST' })).status).toBe(201);
    expect((await as(2, `/groups/${id}`)).status).toBe(200);
  });
});

describe('expenses', () => {
  it('adds an equal-split expense and computes per-currency balances', async () => {
    const id = await makeGroup(1);
    await as(2, `/groups/${id}/join`, { method: 'POST' });

    const res = await as(1, '/expenses', json({
      groupId: id, description: 'Dinner', amount: 1000, paidBy: 1, splitType: 'equal', participants: [1, 2], currency: 'USD',
    }));
    expect(res.status).toBe(201);

    const bal = await (await as(1, `/settlements/balances?groupId=${id}`)).json();
    const net = Object.fromEntries(bal.balances.map((b: { userId: number; net: number }) => [b.userId, b.net]));
    expect(net[1]).toBe(500); // paid 1000, owes 500 → +500
    expect(net[2]).toBe(-500);
    expect(bal.suggestions).toContainEqual({ fromUser: 2, toUser: 1, amount: 500, currency: 'USD' });
  });

  it('forbids an expense whose participant is not a member', async () => {
    const id = await makeGroup(1);
    const res = await as(1, '/expenses', json({
      groupId: id, description: 'x', amount: 1000, paidBy: 1, splitType: 'equal', participants: [1, 999],
    }));
    expect(res.status).toBe(403);
  });

  it('edits an expense (PATCH replaces amount + splits)', async () => {
    const id = await makeGroup(1);
    await as(2, `/groups/${id}/join`, { method: 'POST' });
    const eid = (await (await as(1, '/expenses', json({
      groupId: id, description: 'Dinner', amount: 1000, paidBy: 1, splitType: 'equal', participants: [1, 2],
    }))).json()).id;

    await as(1, `/expenses/${eid}`, { ...json({
      groupId: id, description: 'Dinner (fixed)', amount: 2000, paidBy: 1, splitType: 'equal', participants: [1, 2],
    }), method: 'PATCH' });

    const list = await (await as(1, `/expenses?groupId=${id}`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe(2000);
    expect(list[0].description).toBe('Dinner (fixed)');
    expect(list[0].splits.find((s: { userId: number }) => s.userId === 2).amount).toBe(1000);
  });

  it('deletes an expense and its splits', async () => {
    const id = await makeGroup(1);
    const eid = (await (await as(1, '/expenses', json({
      groupId: id, description: 'x', amount: 1000, paidBy: 1, splitType: 'equal', participants: [1],
    }))).json()).id;
    expect((await as(1, `/expenses/${eid}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await as(1, `/expenses?groupId=${id}`)).json()).toHaveLength(0);
  });
});

describe('refunds (negative expenses)', () => {
  it('nets a refund against prior spend', async () => {
    const id = await makeGroup(1);
    await as(2, `/groups/${id}/join`, { method: 'POST' });
    // 1 pays 1000 split equally → 2 owes 500.
    await as(1, '/expenses', json({ groupId: id, description: 'Tickets', amount: 1000, paidBy: 1, splitType: 'equal', participants: [1, 2] }));
    // 400 refunded to 1, split equally → each credited 200 back.
    const res = await as(1, '/expenses', json({ groupId: id, description: 'Refund', amount: -400, paidBy: 1, splitType: 'equal', participants: [1, 2] }));
    expect(res.status).toBe(201);

    const bal = await (await as(1, `/settlements/balances?groupId=${id}`)).json();
    const net = Object.fromEntries(bal.balances.map((b: { userId: number; net: number }) => [b.userId, b.net]));
    // 1 net outlay 600, own share 300 → owed 300; 2 owes 300.
    expect(net[1]).toBe(300);
    expect(net[2]).toBe(-300);
  });

  it('rejects a zero-amount expense', async () => {
    const id = await makeGroup(1);
    const res = await as(1, '/expenses', json({ groupId: id, description: 'x', amount: 0, paidBy: 1, splitType: 'equal', participants: [1] }));
    expect(res.status).toBe(400);
  });
});

describe('placeholders + claim (merge)', () => {
  it('creates a placeholder with a negative id and merges it into the claimer', async () => {
    const id = await makeGroup(1);

    // Add a placeholder "Alex".
    const ph = await (await as(1, `/groups/${id}/placeholders`, json({ name: 'Alex' }))).json();
    expect(ph.id).toBeLessThan(0);
    expect(ph.isPlaceholder).toBe(true);

    // 1 pays 900, split equally between 1 and the placeholder → placeholder owes 450.
    await as(1, '/expenses', json({ groupId: id, description: 'Cab', amount: 900, paidBy: 1, splitType: 'equal', participants: [1, ph.id] }));

    // User 2 joins and claims the placeholder (becomes Alex).
    await as(2, `/groups/${id}/join`, { method: 'POST' });
    const claim = await as(2, `/groups/${id}/claim`, json({ placeholderId: ph.id }));
    expect(claim.status).toBe(200);

    // Placeholder is gone; its split is now user 2's; balances reflect 2 owing 1.
    const detail = await (await as(2, `/groups/${id}`)).json();
    expect(detail.members.map((m: { id: number }) => m.id).sort()).toEqual([1, 2]);
    expect(detail.members.some((m: { id: number }) => m.id < 0)).toBe(false);

    const bal = await (await as(2, `/settlements/balances?groupId=${id}`)).json();
    const net = Object.fromEntries(bal.balances.map((b: { userId: number; net: number }) => [b.userId, b.net]));
    expect(net[1]).toBe(450);
    expect(net[2]).toBe(-450);
  });

  it('sums split amounts when the claimer was already on the same expense', async () => {
    const id = await makeGroup(1);
    await as(2, `/groups/${id}/join`, { method: 'POST' });
    const ph = await (await as(1, `/groups/${id}/placeholders`, json({ name: 'Ghost' }))).json();

    // 1 pays 900 split three ways: 1, 2, placeholder → 300 each.
    await as(1, '/expenses', json({ groupId: id, description: 'Trip', amount: 900, paidBy: 1, splitType: 'equal', participants: [1, 2, ph.id] }));

    // 2 claims the placeholder: 2's own 300 + placeholder's 300 should merge → 600.
    expect((await as(2, `/groups/${id}/claim`, json({ placeholderId: ph.id }))).status).toBe(200);

    const list = await (await as(1, `/expenses?groupId=${id}`)).json();
    const splitFor2 = list[0].splits.find((s: { userId: number }) => s.userId === 2);
    expect(splitFor2.amount).toBe(600);
    expect(list[0].splits.some((s: { userId: number }) => s.userId < 0)).toBe(false);

    const bal = await (await as(1, `/settlements/balances?groupId=${id}`)).json();
    const net = Object.fromEntries(bal.balances.map((b: { userId: number; net: number }) => [b.userId, b.net]));
    expect(net[1]).toBe(600); // paid 900, own share 300
    expect(net[2]).toBe(-600);
  });

  it('refuses to claim a non-placeholder id', async () => {
    const id = await makeGroup(1);
    const res = await as(1, `/groups/${id}/claim`, json({ placeholderId: 5 }));
    expect(res.status).toBe(400);
  });
});
