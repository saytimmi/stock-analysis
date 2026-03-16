import { PolygonClient } from '../polygon/client.js';
import { config, toETDate, toETTime } from '../config.js';
import { findAnalogs, type AnalogResult } from './similarity.js';
import { supabase } from '../db/client.js';

/**
 * Get the last trading day's candles from Supabase as fallback
 * when market is closed or no real-time data available.
 */
async function getLastTradingDay(stockId: number): Promise<{ candles: number[]; date: string } | null> {
  const { data } = await supabase
    .from('day_profiles')
    .select('date, profile_vector')
    .eq('stock_id', stockId)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (!data?.profile_vector) return null;

  // profile_vector is stored as pgvector string "[0.5,1.2,...]"
  const vec = typeof data.profile_vector === 'string'
    ? JSON.parse(data.profile_vector.replace(/^\[/, '[').replace(/\]$/, ']'))
    : data.profile_vector;

  return { candles: vec, date: data.date };
}

/**
 * Analyze current session — tries real-time first, falls back to last trading day.
 */
export async function analyzeCurrentSession(
  stockId: number,
  ticker: string,
): Promise<AnalogResult & { data_source: string }> {
  const polygon = new PolygonClient();

  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: config.market.timezone,
  });

  // Try real-time from Polygon
  try {
    const response = await polygon.getAggregates(
      ticker,
      config.market.candleInterval,
      'minute',
      today,
      today,
    );

    const bars = response.results ?? [];

    if (bars.length > 0) {
      const openPrice = bars[0].o;
      const currentCandles = bars.map(bar =>
        openPrice !== 0 ? ((bar.c - openPrice) / openPrice) * 100 : 0
      );

      const result = await findAnalogs(stockId, currentCandles);
      return { ...result, ticker, data_source: 'realtime' };
    }
  } catch {
    // Polygon error — fall through to historical
  }

  // Fallback: use last trading day from Supabase
  const lastDay = await getLastTradingDay(stockId);
  if (lastDay) {
    // Use full day profile to find analogs (simulate "end of day")
    const result = await findAnalogs(stockId, lastDay.candles);
    return {
      ...result,
      ticker,
      data_source: `historical (${lastDay.date})`,
    };
  }

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
    data_source: 'none',
  };
}
