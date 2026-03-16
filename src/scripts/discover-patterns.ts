import { supabase } from '../db/client.js';
import { runDiscovery } from '../patterns/discovery/runner.js';

async function main() {
  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  for (const stock of stocks ?? []) {
    console.log(`\nDiscovering patterns for ${stock.ticker}...`);
    const results = await runDiscovery(stock.id);
    const passed = results.filter(r => r.passed);
    console.log(`Found ${results.length} patterns, ${passed.length} passed backtesting`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
