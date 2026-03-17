import { supabase } from '../db/client.js';
import { config, toETDate } from '../config.js';
import { analyzeCurrentSession } from '../scoring/realtime.js';
import type { CatalogEntry, PatternPhase } from './types.js';

// ─── Interfaces ────────────────────────────────────────────────

export interface LiveSignal {
  catalog_id: number;
  pattern_name: string;
  pattern_name_ru: string;
  match_pct: number;
  current_phase: string;
  phase_progress: Array<{ name: string; status: 'done' | 'active' | 'pending' }>;
  open_price: number;
  entry_price: number;
  stop_price: number;
  tp1_price: number;
  tp2_price: number;
  current_price: number;
  market_context: { spy_pct: number; qqq_pct: number; soxx_pct?: number; vix_pct?: number };
  tags: string[];
  analysis_text: string;
}

export interface TradeLevels {
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
}

// ─── Pure functions ────────────────────────────────────────────

/**
 * Compute absolute trade levels from open price and percentage offsets.
 * stopPct is negative for longs, positive for shorts.
 */
export function computeTradeLevels(
  openPrice: number,
  stopPct: number,
  tp1Pct: number,
  tp2Pct: number,
): TradeLevels {
  return {
    entry: Math.round(openPrice * 100) / 100,
    stop: Math.round(openPrice * (1 + stopPct / 100) * 100) / 100,
    tp1: Math.round(openPrice * (1 + tp1Pct / 100) * 100) / 100,
    tp2: Math.round(openPrice * (1 + tp2Pct / 100) * 100) / 100,
  };
}

/**
 * Determine which phase of the pattern we're in based on minutes since market open (9:30 ET).
 * Phase boundaries: 60, 150, 240, 390 minutes.
 */
