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
    await ctx.reply('Send me a ticker symbol, e.g. ALAB');
    return;
  }

  for (const ticker of tickers) {
    await ctx.reply(`🔍 Analyzing ${ticker}...`);

    try {
      // Look up stock in DB
      const { data: stock } = await supabase
        .from('stocks')
        .select('id, ticker, name')
        .eq('ticker', ticker)
        .single();

      if (!stock) {
        await ctx.reply(`❌ ${ticker} not tracked. Add it via the dashboard.`);
        continue;
      }

      // Get current session analysis (analogs)
      const analogResult = await analyzeCurrentSession(stock.id, ticker);

      // Get pattern signals
      const currentCandles = analogResult.analogs.length > 0
        ? Array.from({ length: analogResult.candles_so_far }, (_, i) => ({
            pct_from_open: i < analogResult.candles_so_far ? analogResult.current_pct : 0,
            volume: 0,
          }))
        : [];

      const patternSignals = await getActivePatternSignals(stock.id, currentCandles);

      // Build analog consensus signal
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

      // Format response
      let msg = `📊 *${ticker}* (${stock.name ?? ''})\n\n`;

      // Current status
      msg += `📈 Now: ${analogResult.current_pct >= 0 ? '+' : ''}${analogResult.current_pct.toFixed(2)}% from open\n`;
      msg += `⏱ ${analogResult.candles_so_far} candles (${analogResult.candles_so_far * 15} min)\n\n`;

      // Composite score
      const scoreEmoji = composite.score > 20 ? '🟢' : composite.score < -20 ? '🔴' : '🟡';
      msg += `${scoreEmoji} *Score: ${composite.score > 0 ? '+' : ''}${composite.score.toFixed(0)}* (${composite.confidence})\n`;
      msg += `EV: ${composite.expected_value >= 0 ? '+' : ''}${composite.expected_value.toFixed(2)}%\n`;
      msg += `Stop-loss: ${composite.suggested_stop_loss.toFixed(2)}%\n\n`;

      // Top analogs
      if (analogResult.analogs.length > 0) {
        msg += `📅 *Similar days:*\n`;
        for (const analog of analogResult.analogs.slice(0, 5)) {
          const dirEmoji = analog.day_change_pct >= 0 ? '📈' : '📉';
          msg += `${dirEmoji} ${analog.date} (${(analog.similarity * 100).toFixed(0)}%) → closed ${analog.day_change_pct >= 0 ? '+' : ''}${analog.day_change_pct.toFixed(2)}%\n`;
        }

        const { consensus } = analogResult;
        msg += `\n🎯 ${consensus.bullish_count} bullish / ${consensus.bearish_count} bearish\n`;
        msg += `Avg remaining: ${consensus.avg_remaining_move >= 0 ? '+' : ''}${consensus.avg_remaining_move.toFixed(2)}%\n`;
      } else {
        msg += `⚠️ Market closed or no candles yet today.\n`;
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (err: any) {
      console.error(`Error analyzing ${ticker}:`, err);
      await ctx.reply(`❌ Error analyzing ${ticker}: ${err.message}`);
    }
  }
}
