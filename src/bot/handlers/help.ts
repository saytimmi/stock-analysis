import { Context } from 'grammy';

export async function handleHelp(ctx: Context) {
  await ctx.reply(
    `📊 *Stock Pattern Analyzer*\n\n` +
    `Отправь тикер (например \`ALAB\`) и я покажу:\n` +
    `• Текущую ситуацию внутри дня\n` +
    `• Похожие исторические дни\n` +
    `• Совпадения с паттернами и общий скор\n\n` +
    `*Команды:*\n` +
    `/patterns ALAB — все паттерны по акции\n` +
    `/help — эта справка\n\n` +
    `Можно несколько тикеров сразу: \`ALAB NVDA MU\``,
    { parse_mode: 'Markdown' }
  );
}
