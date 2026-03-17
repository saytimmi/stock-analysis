import { describe, it, expect, vi } from 'vitest';
import {
  computeBreakdown,
  confidenceGrade,
  getQuarter,
  getWeekday,
  matchTemplate,
} from '../src/catalog/builder.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

describe('getQuarter', () => {
  it('returns Q1 for January', () => {
    expect(getQuarter('2025-01-15')).toBe('Q1_2025');
  });

  it('returns Q2 for April', () => {
    expect(getQuarter('2025-04-01')).toBe('Q2_2025');
  });

  it('returns Q3 for September', () => {
    expect(getQuarter('2024-09-30')).toBe('Q3_2024');
  });

  it('returns Q4 for December', () => {
    expect(getQuarter('2025-12-25')).toBe('Q4_2025');
  });

  it('returns Q1 for March', () => {
    expect(getQuarter('2025-03-31')).toBe('Q1_2025');
  });
});

describe('getWeekday', () => {
  it('returns monday for a known Monday', () => {
    // 2025-01-06 is a Monday
    expect(getWeekday('2025-01-06')).toBe('monday');
  });

  it('returns friday for a known Friday', () => {
    // 2025-01-10 is a Friday
    expect(getWeekday('2025-01-10')).toBe('friday');
  });

  it('returns wednesday for a known Wednesday', () => {
    // 2025-01-08 is a Wednesday
    expect(getWeekday('2025-01-08')).toBe('wednesday');
  });
});

describe('confidenceGrade', () => {
  it('returns A+ for high winRate, large sample, high sharpe', () => {
    expect(confidenceGrade(0.70, 120, 1.8)).toBe('A+');
  });

  it('returns A for good stats', () => {
    expect(confidenceGrade(0.65, 100, 1.2)).toBe('A');
  });

  it('returns B+ for moderate stats', () => {
    expect(confidenceGrade(0.60, 80, 1.5)).toBe('B+');
  });

  it('returns B for average stats', () => {
    expect(confidenceGrade(0.55, 50, 1.0)).toBe('B');
  });

  it('returns C for poor stats', () => {
    expect(confidenceGrade(0.45, 20, 0.5)).toBe('C');
  });
});

describe('computeBreakdown', () => {
  const events = [
    { date: '2025-01-06', was_correct: true, profit_pct: 1.5 },
    { date: '2025-01-07', was_correct: false, profit_pct: -0.8 },
    { date: '2025-01-13', was_correct: true, profit_pct: 2.0 },
    { date: '2025-04-15', was_correct: true, profit_pct: 1.0 },
    { date: '2025-04-16', was_correct: false, profit_pct: -1.2 },
  ];

  it('groups by quarter correctly', () => {
    const result = computeBreakdown(events, (e) => getQuarter(e.date));
    expect(result['Q1_2025']).toEqual({ win: 0.67, n: 3, avg_return: 0.9 });
    expect(result['Q2_2025']).toEqual({ win: 0.5, n: 2, avg_return: -0.1 });
  });

  it('groups by weekday correctly', () => {
    const result = computeBreakdown(events, (e) => getWeekday(e.date));
    expect(result['monday']).toEqual({ win: 1, n: 2, avg_return: 1.75 });
    expect(result['tuesday']).toEqual({ win: 0.5, n: 2, avg_return: 0.1 });
    expect(result['wednesday']).toEqual({ win: 0, n: 1, avg_return: -1.2 });
  });

  it('handles empty events', () => {
    const result = computeBreakdown([], (e) => getQuarter(e.date));
    expect(result).toEqual({});
  });
});

describe('matchTemplate', () => {
  it('matches exact key', () => {
    expect(matchTemplate('gap_fill:up')).toBe('gap_fill:up');
  });

  it('matches prefix for mean_reversion:down variants', () => {
    expect(matchTemplate('mean_reversion:down:0.7')).toBe('mean_reversion:down:0.5-1.5');
  });

  it('returns null for unknown patterns', () => {
    expect(matchTemplate('unknown_pattern:foo')).toBeNull();
  });
});
