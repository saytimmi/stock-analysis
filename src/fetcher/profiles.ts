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

/**
 * Paginated select — Supabase returns max 1000 rows per query.
 * This fetches all rows by paginating through results.
 */
async function selectAll(
  table: string,
  columns: string,
  filters: Record<string, any>,
  orderBy?: string
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let allRows: any[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(table).select(columns).range(offset, offset + PAGE_SIZE - 1);

    for (const [key, value] of Object.entries(filters)) {
      if (key.startsWith('gte:')) query = query.gte(key.slice(4), value);
      else if (key.startsWith('lte:')) query = query.lte(key.slice(4), value);
      else query = query.eq(key, value);
    }

    if (orderBy) query = query.order(orderBy);

    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;

    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

export async function computeAndStoreProfiles(
  stockId: number,
  fromDate?: string,
  toDate?: string
): Promise<number> {
  // Get all dates that have regular candles (paginated)
  const filters: Record<string, any> = {
    stock_id: stockId,
    session: 'regular',
  };
  if (fromDate) filters['gte:date'] = fromDate;
  if (toDate) filters['lte:date'] = toDate;

  const dateRows = await selectAll('candles_15m', 'date', filters, 'date');
  const uniqueDates = [...new Set(dateRows.map(r => r.date))];
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
      is_earnings: false,
      is_opex: isOPEX(date),
      day_of_week: dayOfWeek,
      candle_count: rawProfile.length,
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
  // Paginated fetch of all candles
  const filters: Record<string, any> = {
    stock_id: stockId,
    session: 'regular',
  };
  if (fromDate) filters['gte:date'] = fromDate;
  if (toDate) filters['lte:date'] = toDate;

  const candles = await selectAll('candles_15m', 'id, date, time, pct_from_open', filters);
  if (!candles.length) return;

  // Get all unique dates
  const candleDates = [...new Set(candles.map(c => c.date))];

  // Fetch market context in batches of dates (Supabase .in() has limits)
  const marketIndex = new Map<string, number>();
  for (let i = 0; i < candleDates.length; i += 100) {
    const dateBatch = candleDates.slice(i, i + 100);
    const marketData = await selectAll('market_context', 'date, time, spy_pct_from_open', {});
    // Actually fetch with .in() for this batch
    const { data, error } = await supabase
      .from('market_context')
      .select('date, time, spy_pct_from_open')
      .in('date', dateBatch)
      .range(0, 9999);

    if (error) throw error;
    for (const m of data ?? []) {
      marketIndex.set(`${m.date}_${m.time}`, m.spy_pct_from_open ?? 0);
    }
  }

  // Batch update relative_move
  let updated = 0;
  for (const candle of candles) {
    const spyPct = marketIndex.get(`${candle.date}_${candle.time}`) ?? 0;
    const relativeMov = Number(((candle.pct_from_open ?? 0) - spyPct).toFixed(4));

    await supabase
      .from('candles_15m')
      .update({ relative_move: relativeMov })
      .eq('id', candle.id);

    updated++;
    if (updated % 1000 === 0) console.log(`  Updated ${updated}/${candles.length} relative moves...`);
  }

  console.log(`Updated relative moves for ${candles.length} candles`);
}
