import { PatternCandle } from './types.js';

/**
 * Aggregate 15-min candles into larger timeframes.
 * factor=2 → 30min, factor=4 → 1hour
 *
 * Rules:
 *   open  = first candle's open
 *   high  = max of all highs
 *   low   = min of all lows
 *   close = last candle's close
 *   volume = sum of all volumes
 *   pct_from_open = last candle's pct_from_open
 *   relative_move = last candle's relative_move
 *   time  = first candle's time
 */
export function aggregate(candles: PatternCandle[], factor: number): PatternCandle[] {
  if (factor < 1) throw new Error('factor must be >= 1');
  if (candles.length === 0) return [];

  const result: PatternCandle[] = [];

  for (let i = 0; i < candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    if (group.length === 0) continue;

    const first = group[0];
    const last = group[group.length - 1];

    result.push({
      time: first.time,
      open: first.open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: last.close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
      pct_from_open: last.pct_from_open,
      relative_move: last.relative_move,
    });
  }

  return result;
}
