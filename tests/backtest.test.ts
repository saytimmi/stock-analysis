import { describe, it, expect } from 'vitest';
import { binomialPValue, backtestPattern } from '../src/patterns/backtest.js';
import { DayData, DiscoveredPattern, PatternCandle, PatternEvent } from '../src/patterns/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCandle(time: string, close: number): PatternCandle {
  return { time, open: 100, high: close + 1, low: close - 1, close, volume: 1000, pct_from_open: 0, relative_move: 0 };
}

function makeDay(date: string, candles?: PatternCandle[]): DayData {
  const cs = candles ?? [makeCandle('09:30', 100), makeCandle('09:45', 101)];
  return { date, candles: cs, day_change_pct: 1, gap_pct: 0, day_of_week: 1 };
}

function makeDays(n: number): DayData[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(2023, 0, i + 1);
    return makeDay(d.toISOString().slice(0, 10));
  });
}

function makeEvent(was_correct: boolean, profit_pct: number): PatternEvent {
  return {
    date: '2023-01-01',
    trigger_candle: 1,
    trigger_value: 1,
    predicted_direction: 'up',
    predicted_magnitude: 1,
    actual_outcome: was_correct ? 1 : -1,
    was_correct,
    profit_pct,
  };
}

function makePattern(events: PatternEvent[]): DiscoveredPattern {
  const wins = events.filter((e) => e.was_correct);
  const losses = events.filter((e) => !e.was_correct);
  const win_rate = events.length ? wins.length / events.length : 0;
  const avg_win = wins.length ? wins.reduce((s, e) => s + e.profit_pct, 0) / wins.length : 0;
  const avg_loss = losses.length ? losses.reduce((s, e) => s + e.profit_pct, 0) / losses.length : 0;
  return {
    type: 'test_pattern',
    description: 'Test pattern',
    parameters: { threshold: 1.0 },
    events,
    occurrences: events.length,
    win_rate,
    avg_win,
    avg_loss,
    expected_value: win_rate * avg_win + (1 - win_rate) * avg_loss,
  };
}

// ── binomialPValue tests ──────────────────────────────────────────────────────

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

  it('0 wins out of 100 → p ≈ 1 (upper tail is essentially 0, returning large)', () => {
    // 0 wins means very bad performance, p-value for wins >= 0 is 1
    const p = binomialPValue(0, 100);
    expect(p).toBeGreaterThan(0.99);
  });
});

// ── Walk-forward window generation ───────────────────────────────────────────

describe('backtestPattern', () => {
  it('returns empty when not enough data', () => {
    const days = makeDays(50); // less than 80+20=100
    const results = backtestPattern(days, () => [], 80, 20);
    expect(results).toHaveLength(0);
  });

  it('generates correct number of windows for 200 days', () => {
    // train=80, test=20: windows start at 0, 20, 40, ..., max start where start+100 <= 200
    // starts: 0,20,40,...,100 → 6 windows
    const days = makeDays(200);
    let windowsObserved = 0;
    backtestPattern(
      days,
      (d) => {
        // Count how many times we see trainDays-sized slices
        if (d.length === 80) windowsObserved++;
        return [];
      },
      80,
      20,
    );
    expect(windowsObserved).toBe(6);
  });

  it('filters patterns with low occurrences (< 30 events in test)', () => {
    const days = makeDays(200);

    // Discovery fn returns a pattern with only 5 events in test set
    const discoveryFn = (d: DayData[]): DiscoveredPattern[] => {
      if (d.length !== 20) return []; // only return for test-sized sets
      const events = Array.from({ length: 5 }, () => makeEvent(true, 1));
      return [makePattern(events)];
    };

    const results = backtestPattern(days, discoveryFn, 80, 20);
    // Any result should not pass due to low occurrences
    const passing = results.filter((r) => r.passed);
    expect(passing).toHaveLength(0);
  });

  it('marks pattern as passed when p_value < 0.05 and ev > 0 and occurrences >= 30', () => {
    const days = makeDays(200);

    // Mock discovery: training produces pattern, test produces strong win rate
    const discoveryFn = (d: DayData[]): DiscoveredPattern[] => {
      // Return a high-win-rate pattern regardless of train/test
      const events = Array.from({ length: 30 }, (_, i) =>
        makeEvent(i < 25, i < 25 ? 2 : -1), // 25/30 = 83% win rate
      );
      return [makePattern(events)];
    };

    const results = backtestPattern(days, discoveryFn, 80, 20);
    expect(results.length).toBeGreaterThan(0);
    // With 83% win rate across many events, should pass
    const passing = results.filter((r) => r.passed);
    expect(passing.length).toBeGreaterThan(0);
  });

  it('returns windows_tested count per pattern', () => {
    const days = makeDays(200);
    const discoveryFn = (_d: DayData[]): DiscoveredPattern[] => {
      const events = Array.from({ length: 10 }, (_, i) => makeEvent(i < 7, i < 7 ? 2 : -1));
      return [makePattern(events)];
    };

    const results = backtestPattern(days, discoveryFn, 80, 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].windows_tested).toBeGreaterThan(0);
  });
});
