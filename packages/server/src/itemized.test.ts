// In-memory route tests for itemized expenses. Self-contained harness: drives
// the real Hono app via app.request(...) against an in-memory SQLite built from
// the committed migrations, authenticating with initData signed by a test
// BOT_TOKEN. (A broader harness lives on another branch; this file stays focused
// on the itemized flow and uses a distinct filename to avoid collisions.)
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const BOT_TOKEN = 'test-bot-token';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.DATABASE_URL = ':memory:';
delete process.env.DEV_USER_ID;

const { createApp } = await import('./app');
const { db, schema } = await import('./db');
const app = createApp();

function initDataFor(userId: number): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify({ id: userId, first_name: `U${userId}` }));
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

function as(userId: number, path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initDataFor(userId), ...(init.headers ?? {}) },
  }) as Promise<Response>;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (res: Response): Promise<any> => res.json();

async function makeGroupWithTwo(): Promise<string> {
  const id = (await j(await as(1, '/groups', post({ title: 'Trip', currency: 'USD' })))).id as string;
  await as(2, `/groups/${id}/join`, { method: 'POST' });
  return id;
}

beforeAll(() => {
  migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle') });
});
beforeEach(() => {
  db.delete(schema.expenseItemClaims).run();
  db.delete(schema.expenseItems).run();
  db.delete(schema.expenseSplits).run();
  db.delete(schema.settlements).run();
  db.delete(schema.expenses).run();
  db.delete(schema.groupMembers).run();
  db.delete(schema.groups).run();
  db.delete(schema.users).run();
});

describe('itemized expenses', () => {
  it('creates one, derives the total, and allocates tip proportionally', async () => {
    const gid = await makeGroupWithTwo();
    const res = await as(1, '/expenses', post({
      groupId: gid, description: 'Dinner', paidBy: 1, splitType: 'itemized', participants: [1, 2],
      items: [
        { description: 'Steak', amount: 2000, claimants: [1] },
        { description: 'Salad', amount: 1000, claimants: [2] },
      ],
      tip: 300,
    }));
    expect(res.status).toBe(201);

    const list = await j(await as(1, `/expenses?groupId=${gid}`));
    expect(list).toHaveLength(1);
    const e = list[0];
    expect(e.splitType).toBe('itemized');
    expect(e.amount).toBe(3300); // 3000 items + 300 tip, derived
    const owed = Object.fromEntries(e.splits.map((s: { userId: number; amount: number }) => [s.userId, s.amount]));
    expect(owed).toEqual({ 1: 2200, 2: 1100 }); // tip 300 split 200/100 by subtotal

    // items round-trip with claimants + a tip row
    expect(e.items).toHaveLength(3);
    const tip = e.items.find((i: { kind: string }) => i.kind === 'tip');
    expect(tip.amount).toBe(300);
    const steak = e.items.find((i: { description: string }) => i.description === 'Steak');
    expect(steak.claimants).toEqual([1]);

    // balances: payer 1 is owed 1100 by user 2
    const bal = await j(await as(1, `/settlements/balances?groupId=${gid}`));
    const net = Object.fromEntries(bal.balances.map((b: { userId: number; net: number }) => [b.userId, b.net]));
    expect(net).toEqual({ 1: 1100, 2: -1100 });
  });

  it('splits an unclaimed item across all participants', async () => {
    const gid = await makeGroupWithTwo();
    await as(1, '/expenses', post({
      groupId: gid, description: 'Shared platter', paidBy: 1, splitType: 'itemized', participants: [1, 2],
      items: [{ description: 'Platter', amount: 1000, claimants: [] }],
    }));
    const e = (await j(await as(1, `/expenses?groupId=${gid}`)))[0];
    const owed = Object.fromEntries(e.splits.map((s: { userId: number; amount: number }) => [s.userId, s.amount]));
    expect(owed).toEqual({ 1: 500, 2: 500 });
  });

  it('replaces items on edit', async () => {
    const gid = await makeGroupWithTwo();
    const eid = (await j(await as(1, '/expenses', post({
      groupId: gid, description: 'Dinner', paidBy: 1, splitType: 'itemized', participants: [1, 2],
      items: [{ description: 'Steak', amount: 2000, claimants: [1] }],
    })))).id;

    await as(1, `/expenses/${eid}`, { ...post({
      groupId: gid, description: 'Dinner', paidBy: 1, splitType: 'itemized', participants: [1, 2],
      items: [
        { description: 'Pizza', amount: 1200, claimants: [1, 2] },
        { description: 'Beer', amount: 800, claimants: [1] },
      ],
    }), method: 'PATCH' });

    const e = (await j(await as(1, `/expenses?groupId=${gid}`)))[0];
    expect(e.amount).toBe(2000);
    expect(e.items.map((i: { description: string }) => i.description).sort()).toEqual(['Beer', 'Pizza']);
    const owed = Object.fromEntries(e.splits.map((s: { userId: number; amount: number }) => [s.userId, s.amount]));
    expect(owed).toEqual({ 1: 1400, 2: 600 }); // pizza 600/600 + beer 800/0
  });

  it('rejects an itemized expense with no items', async () => {
    const gid = await makeGroupWithTwo();
    const res = await as(1, '/expenses', post({
      groupId: gid, description: 'x', paidBy: 1, splitType: 'itemized', participants: [1, 2], items: [],
    }));
    expect(res.status).toBe(400);
  });
});
