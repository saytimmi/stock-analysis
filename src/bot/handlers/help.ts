import { Context } from 'grammy';

export async function handleHelp(ctx: Context) {
  await ctx.reply(
    `📊 *Stock Pattern Analyzer*\n\n` +
    `Send me a ticker (e.g. \`ALAB\`) and I'll show:\n` +
    `• Current intraday situation\n` +
    `• Similar historical days\n` +
    `• Pattern matches and composite score\n\n` +
    `*Commands:*\n` +
    `/patterns ALAB — show all patterns for a stock\n` +
    `/help — this message\n\n` +
    `You can send multiple tickers: \`ALAB NVDA MU\``,
    { parse_mode: 'Markdown' }
  );
}
