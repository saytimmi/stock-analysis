import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { toETDate, toETTime } from '../config.js';
import { classifySession } from './intraday.js';
import type { PolygonBar } from '../polygon/types.js';

interface MarketRecordInput {
  date: string;
  time: string;
  spyBar: PolygonBar;
  spyDayOpen: number;
  qqqBar: PolygonBar | null;
  qqqDayOpen: number;
}

export function buildMarketRecord(input: MarketRecordInput) {
  const { date, time, spyBar, spyDayOpen, qqqBar, qqqDayOpen } = input;
  return {
    date,
    time,
    spy_open: spyBar.o,
    spy_close: spyBar.c,
    spy_pct_from_open: spyDayOpen > 0
      ? Number(((spyBar.c - spyDayOpen) / spyDayOpen * 100).toFixed(4))
      : 0,
    spy_volume: Math.round(spyBar.v),
    qqq_open: qqqBar?.o ?? null,
    qqq_close: qqqBar?.c ?? null,
    qqq_pct_from_open: qqqBar && qqqDayOpen > 0
      ? Number(((qqqBar.c - qqqDayOpen) / qqqDayOpen * 100).toFixed(4))
      : null,
    qqq_volume: qqqBar ? Math.round(qqqBar.v) : null,
  };
}

function findDayOpen(bars: PolygonBar[]): number {
  const regular = bars.filter(b => classifySession(toETTime(b.t)) === 'regular');
  return regular.length > 0 ? regular[0].o : bars[0]?.o ?? 0;
}

export async function fetchAndStoreMarketContext(
  client: PolygonClient,
  from: string,
  to: string
): Promise<number> {
  console.log(`Fetching market context (SPY/QQQ) from ${from} to ${to}...`);

  // Fetch sequentially to respect rate limiter
  const spyResponse = await client.getAggregates('SPY', 15, 'minute', from, to);
  const qqqResponse = await client.getAggregates('QQQ', 15, 'minute', from, to);

  // Group SPY by date
  const spyByDate = new Map<string, PolygonBar[]>();
  for (const bar of spyResponse.results ?? []) {
    const date = toETDate(bar.t);
    if (!spyByDate.has(date)) spyByDate.set(date, []);
    spyByDate.get(date)!.push(bar);
  }

  // Index QQQ bars by date+time
  const qqqIndex = new Map<string, PolygonBar>();
  const qqqByDate = new Map<string, PolygonBar[]>();
  for (const bar of qqqResponse.results ?? []) {
    const date = toETDate(bar.t);
    const time = toETTime(bar.t);
    qqqIndex.set(`${date}_${time}`, bar);
    if (!qqqByDate.has(date)) qqqByDate.set(date, []);
    qqqByDate.get(date)!.push(bar);
  }

  const records: ReturnType<typeof buildMarketRecord>[] = [];

  for (const [date, spyBars] of spyByDate) {
    const spyDayOpen = findDayOpen(spyBars);
    const qqqDayBars = qqqByDate.get(date) ?? [];
    const qqqDayOpen = findDayOpen(qqqDayBars);

    for (const bar of spyBars) {
      const time = toETTime(bar.t);
      const qqqBar = qqqIndex.get(`${date}_${time}`) ?? null;

      records.push(buildMarketRecord({
        date, time, spyBar: bar, spyDayOpen, qqqBar, qqqDayOpen,
      }));
    }
  }

  // Upsert in batches of 500 to avoid payload size limits
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await supabase
      .from('market_context')
      .upsert(batch, { onConflict: 'date,time' });

    if (error) throw new Error(`Failed to upsert market context batch ${i}: ${error.message}`);
  }

  console.log(`Stored ${records.length} market context records`);
  return records.length;
}
