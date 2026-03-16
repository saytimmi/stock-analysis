import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { fetchAndStoreDailyCandles } from '../fetcher/daily.js';
import { fetchAndStoreIntradayCandles } from '../fetcher/intraday.js';
import { fetchAndStoreMarketContext } from '../fetcher/market-context.js';
import { computeAndStoreProfiles, updateRelativeMoves } from '../fetcher/profiles.js';

async function dailyUpdate() {
  const client = new PolygonClient();

  // 5-day lookback to handle weekends + holidays
  const to = new Date().toISOString().split('T')[0];
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 5);
  const from = fromDate.toISOString().split('T')[0];

  console.log(`\n=== Daily Update: ${from} to ${to} ===\n`);

  // 1. Market context
  await fetchAndStoreMarketContext(client, from, to);

  // 2. All active stocks
  const { data: stocks, error } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  if (error) throw error;

  for (const stock of stocks ?? []) {
    console.log(`\nUpdating ${stock.ticker}...`);
    await fetchAndStoreDailyCandles(client, stock.ticker, stock.id, from, to);
    await fetchAndStoreIntradayCandles(client, stock.ticker, stock.id, from, to);
    await updateRelativeMoves(stock.id, from, to);
    await computeAndStoreProfiles(stock.id, from, to);
  }

  console.log('\n=== Daily update complete ===');
}

dailyUpdate().catch(err => {
  console.error('Daily update failed:', err);
  process.exit(1);
});
