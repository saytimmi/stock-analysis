import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildCatalog } from './_catalog.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ticker = (req.query.ticker as string) || 'ALAB';
  try {
    const data = await buildCatalog(ticker);
    if (!data) return res.status(404).json({ error: 'Stock not found' });
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
}
