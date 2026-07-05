import { Bot } from 'grammy';

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
        inline_keyboard: [[{ text: 'Open Banana Split', web_app: { url: webAppUrl } }]],
      },
    },
  );
});

// TODO: when the bot is added to a group chat (my_chat_member update), create or
//       link a Group row using ctx.chat.id so notifications can target that chat.
// TODO: /balance command — reply in-chat with the current simplified balances.

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
