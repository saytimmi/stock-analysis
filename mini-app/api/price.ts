import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sb } from './_supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ticker = (req.query.ticker as string) || 'ALAB';
  const { data: stock } = await sb.from('stocks').select('id').eq('ticker', ticker).single();
  if (!stock) return res.status(404).json({ error: 'Not found' });
  const { data: rows } = await sb.from('candles_daily').select('date,open,high,low,close,volume,gap_pct')
    .eq('stock_id', stock.id).order('date', { ascending: false }).limit(2);
  if (!rows?.length) return res.status(404).json({ error: 'No data' });
  const today = rows[0]; const prev = rows[1];
  const change = today.close - (prev?.close ?? today.open);
  const change_pct = prev?.close ? ((today.close - prev.close) / prev.close) * 100 : 0;
  const now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...o }).format(now);
  const etH = parseInt(fmt({ hour: 'numeric', hour12: false }));
  const etM = parseInt(fmt({ minute: 'numeric' }));
  const etDay = fmt({ weekday: 'short' });
  const isOpen = !['Sat','Sun'].includes(etDay) && (etH*60+etM) >= 570 && (etH*60+etM) < 960;
  res.json({ ticker, price: today.close, change, change_pct, open: today.open, high: today.high, low: today.low, gap_pct: today.gap_pct ?? 0, market_status: isOpen ? 'open' : 'closed', date: today.date });
}
