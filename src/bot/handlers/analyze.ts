import { Context } from 'grammy';
import { supabase } from '../../db/client.js';
import { analyzeCurrentSession } from '../../scoring/realtime.js';
import { getActivePatternSignals, computeComposite } from '../../scoring/composite.js';
import { traderAnalysis } from '../../agents/trader.js';

export async function handleAnalyze(ctx: Context) {
  const text = ctx.message?.text?.trim();
  if (!text) return;

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

      // Get analogs
      const analogResult = await analyzeCurrentSession(stock.id, ticker);

      // Get pattern signals
      const currentCandles = analogResult.candles_so_far > 0
        ? Array.from({ length: analogResult.candles_so_far }, () => ({
            pct_from_open: analogResult.current_pct,
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
          accuracy: (consensus.bullish_count + consensus.bearish_count) > 0
            ? consensus.bullish_count / (consensus.bullish_count + consensus.bearish_count)
            : 0.5,
        });
      }

      const composite = computeComposite(allSignals);

      // Load active patterns for context
      const { data: patterns } = await supabase
        .from('patterns')
        .select('description, win_rate, expected_value, occurrences')
        .eq('stock_id', stock.id)
        .in('lifecycle_stage', ['validated', 'live', 'monitored'])
        .order('win_rate', { ascending: false });

      // Get Claude Trader analysis
      const analysis = await traderAnalysis(
        ticker,
        stock.name ?? ticker,
        analogResult,
        composite,
        patterns ?? [],
      );

      await ctx.reply(analysis, { parse_mode: 'Markdown' });

    } catch (err: any) {
      console.error(`Error analyzing ${ticker}:`, err);
      await ctx.reply(`❌ Ошибка анализа ${ticker}: ${err.message}`);
    }
  }
}