export function determinePhase(
  phases: PatternPhase[],
  minutesSinceOpen: number,
): { current: string; progress: Array<{ name: string; status: 'done' | 'active' | 'pending' }> } {
  const boundaries = [60, 150, 240, 390];

  // Find the active phase index based on elapsed minutes
  let activeIndex = 0;
  for (let i = 0; i < boundaries.length; i++) {
    if (minutesSinceOpen >= boundaries[i]) {
      activeIndex = i + 1;
    }
  }
  // Clamp to the last available phase
  if (activeIndex >= phases.length) {
    activeIndex = phases.length - 1;
  }

  const progress = phases.map((phase, i) => ({
    name: phase.name,
    status: (i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending') as 'done' | 'active' | 'pending',
  }));

  return {
    current: phases[activeIndex]?.name ?? 'Unknown',
    progress,
  };
}

/**
 * Generate descriptive tags based on market conditions.
 */
export function generateTags(
  spyPct: number,
  volumeRatio: number,
  earningsPhase: string,
): string[] {
  const tags: string[] = [];

  // Direction tags
  if (spyPct > 0.3) {
    tags.push('bullish');
  } else if (spyPct < -0.3) {
    tags.push('bearish');
  } else {
    tags.push('neutral');
  }

  // Volume tags
  if (volumeRatio >= 1.5) {
    tags.push(`vol_${volumeRatio.toFixed(1)}x`);
  }

  // Earnings phase tags
  if (earningsPhase) {
    tags.push(earningsPhase);
  }

  return tags;
}

// ─── Main generator ────────────────────────────────────────────

/**
 * Generate live signals for a given stock.
 */
export async function generateSignals(
  stockId: number,
  ticker: string,
): Promise<LiveSignal[]> {
  // 1. Fetch catalog entries for this stock
  const { data: catalogRows, error: catErr } = await supabase
    .from('pattern_catalog')
    .select('*')
    .eq('stock_id', stockId);

  if (catErr || !catalogRows || catalogRows.length === 0) {
    return [];
  }

  // 2. Get current session analysis
  const session = await analyzeCurrentSession(stockId, ticker);

  // 3. Get today's open price from candles_daily
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: config.market.timezone,
  });

  const { data: dailyRow } = await supabase
    .from('candles_daily')
    .select('open, close')
    .eq('stock_id', stockId)
    .eq('date', today)
    .limit(1)
    .single();

  const openPrice = dailyRow?.open ?? 0;
  const currentPrice = dailyRow?.close ?? openPrice;

  if (openPrice === 0) return [];

  // 4. Compute minutes since market open (9:30 ET)
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: config.market.timezone }));
  const marketOpen = new Date(etNow);
  marketOpen.setHours(9, 30, 0, 0);
  const minutesSinceOpen = Math.max(0, (etNow.getTime() - marketOpen.getTime()) / 60_000);

  // 5. Get market context (SPY/QQQ change)
  const { data: spyRow } = await supabase
    .from('candles_daily')
    .select('open, close')
    .eq('ticker', 'SPY')
    .eq('date', today)
    .limit(1)
    .single();

  const { data: qqqRow } = await supabase
    .from('candles_daily')
    .select('open, close')
    .eq('ticker', 'QQQ')
    .eq('date', today)
    .limit(1)
    .single();

  const spyPct = spyRow?.open ? ((spyRow.close - spyRow.open) / spyRow.open) * 100 : 0;
  const qqqPct = qqqRow?.open ? ((qqqRow.close - qqqRow.open) / qqqRow.open) * 100 : 0;

  const marketContext = { spy_pct: spyPct, qqq_pct: qqqPct };

  // 6. For each catalog entry, build a signal
  const signals: LiveSignal[] = [];

  for (const row of catalogRows) {
    const entry = row as CatalogEntry & { id: number };
    const phases = (entry.phases ?? []) as PatternPhase[];

    // Compute match score from session analogs
    const { consensus } = session;
    const avgMove = consensus.avg_remaining_move ?? 0;
    // Simple match heuristic: based on analog agreement + win_rate alignment
    const bullishAlignment = consensus.bullish_count / Math.max(1, consensus.bullish_count + consensus.bearish_count);
    const patternDirection = entry.avg_return >= 0 ? 1 : 0;
    const alignmentScore = patternDirection === 1 ? bullishAlignment : 1 - bullishAlignment;
    const matchPct = Math.round(
      Math.min(100, Math.max(0, alignmentScore * 80 + entry.win_rate * 20)) * 100,
    ) / 100;

    // Filter weak matches
    if (matchPct < 40) continue;

    // Determine current phase
    const { current, progress } = determinePhase(phases, minutesSinceOpen);

    // Compute trade levels
    const levels = computeTradeLevels(openPrice, entry.stop_pct, entry.tp1_pct, entry.tp2_pct);

    // Determine earnings phase for tags
    const quarter = getQuarterLabel(today);
    const volumeRatio = session.candles_so_far > 0 ? 1.0 : 0;

    const tags = generateTags(spyPct, volumeRatio, quarter);

    // Build analysis text
    const direction = entry.avg_return >= 0 ? 'bullish' : 'bearish';
    const analysisText =
      `${entry.name}: ${direction} pattern with ${entry.win_rate}% win rate. ` +
      `Currently in "${current}" phase. ` +
      `Analogs suggest ${avgMove >= 0 ? '+' : ''}${avgMove.toFixed(1)}% remaining move.`;

    signals.push({
      catalog_id: entry.id ?? entry.pattern_id ?? 0,
      pattern_name: entry.name,
      pattern_name_ru: entry.name_ru,
      match_pct: matchPct,
      current_phase: current,
      phase_progress: progress,
      open_price: openPrice,
      entry_price: levels.entry,
      stop_price: levels.stop,
      tp1_price: levels.tp1,
      tp2_price: levels.tp2,
      current_price: currentPrice,
      market_context: marketContext,
      tags,
      analysis_text: analysisText,
    });
  }

  // Sort by match_pct descending
  signals.sort((a, b) => b.match_pct - a.match_pct);

  return signals;
}

// ─── Helpers ───────────────────────────────────────────────────

function getQuarterLabel(dateStr: string): string {
  const month = parseInt(dateStr.split('-')[1], 10);
  const monthInQuarter = ((month - 1) % 3) + 1;
  if (monthInQuarter === 1) return 'early-quarter';
  if (monthInQuarter === 2) return 'mid-quarter';
  return 'late-quarter';
}
