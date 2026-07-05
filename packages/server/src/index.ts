import './env'; // must be first: loads .env before bot.ts reads BOT_TOKEN
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { webhookCallback } from 'grammy';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { devUser } from './auth';
import { bot } from './bot';
import { db } from './db';

// Fail fast on a dangerous misconfiguration: the dev auth bypass must never be
// armed in production. (devUser() also allowlists NODE_ENV === 'development'.)
if (process.env.NODE_ENV === 'production' && process.env.DEV_USER_ID) {
  throw new Error('DEV_USER_ID must not be set when NODE_ENV=production');
}

// In production, apply committed Drizzle migrations on boot (fresh volume →
// clean schema). Dev keeps using `npm run db:push`.
if (process.env.NODE_ENV === 'production') {
  const migrationsFolder =
    process.env.MIGRATIONS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
  migrate(db, { migrationsFolder });
  console.log(`Applied migrations from ${migrationsFolder}`);
}

const app = createApp();

// Bot mode is mutually exclusive: webhook when SERVER_URL is set, else long
// polling. Long polling is the default for the homelab (outbound-only, no
// inbound webhook needed — the Mini App is reached via the tunnel, not the bot).
if (process.env.SERVER_URL) {
  app.post('/webhook', webhookCallback(bot, 'hono', { secretToken: process.env.WEBHOOK_SECRET }));
}

// Serve the built Mini App from the same origin as the API (set in production).
// Unknown non-API paths fall back to index.html (the app is a single page).
const webappDist = process.env.WEBAPP_DIST;
if (webappDist && existsSync(join(webappDist, 'index.html'))) {
  const indexHtml = readFileSync(join(webappDist, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root: webappDist }));
  app.notFound((c) => {
    const p = c.req.path;
    if (p.startsWith('/api') || p === '/webhook') return c.json({ error: 'not found' }, 404);
    return c.html(indexHtml);
  });
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🍌 Banana Split server listening on :${info.port}`);
  const dev = devUser();
  if (dev) {
    console.warn(`⚠️  DEV AUTH BYPASS ON — unauthenticated requests act as user ${dev.id} (${dev.first_name}). Never set DEV_USER_ID in production.`);
  }
});

if (!process.env.SERVER_URL) {
  bot.start({ onStart: (me) => console.log(`Bot @${me.username} started (long polling)`) });
}
