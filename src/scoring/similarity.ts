import { supabase } from '../db/client.js';
import { config } from '../config.js';

export interface AnalogDay {
  date: string;
  similarity: number;          // 0-1, higher = more similar
  matched_candles: number;     // how many candles were compared
  day_change_pct: number;      // how that day ended
  remaining_profile: number[]; // what happened AFTER the matched portion
  max_gain_after: number;      // max upside after match point
  max_loss_after: number;      // max downside after match point
  optimal_profit: number;      // best trade possible after match point
}

export interface AnalogResult {
  ticker: string;
  current_pct: number;         // current % from open
  candles_so_far: number;
  analogs: AnalogDay[];
  consensus: {
    bullish_count: number;
    bearish_count: number;
    avg_remaining_move: number;
    median_remaining_move: number;
  };
}

/**
 * Compute Euclidean distance between first n elements of two vectors,
 * converted to a similarity score: 1 / (1 + distance)
 */
export function computeSimilarity(
  current: number[],
  historical: number[],
  n: number,
): number {
  const len = Math.min(n, current.length, historical.length);
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const diff = current[i] - historical[i];
    sumSq += diff * diff;
  }
  const distance = Math.sqrt(sumSq);
  return 1 / (1 + distance);
}

/**
 * Find similar historical days for a stock given current intraday candles.
 * @param stockId  - The DB stock_id
 * @param currentCandles - Array of pct_from_open values for each 15-min candle so far today
 * @param topN    - How many analogs to return (default 10)
 */
export async function findAnalogs(
  stockId: number,
  currentCandles: number[],
  topN = 10,
): Promise<AnalogResult> {
  const n = currentCandles.length;
  const candlesPerDay = config.market.candlesPerDay;

  // Fetch all historical day_profiles for this stock
  const { data, error } = await supabase
    .from('day_profiles')
    .select('date, profile_vector, day_change_pct')
    .eq('stock_id', stockId)
    .order('date', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch day_profiles: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return {
      ticker: String(stockId),
      current_pct: currentCandles[n - 1] ?? 0,
      candles_so_far: n,
      analogs: [],
      consensus: {
        bullish_count: 0,
        bearish_count: 0,
        avg_remaining_move: 0,
        median_remaining_move: 0,
      },
    };
  }

  // Score each historical day
  const scored = data.map((row) => {
    const profileVec: number[] = Array.isArray(row.profile_vector)
      ? row.profile_vector
      : parseVectorString(row.profile_vector as string);

    const similarity = computeSimilarity(currentCandles, profileVec, n);
    const remaining_profile = profileVec.slice(n);

    // Compute max gain/loss from remaining candles (relative to the match point)
    const matchPointPct = profileVec[n - 1] ?? 0;
    const relRemaining = remaining_profile.map((v) => v - matchPointPct);

    const max_gain_after = relRemaining.length > 0
      ? Math.max(0, ...relRemaining)
      : 0;
    const max_loss_after = relRemaining.length > 0
      ? Math.min(0, ...relRemaining)
      : 0;

    // Optimal profit: best possible trade (long or short) after match point
    const optimal_profit = Math.max(max_gain_after, Math.abs(max_loss_after));

    return {
      date: row.date as string,
      similarity,
      matched_candles: n,
      day_change_pct: row.day_change_pct as number,
      remaining_profile,
      max_gain_after,
      max_loss_after,
      optimal_profit,
    } satisfies AnalogDay;
  });

  // Sort by similarity descending and take top N
  scored.sort((a, b) => b.similarity - a.similarity);
  const analogs = scored.slice(0, topN);

  // Compute consensus
  const remainingMoves = analogs.map((a) => {
    const rem = a.remaining_profile;
    return rem.length > 0 ? rem[rem.length - 1] - (a.remaining_profile[0] ?? 0) : 0;
  });

  const bullish_count = remainingMoves.filter((m) => m > 0).length;
  const bearish_count = remainingMoves.filter((m) => m < 0).length;

  const avg_remaining_move =
    remainingMoves.length > 0
      ? remainingMoves.reduce((s, v) => s + v, 0) / remainingMoves.length
      : 0;

  const sorted = [...remainingMoves].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median_remaining_move =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  const current_pct = currentCandles[n - 1] ?? 0;

  // Resolve ticker name (best effort — caller usually knows it)
  const ticker = String(stockId);

  return {
    ticker,
    current_pct,
    candles_so_far: n,
    analogs,
    consensus: {
      bullish_count,
      bearish_count,
      avg_remaining_move,
      median_remaining_move,
    },
  };
}

/**
 * Parse a pgvector string like "[0.1,0.2,...]" or "{0.1,0.2,...}" into a number array.
 */
function parseVectorString(s: string): number[] {
  if (!s) return [];
  return s
    .replace(/[\[\]{}]/g, '')
    .split(',')
    .map((v) => parseFloat(v.trim()));
}
