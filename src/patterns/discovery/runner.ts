import { supabase } from '../../db/client.js';
import { DayData, PatternCandle } from '../types.js';
import { BacktestResult, backtestPattern } from '../backtest.js';
import { storePatterns } from '../lifecycle.js';
import { discoverMeanReversion } from './mean-reversion.js';
import { discoverMomentum } from './momentum.js';
import { discoverGapPatterns } from './gap.js';
import { discoverTimeOfDay } from './time-of-day.js';
import { discoverVolumePatterns } from './volume.js';

/**
 * Paginated fetch — Supabase returns max 1000 rows per query.
 */
async function fetchAll<T = any>(
  table: string,
  columns: string,
  filters: Array<{ col: string; op: string; val: any }>,
  orderBy?: string,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allRows: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE_SIZE - 1);

    for (const f of filters) {
      switch (f.op) {
        case 'eq':  query = query.eq(f.col, f.val); break;
        case 'gte': query = query.gte(f.col, f.val); break;
        case 'lte': query = query.lte(f.col, f.val); break;
      }
    }

    if (orderBy) query = query.order(orderBy);

    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;

    allRows = allRows.concat(data as T[]);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

/**
 * Load candle + day data for a stock from Supabase.
 * Groups 15-min regular session candles by date, enriches with gap_pct from daily candles.
 */
export async function loadDayData(stockId: number): Promise<DayData[]> {
  // Load regular session 15-min candles
  const candles15m = await fetchAll<{
    date: string;
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    pct_from_open: number;
    relative_move: number;
  }>(
    'candles_15m',
    'date,time,open,high,low,close,volume,pct_from_open,relative_move',
    [
      { col: 'stock_id', op: 'eq', val: stockId },
      { col: 'session', op: 'eq', val: 'regular' },
    ],
    'date',
  );

  if (candles15m.length === 0) return [];

  // Load daily candles for gap_pct calculation
  const dailyCandles = await fetchAll<{
    date: string;
    open: number;
    close: number;
    prev_close?: number;
  }>(
    'candles_daily',
    'date,open,close',
    [{ col: 'stock_id', op: 'eq', val: stockId }],
    'date',
  );

  // Build daily map: date → { open, prev_close }
  const dailyMap = new Map<string, { open: number; close: number }>();
  for (const d of dailyCandles) {
    dailyMap.set(d.date, { open: d.open, close: d.close });
  }

  // Compute gap_pct from sorted daily candles
  const sortedDaily = [...dailyCandles].sort((a, b) => a.date.localeCompare(b.date));
  const gapMap = new Map<string, number | null>();
  for (let i = 1; i < sortedDaily.length; i++) {
    const today = sortedDaily[i];
    const yesterday = sortedDaily[i - 1];
    if (yesterday.close && today.open) {
      gapMap.set(today.date, ((today.open - yesterday.close) / yesterday.close) * 100);
    } else {
      gapMap.set(today.date, null);
    }
  }

  // Group 15m candles by date
  const candlesByDate = new Map<string, typeof candles15m>();
  for (const candle of candles15m) {
    if (!candlesByDate.has(candle.date)) candlesByDate.set(candle.date, []);
    candlesByDate.get(candle.date)!.push(candle);
  }

  const days: DayData[] = [];

  for (const [date, rawCandles] of candlesByDate) {
    // Sort candles by time
    rawCandles.sort((a, b) => a.time.localeCompare(b.time));

    const patternCandles: PatternCandle[] = rawCandles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      pct_from_open: c.pct_from_open,
      relative_move: c.relative_move,
    }));

    // day_change_pct: from first open to last close in regular session
    const firstOpen = rawCandles[0].open;
    const lastClose = rawCandles[rawCandles.length - 1].close;
    const day_change_pct = firstOpen !== 0
      ? ((lastClose - firstOpen) / firstOpen) * 100
      : 0;

    // day_of_week from date string
    const dateObj = new Date(date + 'T12:00:00Z');
    const day_of_week = dateObj.getUTCDay(); // 0=Sun, 1=Mon, ... 5=Fri

    days.push({
      date,
      candles: patternCandles,
      day_change_pct,
      gap_pct: gapMap.get(date) ?? null,
      day_of_week,
    });
  }

  // Sort days chronologically
  days.sort((a, b) => a.date.localeCompare(b.date));

  return days;
}

const DISCOVERY_FUNCTIONS = [
  discoverMeanReversion,
  discoverMomentum,
  discoverGapPatterns,
  discoverTimeOfDay,
  discoverVolumePatterns,
] as const;

/**
 * Run all discovery modules, backtest, store passing patterns.
 */
export async function runDiscovery(stockId: number): Promise<BacktestResult[]> {
  const days = await loadDayData(stockId);

  if (days.length === 0) {
    console.log(`  No data found for stock ${stockId}`);
    return [];
  }

  console.log(`  Loaded ${days.length} days of data`);

  const allResults: BacktestResult[] = [];

  for (const fn of DISCOVERY_FUNCTIONS) {
    const results = backtestPattern(days, fn);
    allResults.push(...results);
  }

  const passed = allResults.filter((r) => r.passed);
  console.log(`  ${allResults.length} patterns discovered, ${passed.length} passed backtesting`);

  if (passed.length > 0) {
    const stored = await storePatterns(stockId, allResults);
    console.log(`  Stored ${stored} patterns to DB`);
  }

  return allResults;
}
