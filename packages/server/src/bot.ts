import { formatMoney } from '@banana-split/shared';
import { eq } from 'drizzle-orm';
import { Bot } from 'grammy';
import { randomUUID } from 'node:crypto';
import { db, schema } from './db';
import { computeGroupBalances, memberNames } from './groupBalances';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN is required');

const webAppUrl = process.env.WEBAPP_URL ?? 'https://example.com';

// Singleton bot instance, imported by both the server entry and API routes.
export const bot = new Bot(token);

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Welcome to Banana Split 🍌\nSplit shared expenses with your group — no signup needed.',
    {
      reply_markup: {
        // web_app buttons are only allowed in private chats.
        inline_keyboard: [[{ text: 'Open Banana Split', web_app: { url: webAppUrl } }]],
      },
    },
  );
});

/**
 * When the bot is added to (or removed from) a group chat, link/unlink a Group to
 * that chat so notifications have a target. Adding also seeds the linked group
 * with the person who added the bot as its first member.
 */
bot.on('my_chat_member', async (ctx) => {
  const { chat } = ctx;
  if (chat.type !== 'group' && chat.type !== 'supergroup') return;

  const status = ctx.myChatMember.new_chat_member.status;
  const added = status === 'member' || status === 'administrator';
  const removed = status === 'left' || status === 'kicked';

  if (added) {
    let group = db.select().from(schema.groups).where(eq(schema.groups.telegramChatId, chat.id)).get();
    if (!group) {
      const id = randomUUID();
      db.insert(schema.groups).values({ id, title: chat.title ?? 'Group', telegramChatId: chat.id }).run();
      const adder = ctx.from;
      if (adder && !adder.is_bot) {
        db.insert(schema.users)
          .values({ id: adder.id, firstName: adder.first_name, lastName: adder.last_name, username: adder.username })
          .onConflictDoNothing()
          .run();
        db.insert(schema.groupMembers).values({ groupId: id, userId: adder.id }).onConflictDoNothing().run();
      }
      group = db.select().from(schema.groups).where(eq(schema.groups.id, id)).get()!;
    }

    // In a group we can't use a web_app inline button; a startapp deep link opens
    // the Mini App (with the group id as start_param, so the opener auto-joins).
    const deepLink = `https://t.me/${ctx.me.username}?startapp=${group.id}`;
    await ctx.reply('Banana Split 🍌 is linked to this chat. Tap below to open it and split expenses.', {
      reply_markup: { inline_keyboard: [[{ text: 'Open Banana Split', url: deepLink }]] },
    });
  } else if (removed) {
    // Stop targeting this chat for notifications; keep the group and its data.
    db.update(schema.groups).set({ telegramChatId: null }).where(eq(schema.groups.telegramChatId, chat.id)).run();
  }
});

/**
 * /balance — reply in the linked group chat with the current simplified settle-up.
 */
bot.command('balance', async (ctx) => {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    await ctx.reply('Use /balance inside a group chat linked to Banana Split.');
    return;
  }
  const group = db.select().from(schema.groups).where(eq(schema.groups.telegramChatId, ctx.chat.id)).get();
  if (!group) {
    await ctx.reply('This chat isn’t linked to a Banana Split group yet — add me and try again.');
    return;
  }

  const { suggestions } = computeGroupBalances(group.id);
  if (suggestions.length === 0) {
    await ctx.reply(`🍌 ${group.title}: everyone’s settled up! 🎉`);
    return;
  }

  const names = memberNames(suggestions.flatMap((s) => [s.fromUser, s.toUser]));
  const nameOf = (id: number) => names.get(id) ?? `User ${id}`;
  const lines = suggestions.map(
    (s) => `• ${nameOf(s.fromUser)} → ${nameOf(s.toUser)}: ${formatMoney(s.amount, s.currency)}`,
  );
  await ctx.reply(`🍌 ${group.title} — settle up:\n${lines.join('\n')}`);
});

/**
 * Post a notification to a linked Telegram group chat.
 * Failures are logged but never throw — a notification must not fail the API call.
 */
export async function notifyGroup(chatId: number, message: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, message);
  } catch (err) {
    console.error('Failed to notify group', chatId, err);
  }
}
