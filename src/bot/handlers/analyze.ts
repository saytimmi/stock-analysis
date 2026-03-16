import { Context } from 'grammy';
import { supabase } from '../../db/client.js';
import { analyzeCurrentSession } from '../../scoring/realtime.js';
import { getActivePatternSignals, computeComposite } from '../../scoring/composite.js';

export async function handleAnalyze(ctx: Context) {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  // Extract tickers from message (uppercase words that look like tickers)
  const tickers = text.toUpperCase().match(/[A-Z]{1,5}/g);
  if (!tickers?.length) {
    await ctx.reply('Отправь тикер акции, например ALAB');
    return;
  }

  for (const ticker of tickers) {
    await ctx.reply(`🔍 Анализирую ${ticker}...`);

    try {
      const { data: stock } = await supabase
        .from('stocks')
        .select('id, ticker, name')
        .eq('ticker', ticker)
        .single();

      if (!stock) {
        await ctx.reply(`❌ ${ticker} не отслеживается. Добавь через дашборд.`);
        continue;
      }

      const analogResult = await analyzeCurrentSession(stock.id, ticker);

      const currentCandles = analogResult.analogs.length > 0
        ? Array.from({ length: analogResult.candles_so_far }, (_, i) => ({
            pct_from_open: i < analogResult.candles_so_far ? analogResult.current_pct : 0,
            volume: 0,
          }))
        : [];

      const patternSignals = await getActivePatternSignals(stock.id, currentCandles);

      const allSignals = [...patternSignals];
      if (analogResult.analogs.length > 0) {
        const { consensus } = analogResult;
        allSignals.push({
          source: 'analog_consensus',
          direction: consensus.avg_remaining_move > 0 ? 'up' : 'down',
          strength: Math.min(Math.abs(consensus.avg_remaining_move) / 3, 1),
          weight: 0.30,
          accuracy: consensus.bullish_count / (consensus.bullish_count + consensus.bearish_count),
        });
      }

      const composite = computeComposite(allSignals);

      let msg = `📊 *${ticker}* (${stock.name ?? ''})\n\n`;

      // Текущий статус
      msg += `📈 Сейчас: ${analogResult.current_pct >= 0 ? '+' : ''}${analogResult.current_pct.toFixed(2)}% от открытия\n`;
      msg += `⏱ ${analogResult.candles_so_far} свечей (${analogResult.candles_so_far * 15} мин)\n\n`;

      // Композитный скор
      const scoreEmoji = composite.score > 20 ? '🟢' : composite.score < -20 ? '🔴' : '🟡';
      msg += `${scoreEmoji} *Скор: ${composite.score > 0 ? '+' : ''}${composite.score.toFixed(0)}* (${composite.confidence === 'high' ? 'высокий' : composite.confidence === 'medium' ? 'средний' : 'низкий'})\n`;
      msg += `Ожид. доход: ${composite.expected_value >= 0 ? '+' : ''}${composite.expected_value.toFixed(2)}%\n`;
      msg += `Стоп-лосс: ${composite.suggested_stop_loss.toFixed(2)}%\n\n`;

      // Похожие дни
      if (analogResult.analogs.length > 0) {
        msg += `📅 *Похожие дни:*\n`;
        for (const analog of analogResult.analogs.slice(0, 5)) {
          const dirEmoji = analog.day_change_pct >= 0 ? '📈' : '📉';
          msg += `${dirEmoji} ${analog.date} (${(analog.similarity * 100).toFixed(0)}%) → закрытие ${analog.day_change_pct >= 0 ? '+' : ''}${analog.day_change_pct.toFixed(2)}%\n`;
        }

        const { consensus } = analogResult;
        msg += `\n🎯 ${consensus.bullish_count} вверх / ${consensus.bearish_count} вниз\n`;
        msg += `Среднее оставшееся движение: ${consensus.avg_remaining_move >= 0 ? '+' : ''}${consensus.avg_remaining_move.toFixed(2)}%\n`;
      } else {
        msg += `⚠️ Рынок закрыт или свечей ещё нет.\n`;
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (err: any) {
      console.error(`Error analyzing ${ticker}:`, err);
      await ctx.reply(`❌ Ошибка анализа ${ticker}: ${err.message}`);
    }
  }
}
