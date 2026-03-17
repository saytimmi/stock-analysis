import { supabase } from '../db/client.js';
import { buildCatalog, storeCatalog } from '../catalog/builder.js';

async function main() {
  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  if (!stocks || stocks.length === 0) {
    console.log('No active stocks found');
    return;
  }

  for (const stock of stocks) {
    console.log(`Building catalog for ${stock.ticker}...`);
    const entries = await buildCatalog(stock.id);
    console.log(`  Found ${entries.length} patterns`);

    await storeCatalog(entries);
    console.log(`  Stored to pattern_catalog`);

    for (const e of entries) {
      console.log(`  - ${e.name_ru}: ${(e.win_rate * 100).toFixed(0)}% win, ${e.sample_size} cases, grade ${e.confidence_grade}`);
    }
  }

  console.log('Done!');
}

main().catch(console.error);
