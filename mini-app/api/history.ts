import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sb } from './_supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ticker = (req.query.ticker as string) || 'ALAB';
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
  if (!stock) return res.json([]);
  const { data: patterns } = await sb.from('patterns').select('id, type').eq('stock_id', stock.id);
  if (!patterns?.length) return res.json([]);
  let q = sb.from('pattern_events').select('pattern_id,date,was_correct,profit_pct,trigger_value')
    .in('pattern_id', patterns.map((p: { id: number }) => p.id)).order('date', { ascending: false }).limit(90);
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);
  const { data: events } = await q;
  const dates = [...new Set((events ?? []).map((e: { date: string }) => e.date))];
  const { data: candles } = dates.length ? await sb.from('candles_daily').select('date,open,high,low,close').in('date', dates) : { data: [] };
  const cMap: Record<string, { open:number;high:number;low:number;close:number }> = {};
  for (const c of (candles ?? [])) cMap[c.date] = c;
  const pType: Record<number, string> = {};
  for (const p of (patterns ?? [])) pType[p.id] = p.type;
  const tNames: Record<string, string> = { gap_fill:'Закр. гэпа', mean_reversion:'Возврат', momentum_continuation:'Импульс' };
  res.json((events ?? []).map((e: { pattern_id: number; date: string; was_correct: boolean; profit_pct: number }) => {
    const c = cMap[e.date];
    return { date: e.date, day_label: new Date(e.date).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}),
      result_pct: e.profit_pct??0, ohlc: c?{o:c.open,h:c.high,l:c.low,c:c.close}:{o:0,h:0,l:0,c:0},
      pattern_name: tNames[pType[e.pattern_id]]??'—', prediction: pType[e.pattern_id]?.includes('gap')?'Закрытие гэпа':'Продолжение', correct: e.was_correct };
  }));
}
