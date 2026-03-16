import { describe, it, expect, vi } from 'vitest';
import { aggregate } from '../src/patterns/multi-timeframe.js';
import type { PatternCandle } from '../src/patterns/types.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

function makeCandle(overrides: Partial<PatternCandle> & { time: string }): PatternCandle {
  return {
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    pct_from_open: 0,
    relative_move: 0,
    ...overrides,
  };
}

// 8 mock 15-min candles representing a trading sequence
const candles15m: PatternCandle[] = [
  makeCandle({ time: '09:30', open: 100, high: 102, low: 99,  close: 101, volume: 5000, pct_from_open: 1.0,  relative_move: 0.5 }),
  makeCandle({ time: '09:45', open: 101, high: 103, low: 100, close: 102, volume: 4000, pct_from_open: 2.0,  relative_move: 1.0 }),
  makeCandle({ time: '10:00', open: 102, high: 104, low: 101, close: 103, volume: 3000, pct_from_open: 3.0,  relative_move: 1.5 }),
  makeCandle({ time: '10:15', open: 103, high: 105, low: 102, close: 104, volume: 2000, pct_from_open: 4.0,  relative_move: 2.0 }),
  makeCandle({ time: '10:30', open: 104, high: 106, low: 103, close: 105, volume: 1500, pct_from_open: 5.0,  relative_move: 2.5 }),
  makeCandle({ time: '10:45', open: 105, high: 107, low: 104, close: 106, volume: 1200, pct_from_open: 6.0,  relative_move: 3.0 }),
  makeCandle({ time: '11:00', open: 106, high: 108, low: 105, close: 107, volume: 1100, pct_from_open: 7.0,  relative_move: 3.5 }),
  makeCandle({ time: '11:15', open: 107, high: 109, low: 106, close: 108, volume: 1000, pct_from_open: 8.0,  relative_move: 4.0 }),
];

describe('aggregate — 30-minute candles (factor=2)', () => {
  it('produces half as many candles', () => {
    const result = aggregate(candles15m, 2);
    expect(result).toHaveLength(4);
  });

  it('open is the first 15-min candle open', () => {
    const result = aggregate(candles15m, 2);
    expect(result[0].open).toBe(100);
    expect(result[1].open).toBe(102);
  });

  it('high is the max of the two 15-min highs', () => {
    const result = aggregate(candles15m, 2);
    expect(result[0].high).toBe(103); // max(102, 103)
    expect(result[1].high).toBe(105); // max(104, 105)
  });

  it('low is the min of the two 15-min lows', () => {
    const result = aggregate(candles15m, 2);
    expect(result[0].low).toBe(99);  // min(99, 100)
    expect(result[1].low).toBe(101); // min(101, 102)
  });

  it('close is the last 15-min candle close', () => {
    const result = aggregate(candles15m, 2);
    expect(result[0].close).toBe(102);
    expect(result[1].close).toBe(104);
  });

  it('volume is the sum of both 15-min volumes', () => {
    const result = aggregate(candles15m, 2);
    expect(result[0].volume).toBe(9000);  // 5000 + 4000
    expect(result[1].volume).toBe(5000);  // 3000 + 2000
  });

  it('pct_from_open is the last 15-min candle pct_from_open', () => {
    const result = aggregate(candles15m, 2);
    expect(result[0].pct_from_open).toBe(2.0);
    expect(result[1].pct_from_open).toBe(4.0);
  });

  it('time is the first 15-min candle time', () => {
    const result = aggregate(candles15m, 2);
    expect(result[0].time).toBe('09:30');
    expect(result[1].time).toBe('10:00');
  });
});

describe('aggregate — 1-hour candles (factor=4)', () => {
  it('produces quarter as many candles', () => {
    const result = aggregate(candles15m, 4);
    expect(result).toHaveLength(2);
  });

  it('open is the first 15-min candle open in the group', () => {
    const result = aggregate(candles15m, 4);
    expect(result[0].open).toBe(100);
    expect(result[1].open).toBe(104);
  });

  it('high is the max of all four 15-min highs', () => {
    const result = aggregate(candles15m, 4);
    expect(result[0].high).toBe(105); // max(102,103,104,105)
    expect(result[1].high).toBe(109); // max(106,107,108,109)
  });

  it('low is the min of all four 15-min lows', () => {
    const result = aggregate(candles15m, 4);
    expect(result[0].low).toBe(99);  // min(99,100,101,102)
    expect(result[1].low).toBe(103); // min(103,104,105,106)
  });

  it('close is the last 15-min candle close', () => {
    const result = aggregate(candles15m, 4);
    expect(result[0].close).toBe(104);
    expect(result[1].close).toBe(108);
  });

  it('volume is the sum of all four 15-min volumes', () => {
    const result = aggregate(candles15m, 4);
    expect(result[0].volume).toBe(14000); // 5000+4000+3000+2000
    expect(result[1].volume).toBe(4800);  // 1500+1200+1100+1000
  });

  it('pct_from_open is the last 15-min candle pct_from_open', () => {
    const result = aggregate(candles15m, 4);
    expect(result[0].pct_from_open).toBe(4.0);
    expect(result[1].pct_from_open).toBe(8.0);
  });
});

describe('aggregate — edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(aggregate([], 2)).toEqual([]);
  });

  it('handles factor=1 (no aggregation)', () => {
    const result = aggregate(candles15m, 1);
    expect(result).toHaveLength(candles15m.length);
    expect(result[0].open).toBe(candles15m[0].open);
  });

  it('handles non-divisible lengths by including partial last group', () => {
    const three = candles15m.slice(0, 3);
    const result = aggregate(three, 2);
    // groups: [0,1], [2] → 2 groups
    expect(result).toHaveLength(2);
    // last group has only one candle
    expect(result[1].open).toBe(three[2].open);
    expect(result[1].close).toBe(three[2].close);
    expect(result[1].volume).toBe(three[2].volume);
  });

  it('throws for factor < 1', () => {
    expect(() => aggregate(candles15m, 0)).toThrow();
  });
});
