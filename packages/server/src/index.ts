import './env'; // must be first: loads .env before bot.ts reads BOT_TOKEN
import { serve } from '@hono/node-server';
import { webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth';
import { bot } from './bot';
import { expensesRoute } from './routes/expenses';
import { groupsRoute } from './routes/groups';
import { settlementsRoute } from './routes/settlements';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

const app = new Hono();

// The Mini App is served from a different origin in dev; allow it.
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

// Every /api route requires valid Telegram initData.
const api = new Hono();
api.use('*', authMiddleware(BOT_TOKEN));
api.route('/groups', groupsRoute);
api.route('/expenses', expensesRoute);
api.route('/settlements', settlementsRoute);
app.route('/api', api);

// Bot mode is mutually exclusive: webhook in production, long polling in dev.
// Registering webhookCallback() puts the bot into webhook mode, so we must NOT
// also call bot.start() — pick exactly one based on whether SERVER_URL is set.
if (process.env.SERVER_URL) {
  app.post('/webhook', webhookCallback(bot, 'hono', { secretToken: process.env.WEBHOOK_SECRET }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🍌 Banana Split server listening on :${info.port}`);
});

// Local dev: no public URL for a webhook, so use long polling instead.
// In production, set SERVER_URL and register the webhook (see CLAUDE.md).
if (!process.env.SERVER_URL) {
  bot.start({ onStart: (me) => console.log(`Bot @${me.username} started (long polling)`) });
}
