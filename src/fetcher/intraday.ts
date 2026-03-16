import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { toETDate, toETTime } from '../config.js';
import type { PolygonBar } from '../polygon/types.js';

export function classifySession(time: string): 'pre_market' | 'regular' | 'after_hours' {
  const [h, m] = time.split(':').map(Number);
  const minutes = h * 60 + m;

  if (minutes < 570) return 'pre_market';   // before 9:30
  if (minutes < 960) return 'regular';       // 9:30 - 16:00
  return 'after_hours';                       // 16:00+
}

export function computePctFromOpen(close: number, dayOpen: number): number {
  if (dayOpen === 0) return 0;
  return Number(((close - dayOpen) / dayOpen * 100).toFixed(4));
}

export async function fetchAndStoreIntradayCandles(
  client: PolygonClient,
  ticker: string,
  stockId: number,
  from: string,
  to: string
): Promise<number> {
  console.log(`Fetching 15-min candles for ${ticker} from ${from} to ${to}...`);
  const response = await client.getAggregates(ticker, 15, 'minute', from, to);

  if (!response.results?.length) {
    console.log(`No intraday data for ${ticker}`);
    return 0;
  }

  // Group bars by ET date
  const barsByDate = new Map<string, PolygonBar[]>();
  for (const bar of response.results) {
    const date = toETDate(bar.t);
    if (!barsByDate.has(date)) barsByDate.set(date, []);
    barsByDate.get(date)!.push(bar);
  }

  let totalStored = 0;

  for (const [date, bars] of barsByDate) {
    // Find regular session open (first bar at or after 9:30 ET)
    const regularBars = bars.filter(b => classifySession(toETTime(b.t)) === 'regular');
    const dayOpenPrice = regularBars.length > 0 ? regularBars[0].o : bars[0].o;

    const records = bars.map(bar => {
      const time = toETTime(bar.t);
      return {
        stock_id: stockId,
        date,
        time,
        session: classifySession(time),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        pct_from_open: computePctFromOpen(bar.c, dayOpenPrice),
        relative_move: null as number | null,
      };
    });

    const { error } = await supabase
      .from('candles_15m')
      .upsert(records, { onConflict: 'stock_id,date,time' });

    if (error) throw new Error(`Failed to upsert 15m candles for ${date}: ${error.message}`);
    totalStored += records.length;
  }

  console.log(`Stored ${totalStored} intraday candles for ${ticker}`);
  return totalStored;
}
