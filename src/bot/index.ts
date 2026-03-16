import { Bot } from 'grammy';
import { config } from '../config.js';
import { handleAnalyze } from './handlers/analyze.js';
import { handlePatterns } from './handlers/patterns.js';
import { handleHelp } from './handlers/help.js';

export function createBot() {
  const bot = new Bot(config.telegram.botToken);

  // Middleware: log all messages
  bot.use(async (ctx, next) => {
    console.log(`[${new Date().toISOString()}] ${ctx.from?.username}: ${ctx.message?.text}`);
    await next();
  });

  // Commands
  bot.command('start', handleHelp);
  bot.command('help', handleHelp);
  bot.command('patterns', handlePatterns);

  // Any text message = analyze stock(s)
  // e.g. "ALAB" or "ALAB NVDA" or "посмотри ALAB"
  bot.on('message:text', handleAnalyze);

  return bot;
}
