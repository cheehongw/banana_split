import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth';
import { expensesRoute } from './routes/expenses';
import { groupsRoute } from './routes/groups';
import { settlementsRoute } from './routes/settlements';

/**
 * Build the Hono app (API + health check). Kept separate from index.ts so it can
 * be exercised in-memory via `app.request(...)` in tests without binding a port.
 */
export function createApp(): Hono {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

  const app = new Hono();

  // The Mini App is served from a different origin in dev; allow it.
  app.use('*', cors());

  app.get('/health', (c) => c.json({ ok: true }));

  // Every /api route requires valid Telegram initData (or the dev bypass).
  const api = new Hono();
  api.use('*', authMiddleware(BOT_TOKEN));
  // Who the authenticated caller is (works under the dev bypass too).
  api.get('/me', (c) => {
    const u = c.get('user');
    return c.json({ id: u.id, firstName: u.first_name, lastName: u.last_name, username: u.username, photoUrl: u.photo_url });
  });
  api.route('/groups', groupsRoute);
  api.route('/expenses', expensesRoute);
  api.route('/settlements', settlementsRoute);
  app.route('/api', api);

  return app;
}
