import { PolygonClient } from '../polygon/client.js';
import { config, toETDate, toETTime } from '../config.js';
import { findAnalogs, type AnalogResult } from './similarity.js';
import { supabase } from '../db/client.js';

/**
 * Fetch today's 15-min candles for a ticker from Polygon,
 * compute pct_from_open, and run similarity search against historical days.
 */
export async function analyzeCurrentSession(
  stockId: number,
  ticker: string,
): Promise<AnalogResult> {
  const polygon = new PolygonClient();

  // Use today's date in ET timezone
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: config.market.timezone,
  });

  // Fetch 15-min candles for today
  const response = await polygon.getAggregates(
    ticker,
    config.market.candleInterval,
    'minute',
    today,
    today,
  );

  const bars = response.results ?? [];

  if (bars.length === 0) {
    // No data yet (pre-market or market closed), return empty result
    return {
      ticker,
      current_pct: 0,
      candles_so_far: 0,
      analogs: [],
      consensus: {
        bullish_count: 0,
        bearish_count: 0,
        avg_remaining_move: 0,
        median_remaining_move: 0,
      },
    };
  }

  // The open of the day is the open of the first regular-session candle
  const openPrice = bars[0].o;

  // Compute pct_from_open for each candle (using close price, matching the profile convention)
  const currentCandles: number[] = bars.map((bar) => {
    return openPrice !== 0 ? ((bar.c - openPrice) / openPrice) * 100 : 0;
  });

  // Run the similarity search
  const result = await findAnalogs(stockId, currentCandles);

  // Patch ticker name (findAnalogs uses stockId as fallback)
  return { ...result, ticker };
}
