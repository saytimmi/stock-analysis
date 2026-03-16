import dotenv from 'dotenv';
dotenv.config();

export const config = {
  polygon: {
    apiKey: process.env.POLYGON_API_KEY!,
    baseUrl: 'https://api.polygon.io',
    maxRequestsPerSecond: 5,
    maxRetries: 3,
  },
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_KEY!,
  },
  market: {
    regularOpen: '09:30',
    regularClose: '16:00',
    preMarketOpen: '04:00',
    timezone: 'America/New_York',
    candleInterval: 15,
    candlesPerDay: 26,
  },
  defaultStocks: ['ALAB'],
  marketIndexes: ['SPY', 'QQQ'],
} as const;

export function toETDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function toETTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isOPEX(dateStr: string): boolean {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  return d.getUTCDay() === 5 && Math.ceil(d.getUTCDate() / 7) === 3;
}
