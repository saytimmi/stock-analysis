import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { handleAnalyze } from './handlers/analyze.js';
import { handlePatterns } from './handlers/patterns.js';
import { handleHelp } from './handlers/help.js';
import { handleCustomPattern, isInPatternSession } from './handlers/custom-pattern.js';

const MINI_APP_URL = process.env.MINI_APP_URL || '';

export function createBot() {
  const bot = new Bot(config.telegram.botToken);

  // Middleware: log all messages
  bot.use(async (ctx, next) => {
    console.log(`[${new Date().toISOString()}] ${ctx.from?.username}: ${ctx.message?.text}`);
    await next();
  });

  // Commands
  bot.command('start', async (ctx) => {
    await handleHelp(ctx);
    if (MINI_APP_URL) {
      const kb = new InlineKeyboard().webApp('📊 Открыть Mini App', MINI_APP_URL);
      await ctx.reply('Или открой полный анализ в Mini App:', { reply_markup: kb });
    }
  });
  bot.command('help', handleHelp);
  bot.command('patterns', handlePatterns);
  bot.command('pattern', handleCustomPattern);

  // Route text messages: pattern dialogue takes priority when session active
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId && isInPatternSession(chatId)) {
      await handleCustomPattern(ctx);
    } else {
      await handleAnalyze(ctx);
    }
  });

  return bot;
}
