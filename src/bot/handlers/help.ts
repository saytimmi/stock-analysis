import { Context, InlineKeyboard } from 'grammy';

const MINI_APP_URL = process.env.MINI_APP_URL || '';

export async function handleHelp(ctx: Context) {
  const msg =
    `Анализирую паттерны по историческим данным.\n\n` +
    `Напиши тикер — дам расклад: какие паттерны работают, с какой вероятностью, куда вероятнее пойдёт.\n\n` +
    `*Команды:*\n` +
    `/patterns ALAB — все паттерны\n` +
    `/pattern — создать свой паттерн`;

  if (MINI_APP_URL) {
    const kb = new InlineKeyboard().webApp('📊 Открыть приложение', MINI_APP_URL);
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: kb });
  } else {
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  }
}
