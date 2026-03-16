import { supabase } from '../db/client.js';
import { config, isOPEX } from '../config.js';

export function buildProfileVector(candles: { pct_from_open: number }[]): number[] {
  return candles.map(c => c.pct_from_open);
}

export function padVector(vector: number[], targetLength: number): number[] {
  if (vector.length === 0) return Array(targetLength).fill(0);
  if (vector.length >= targetLength) return vector.slice(0, targetLength);
  const lastVal = vector[vector.length - 1];
  return [...vector, ...Array(targetLength - vector.length).fill(lastVal)];
}

export function classifyPreMarket(pctChange: number): 'up' | 'down' | 'flat' {
  if (pctChange > 0.25) return 'up';
  if (pctChange < -0.25) return 'down';
  return 'flat';
}

export async function computeAndStoreProfiles(
  stockId: number,
  fromDate?: string,
  toDate?: string
): Promise<number> {
  // Get dates that have regular candles
  let query = supabase
    .from('candles_15m')
    .select('date')
    .eq('stock_id', stockId)
    .eq('session', 'regular')
    .order('date');

  if (fromDate) query = query.gte('date', fromDate);
  if (toDate) query = query.lte('date', toDate);

  const { data: dateRows, error: dateError } = await query;
  if (dateError) throw dateError;

  const uniqueDates = [...new Set(dateRows?.map(r => r.date) ?? [])];
  let stored = 0;

  for (const date of uniqueDates) {
    // Get regular session candles for this day
    const { data: candles, error: candleError } = await supabase
      .from('candles_15m')
      .select('time, open, close, volume, pct_from_open, relative_move')
      .eq('stock_id', stockId)
      .eq('date', date)
      .eq('session', 'regular')
      .order('time');

    if (candleError) throw candleError;
    if (!candles?.length) continue;

    // Get pre-market candles
    const { data: preMarketCandles } = await supabase
      .from('candles_15m')
      .select('close, volume')
      .eq('stock_id', stockId)
      .eq('date', date)
      .eq('session', 'pre_market')
      .order('time');

    const dayOpen = candles[0].open;
    const dayClose = candles[candles.length - 1].close;
    const dayChangePct = dayOpen > 0 ? Number(((dayClose - dayOpen) / dayOpen * 100).toFixed(4)) : 0;

    // Profile vector
    const rawProfile = buildProfileVector(candles.map(c => ({ pct_from_open: c.pct_from_open ?? 0 })));
    const profileVector = padVector(rawProfile, config.market.candlesPerDay);

    // Relative profile vector
    const rawRelative = candles.map(c => c.relative_move ?? 0);
    const relativeVector = padVector(rawRelative, config.market.candlesPerDay);

    // Volume profile (normalized to average)
    const volumes = candles.map(c => c.volume);
    const avgVol = volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length;
    const volumeProfile = volumes.map((v: number) => avgVol > 0 ? Number((v / avgVol).toFixed(4)) : 0);

    // Pre-market analysis
    let preMarketDirection: 'up' | 'down' | 'flat' = 'flat';
    let preMarketVolumeRatio = 0;
    if (preMarketCandles?.length) {
      const pmLastClose = preMarketCandles[preMarketCandles.length - 1].close;
      const pmPct = dayOpen > 0 ? ((pmLastClose - dayOpen) / dayOpen * 100) : 0;
      preMarketDirection = classifyPreMarket(pmPct);
      const pmVol = preMarketCandles.reduce((sum: number, c: any) => sum + c.volume, 0);
      const regVol = volumes.reduce((a: number, b: number) => a + b, 0);
      preMarketVolumeRatio = regVol > 0 ? Number((pmVol / regVol).toFixed(4)) : 0;
    }

    const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay();

    const profile = {
      stock_id: stockId,
      date,
      open_price: dayOpen,
      day_change_pct: dayChangePct,
      profile_vector: `[${profileVector.join(',')}]`,
      relative_profile_vector: `[${relativeVector.join(',')}]`,
      volume_profile: volumeProfile,
      pre_market_direction: preMarketDirection,
      pre_market_volume_ratio: preMarketVolumeRatio,
      is_earnings: false, // deferred to Phase 2
      is_opex: isOPEX(date),
      day_of_week: dayOfWeek,
      candle_count: rawProfile.length,
      // Earnings cycle fields - will be populated separately
      days_since_earnings: null,
      days_until_earnings: null,
      earnings_quarter: null,
      quarter_position: null,
    };

    const { error } = await supabase
      .from('day_profiles')
      .upsert(profile, { onConflict: 'stock_id,date' });

    if (error) throw new Error(`Failed to upsert profile for ${date}: ${error.message}`);
    stored++;
  }

  console.log(`Computed ${stored} day profiles for stock ${stockId}`);
  return stored;
}

export async function updateRelativeMoves(
  stockId: number,
  fromDate?: string,
  toDate?: string
): Promise<void> {
  let query = supabase
    .from('candles_15m')
    .select('id, date, time, pct_from_open')
    .eq('stock_id', stockId)
    .eq('session', 'regular');

  if (fromDate) query = query.gte('date', fromDate);
  if (toDate) query = query.lte('date', toDate);

  const { data: candles, error } = await query;
  if (error) throw error;
  if (!candles?.length) return;

  // Get market context for the date range
  const candleDates = [...new Set(candles.map(c => c.date))];
  const { data: marketData, error: mError } = await supabase
    .from('market_context')
    .select('date, time, spy_pct_from_open')
    .in('date', candleDates);

  if (mError) throw mError;

  const marketIndex = new Map<string, number>();
  for (const m of marketData ?? []) {
    marketIndex.set(`${m.date}_${m.time}`, m.spy_pct_from_open ?? 0);
  }

  // Batch update relative_move
  for (const candle of candles) {
    const spyPct = marketIndex.get(`${candle.date}_${candle.time}`) ?? 0;
    const relativeMov = Number(((candle.pct_from_open ?? 0) - spyPct).toFixed(4));

    await supabase
      .from('candles_15m')
      .update({ relative_move: relativeMov })
      .eq('id', candle.id);
  }

  console.log(`Updated relative moves for ${candles.length} candles`);
}
