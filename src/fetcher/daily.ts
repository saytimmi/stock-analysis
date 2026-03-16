import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { toETDate } from '../config.js';
import type { PolygonBar } from '../polygon/types.js';

export function computeGapPct(todayOpen: number, prevClose: number): number {
  if (prevClose === 0) return 0;
  return Number(((todayOpen - prevClose) / prevClose * 100).toFixed(4));
}

export function transformDailyBars(bars: PolygonBar[], stockId: number) {
  return bars.map(bar => ({
    stock_id: stockId,
    date: toETDate(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: Math.round(bar.v),
    gap_pct: null as number | null,
  }));
}

export async function fetchAndStoreDailyCandles(
  client: PolygonClient,
  ticker: string,
  stockId: number,
  from: string,
  to: string
): Promise<number> {
  console.log(`Fetching daily candles for ${ticker} from ${from} to ${to}...`);
  const response = await client.getAggregates(ticker, 1, 'day', from, to);

  if (!response.results?.length) {
    console.log(`No daily data for ${ticker}`);
    return 0;
  }

  const records = transformDailyBars(response.results, stockId);

  // Compute gap_pct
  for (let i = 1; i < records.length; i++) {
    records[i].gap_pct = computeGapPct(records[i].open, records[i - 1].close);
  }

  const { error } = await supabase
    .from('candles_daily')
    .upsert(records, { onConflict: 'stock_id,date' });

  if (error) throw new Error(`Failed to upsert daily candles: ${error.message}`);

  console.log(`Stored ${records.length} daily candles for ${ticker}`);
  return records.length;
}
