import { supabase } from '../db/client.js';
import { updateRelativeMoves, computeAndStoreProfiles } from '../fetcher/profiles.js';

async function recompute() {
  const { data: stocks, error } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  if (error) throw error;

  for (const stock of stocks ?? []) {
    console.log(`\n--- Recomputing for ${stock.ticker} ---`);

    console.log('Updating relative moves...');
    await updateRelativeMoves(stock.id);

    console.log('Computing day profiles...');
    await computeAndStoreProfiles(stock.id);
  }

  console.log('\n=== Recompute complete ===');
}

recompute().catch(err => {
  console.error('Recompute failed:', err);
  process.exit(1);
});
