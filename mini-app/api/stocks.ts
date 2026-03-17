import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sb } from './_supabase.js';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { data } = await sb.from('stocks').select('id, ticker, name, sector').eq('active', true);
  res.json(data || []);
}
