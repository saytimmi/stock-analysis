import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sb } from './_supabase.js';
import { buildTradeLevels, pName, type RawPattern } from './_catalog.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ticker = (req.query.ticker as string) || 'ALAB';
  const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
  if (!stock) return res.json([]);
  const { data: candle } = await sb.from('candles_daily').select('date,gap_pct')
    .eq('stock_id', stock.id).order('date', { ascending: false }).limit(1).single();
  if (!candle) return res.json([]);
  const { data: patterns } = await sb.from('patterns').select('*').eq('stock_id', stock.id).in('lifecycle_stage', ['validated','live','monitored']);
  const signals = [];
  for (const p of (patterns ?? [] as RawPattern[])) {
    const { threshold: thr, direction: dir } = p.parameters as Record<string, number | string>;
    const gap = candle.gap_pct ?? 0; let matchPct = 0;
    if (p.type === 'gap_fill') {
      if (dir === 'down' && gap <= -(thr as number)) matchPct = Math.min(90, Math.round((Math.abs(gap)/(thr as number))*70));
      if (dir === 'up' && gap >= (thr as number)) matchPct = Math.min(90, Math.round((gap/(thr as number))*70));
    }
    if (!matchPct) continue;
    const wr = Math.round(p.win_rate * 100);
    signals.push({ id: String(p.id), ticker, pattern_id: String(p.id), pattern_name: pName(p), match_pct: matchPct, signal_type: p.type,
      narrative_ru: `Гэп ${gap>=0?'+':''}${gap.toFixed(1)}% сегодня. Паттерн <b>${pName(p)}</b> активирован — в <b>${wr}%</b> похожих дней из ${p.occurrences} гэп закрывался. Средний доход: <b>+${(p.expected_value??0).toFixed(2)}%</b>.`,
      phase_current: 'Открытие',
      phases: [{ name:'Гэп зафиксирован',done:true,active:false },{ name:'Ожидание разворота',done:false,active:true },{ name:'Закрытие гэпа',done:false,active:false }],
      trade_levels: buildTradeLevels(p),
      tags: [{ label:`WR ${wr}%`,type:wr>=65?'bullish':'neutral' },{ label:`EV +${(p.expected_value??0).toFixed(2)}%`,type:'bullish' },{ label:`${p.occurrences} случаев`,type:'info' }],
      created_at: new Date().toISOString() });
  }
  res.json(signals);
}
