import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  supabase: { from: vi.fn() },
}));

import { transformDailyBars, computeGapPct } from '../src/fetcher/daily.js';

describe('Daily Fetcher', () => {
  it('should transform Polygon bars to daily candle records', () => {
    // 2025-11-15 12:00 UTC = 2025-11-15 07:00 ET
    const bars = [
      { o: 100, h: 110, l: 95, c: 105, v: 50000, t: 1763208000000, n: 100 },
    ];
    const result = transformDailyBars(bars, 1);
    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(100);
    expect(result[0].close).toBe(105);
    expect(result[0].stock_id).toBe(1);
    expect(result[0].date).toBe('2025-11-15');
  });

  it('should compute gap percentage correctly', () => {
    expect(computeGapPct(102, 100)).toBeCloseTo(2.0, 1);
    expect(computeGapPct(98, 100)).toBeCloseTo(-2.0, 1);
    expect(computeGapPct(100, 100)).toBe(0);
  });

  it('should return 0 gap when previous close is 0', () => {
    expect(computeGapPct(100, 0)).toBe(0);
  });

  it('should handle empty bars array', () => {
    const result = transformDailyBars([], 1);
    expect(result).toHaveLength(0);
  });
});
