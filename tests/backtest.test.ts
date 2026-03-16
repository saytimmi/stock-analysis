import { describe, it, expect } from 'vitest';
import { binomialPValue, backtestPattern } from '../src/patterns/backtest.js';
import { DayData, DiscoveredPattern, PatternCandle, PatternEvent } from '../src/patterns/types.js';

function makeCandle(time: string, close: number): PatternCandle {
  return { time, open: 100, high: close + 1, low: close - 1, close, volume: 1000, pct_from_open: 0, relative_move: 0 };
}

function makeDay(date: string): DayData {
  return { date, candles: [makeCandle('09:30', 100), makeCandle('09:45', 101)], day_change_pct: 1, gap_pct: 0, day_of_week: 1 };
}

function makeDays(n: number): DayData[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(2023, 0, i + 1);
    return makeDay(d.toISOString().slice(0, 10));
  });
}

function makeEvent(date: string, was_correct: boolean, profit_pct: number): PatternEvent {
  return {
    date,
    trigger_candle: 1,
    trigger_value: 1,
    predicted_direction: 'up',
    predicted_magnitude: 1,
    actual_outcome: was_correct ? 1 : -1,
    was_correct,
    profit_pct,
  };
}

describe('binomialPValue', () => {
  it('50/100 wins → p ≈ 0.5', () => {
    const p = binomialPValue(50, 100);
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(0.6);
  });

  it('70/100 wins → p < 0.05', () => {
    const p = binomialPValue(70, 100);
    expect(p).toBeLessThan(0.05);
  });

  it('10/10 wins → p < 0.01', () => {
    const p = binomialPValue(10, 10);
    expect(p).toBeLessThan(0.01);
  });

  it('0 total → returns 1', () => {
    expect(binomialPValue(0, 0)).toBe(1);
  });

  it('0 wins out of 100 → p close to 1', () => {
    const p = binomialPValue(0, 100);
    expect(p).toBeGreaterThan(0.99);
  });
});

describe('backtestPattern', () => {
  it('returns empty when not enough data', () => {
    const days = makeDays(50);
    const results = backtestPattern(days, () => [], 80, 20);
    expect(results).toHaveLength(0);
  });

  it('returns results with windows_tested > 0 for sufficient data', () => {
    const days = makeDays(200);
    // Discovery returns a pattern with events spread across dates
    const discoveryFn = (d: DayData[]): DiscoveredPattern[] => {
      const events = d.map((day, i) => makeEvent(day.date, i % 3 !== 0, i % 3 !== 0 ? 2 : -1));
      return [{
        type: 'test',
        description: 'Test',
        parameters: { x: 1 },
        events,
        occurrences: events.length,
        win_rate: 0.67,
        avg_win: 2,
        avg_loss: -1,
        expected_value: 1,
      }];
    };

    const results = backtestPattern(days, discoveryFn, 80, 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].windows_tested).toBeGreaterThan(0);
  });

  it('marks pattern as passed with strong win rate across windows', () => {
    const days = makeDays(200);
    // Pattern with 80% win rate, events on every day
    const discoveryFn = (d: DayData[]): DiscoveredPattern[] => {
      const events = d.map((day, i) => makeEvent(day.date, i % 5 !== 0, i % 5 !== 0 ? 2 : -1));
      return [{
        type: 'test',
        description: 'Strong pattern',
        parameters: { x: 1 },
        events,
        occurrences: events.length,
        win_rate: 0.8,
        avg_win: 2,
        avg_loss: -1,
        expected_value: 1.4,
      }];
    };

    const results = backtestPattern(days, discoveryFn, 80, 20);
    const passing = results.filter(r => r.passed);
    expect(passing.length).toBeGreaterThan(0);
    expect(passing[0].overall_win_rate).toBeGreaterThan(0.6);
  });

  it('does not pass pattern with 50% win rate', () => {
    const days = makeDays(200);
    const discoveryFn = (d: DayData[]): DiscoveredPattern[] => {
      const events = d.map((day, i) => makeEvent(day.date, i % 2 === 0, i % 2 === 0 ? 1 : -1));
      return [{
        type: 'test',
        description: 'Coin flip',
        parameters: { x: 1 },
        events,
        occurrences: events.length,
        win_rate: 0.5,
        avg_win: 1,
        avg_loss: -1,
        expected_value: 0,
      }];
    };

    const results = backtestPattern(days, discoveryFn, 80, 20);
    const passing = results.filter(r => r.passed);
    expect(passing).toHaveLength(0);
  });
});
