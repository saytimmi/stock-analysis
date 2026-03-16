import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { fetchAndStoreDailyCandles } from '../fetcher/daily.js';
import { fetchAndStoreIntradayCandles } from '../fetcher/intraday.js';
import { fetchAndStoreMarketContext } from '../fetcher/market-context.js';
import { computeAndStoreProfiles, updateRelativeMoves } from '../fetcher/profiles.js';

/**
 * Generate monthly chunks between two dates to avoid Polygon pagination limits.
 * 15-min candles for 2 years exceed 50K limit, so we fetch month by month.
 */
function getMonthlyChunks(from: string, to: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');

  let cursor = new Date(start);
  while (cursor < end) {
    const chunkStart = cursor.toISOString().split('T')[0];
    cursor.setMonth(cursor.getMonth() + 1);
    const chunkEnd = cursor > end
      ? to
      : cursor.toISOString().split('T')[0];
    chunks.push({ from: chunkStart, to: chunkEnd });
  }

  return chunks;
}

async function backfill() {
  const client = new PolygonClient();

  // 2 years back for robust backtesting
  const to = new Date().toISOString().split('T')[0];
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = fromDate.toISOString().split('T')[0];

  const chunks = getMonthlyChunks(from, to);
  console.log(`\n=== Backfill: ${from} to ${to} (${chunks.length} monthly chunks) ===\n`);

  // 1. Market context first (needed for relative moves) — month by month
  console.log('--- Step 1: Market Context (SPY/QQQ) ---');
  for (const chunk of chunks) {
    console.log(`  ${chunk.from} → ${chunk.to}`);
    await fetchAndStoreMarketContext(client, chunk.from, chunk.to);
  }

  // 2. All active stocks
  const { data: stocks, error } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  if (error) throw error;
  if (!stocks?.length) {
    console.log('No active stocks found.');
    return;
  }

  for (const stock of stocks) {
    console.log(`\n--- Processing ${stock.ticker} ---`);

    // Daily candles — single request is fine (< 50K rows)
    console.log('Fetching daily candles...');
    await fetchAndStoreDailyCandles(client, stock.ticker, stock.id, from, to);

    // 15-min candles — month by month to avoid pagination
    console.log('Fetching 15-min candles...');
    for (const chunk of chunks) {
      console.log(`  ${chunk.from} → ${chunk.to}`);
      await fetchAndStoreIntradayCandles(client, stock.ticker, stock.id, chunk.from, chunk.to);
    }

    console.log('Computing relative moves...');
    await updateRelativeMoves(stock.id);

    console.log('Computing day profiles...');
    await computeAndStoreProfiles(stock.id);
  }

  console.log('\n=== Backfill complete ===');
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
