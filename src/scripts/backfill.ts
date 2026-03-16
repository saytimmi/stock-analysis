import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { fetchAndStoreDailyCandles } from '../fetcher/daily.js';
import { fetchAndStoreIntradayCandles } from '../fetcher/intraday.js';
import { fetchAndStoreMarketContext } from '../fetcher/market-context.js';
import { computeAndStoreProfiles, updateRelativeMoves } from '../fetcher/profiles.js';

async function backfill() {
  const client = new PolygonClient();

  // 2 years back for robust backtesting
  const to = new Date().toISOString().split('T')[0];
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = fromDate.toISOString().split('T')[0];

  console.log(`\n=== Backfill: ${from} to ${to} ===\n`);

  // 1. Market context first (needed for relative moves)
  console.log('--- Step 1: Market Context (SPY/QQQ) ---');
  await fetchAndStoreMarketContext(client, from, to);

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

    console.log('Fetching daily candles...');
    await fetchAndStoreDailyCandles(client, stock.ticker, stock.id, from, to);

    console.log('Fetching 15-min candles...');
    await fetchAndStoreIntradayCandles(client, stock.ticker, stock.id, from, to);

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
