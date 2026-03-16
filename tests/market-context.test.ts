import { describe, it, expect, vi } from 'vitest';
import { buildMarketRecord } from '../src/fetcher/market-context.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

describe('Market Context', () => {
  it('should build a market record with SPY pct_from_open', () => {
    const record = buildMarketRecord({
      date: '2025-11-15',
      time: '10:00',
      spyBar: { o: 500, h: 505, l: 498, c: 503, v: 100000, t: 0, n: 0 },
      spyDayOpen: 500,
      qqqBar: { o: 400, h: 404, l: 398, c: 402, v: 80000, t: 0, n: 0 },
      qqqDayOpen: 400,
    });

    expect(record.date).toBe('2025-11-15');
    expect(record.spy_pct_from_open).toBeCloseTo(0.6, 1);
    expect(record.qqq_pct_from_open).toBeCloseTo(0.5, 1);
  });

  it('should handle missing QQQ bar', () => {
    const record = buildMarketRecord({
      date: '2025-11-15',
      time: '10:00',
      spyBar: { o: 500, h: 505, l: 498, c: 503, v: 100000, t: 0, n: 0 },
      spyDayOpen: 500,
      qqqBar: null,
      qqqDayOpen: 0,
    });

    expect(record.spy_pct_from_open).toBeCloseTo(0.6, 1);
    expect(record.qqq_pct_from_open).toBeNull();
    expect(record.qqq_open).toBeNull();
  });
});
