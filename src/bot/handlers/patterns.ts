import { Context } from 'grammy';
import { supabase } from '../../db/client.js';

export async function handlePatterns(ctx: Context) {
  const text = ctx.message?.text?.trim() ?? '';
  const ticker = text.replace(/^\/patterns\s*/i, '').trim().toUpperCase();

  if (!ticker) {
    await ctx.reply('Использование: /patterns ALAB');
    return;
  }

  const { data: stock } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('ticker', ticker)
    .single();

  if (!stock) {
    await ctx.reply(`❌ ${ticker} не отслеживается.`);
    return;
  }

  const { data: patterns } = await supabase
    .from('patterns')
    .select('type, description, lifecycle_stage, win_rate, expected_value, occurrences, accuracy_30d')
    .eq('stock_id', stock.id)
    .in('lifecycle_stage', ['validated', 'live', 'monitored'])
    .order('win_rate', { ascending: false });

  if (!patterns?.length) {
    await ctx.reply(`Нет активных паттернов для ${ticker}.`);
    return;
  }

  let msg = `📊 *Паттерны ${ticker}:*\n\n`;
  for (const p of patterns) {
    const stageEmoji = p.lifecycle_stage === 'live' ? '🟢' : p.lifecycle_stage === 'monitored' ? '🟡' : '⚪';
    msg += `${stageEmoji} *${p.description}*\n`;
    msg += `   Win: ${(p.win_rate * 100).toFixed(1)}% | EV: ${p.expected_value?.toFixed(2)}% | Событий: ${p.occurrences} | ${p.lifecycle_stage}\n\n`;
  }

  await ctx.reply(msg, { parse_mode: 'Markdown' });
}
