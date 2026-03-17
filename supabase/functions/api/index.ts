import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace('/api', '');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // GET /catalog?ticker=ALAB
    if (path === '/catalog' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const { data: stock } = await supabase
        .from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json({ error: 'Stock not found' }, 404);

      const { data } = await supabase
        .from('pattern_catalog')
        .select('*')
        .eq('stock_id', stock.id)
        .eq('active', true)
        .order('win_rate', { ascending: false });

      return json(data || []);
    }

    // GET /catalog/:id — single pattern detail
    if (path.match(/^\/catalog\/\d+$/) && req.method === 'GET') {
      const id = parseInt(path.split('/')[2]);
      const { data } = await supabase
        .from('pattern_catalog').select('*').eq('id', id).single();
      if (!data) return json({ error: 'Pattern not found' }, 404);
      return json(data);
    }

    // GET /signals?ticker=ALAB — today's signals
    if (path === '/signals' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const { data: stock } = await supabase
        .from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json({ error: 'Stock not found' }, 404);

      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('pattern_signals')
        .select('*, pattern_catalog!inner(name, name_ru, phases, stop_pct, tp1_pct, tp2_pct, avg_profile)')
        .eq('stock_id', stock.id)
        .eq('date', today)
        .order('match_pct', { ascending: false });

      return json(data || []);
    }

    // GET /history?ticker=ALAB&from=2026-03-01&to=2026-03-17
    if (path === '/history' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      const { data: stock } = await supabase
        .from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json({ error: 'Stock not found' }, 404);

      let query = supabase
        .from('pattern_signals')
        .select('date, match_pct, current_phase, actual_return, was_correct, pattern_catalog!inner(name_ru)')
        .eq('stock_id', stock.id)
        .order('date', { ascending: false });

      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);

      const { data } = await query.limit(60);
      return json(data || []);
    }

    // GET /price?ticker=ALAB — latest price data
    if (path === '/price' && req.method === 'GET') {
      const ticker = url.searchParams.get('ticker') || 'ALAB';
      const { data: stock } = await supabase
        .from('stocks').select('id').eq('ticker', ticker).single();
      if (!stock) return json({ error: 'Stock not found' }, 404);

      const { data: daily } = await supabase
        .from('candles_daily')
        .select('date, open, high, low, close, volume, gap_pct')
        .eq('stock_id', stock.id)
        .order('date', { ascending: false })
        .limit(1)
        .single();

      const { data: profile } = await supabase
        .from('day_profiles')
        .select('day_change_pct, days_until_earnings, days_since_earnings, quarter_position')
        .eq('stock_id', stock.id)
        .order('date', { ascending: false })
        .limit(1)
        .single();

      return json({ daily, profile, ticker });
    }

    // GET /stocks — list active stocks
    if (path === '/stocks' && req.method === 'GET') {
      const { data } = await supabase
        .from('stocks').select('id, ticker, name, sector').eq('active', true);
      return json(data || []);
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
