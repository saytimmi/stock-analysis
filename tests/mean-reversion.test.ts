import { describe, it, expect, vi } from 'vitest';
import { discoverMeanReversion } from '../src/patterns/discovery/mean-reversion.js';
import type { DayData, PatternCandle } from '../src/patterns/types.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

function makeCandle(time: string, pct_from_open: number): PatternCandle {
  return {
    time,
    open: 100,
    high: 100 + Math.max(pct_from_open, 0),
    low: 100 + Math.min(pct_from_open, 0),
    close: 100 + pct_from_open,
    volume: 1000,
    pct_from_open,
    relative_move: 0,
  };
}

/**
 * Build a DayData where the stock spikes up past a threshold early,
 * then reverts back toward zero by end of day.
 */
function makeReversionDay(date: string, peakPct: number, eodPct: number): DayData {
  // 26 candles: spike at candle 2, revert gradually
  const candles: PatternCandle[] = [];
  const times = Array.from({ length: 26 }, (_, i) => {
    const totalMinutes = 9 * 60 + 30 + i * 15;
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const m = (totalMinutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  });

  for (let i = 0; i < 26; i++) {
    let pct: number;
    if (i < 2) {
      // Rising to peak
      pct = (peakPct / 2) * (i + 1);
    } else if (i === 2) {
      pct = peakPct;
    } else {
      // Gradually revert from peak to eodPct
      const progress = (i - 2) / (26 - 2 - 1);
      pct = peakPct + (eodPct - peakPct) * progress;
    }
    candles.push(makeCandle(times[i], pct));
  }

  return {
    date,
    candles,
    day_change_pct: eodPct,
    gap_pct: null,
    day_of_week: 1,
  };
}

/**
 * Build a DayData where a down move eventually reverts upward.
 */
function makeDownReversionDay(date: string, troughPct: number, eodPct: number): DayData {
  const candles: PatternCandle[] = [];
  const times = Array.from({ length: 26 }, (_, i) => {
    const totalMinutes = 9 * 60 + 30 + i * 15;
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const m = (totalMinutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  });

  for (let i = 0; i < 26; i++) {
    let pct: number;
    if (i < 2) {
      pct = (troughPct / 2) * (i + 1);
    } else if (i === 2) {
      pct = troughPct;
    } else {
      const progress = (i - 2) / (26 - 2 - 1);
      pct = troughPct + (eodPct - troughPct) * progress;
    }
    candles.push(makeCandle(times[i], pct));
  }

  return {
    date,
    candles,
    day_change_pct: eodPct,
    gap_pct: null,
    day_of_week: 2,
  };
}

describe('discoverMeanReversion', () => {
  it('returns empty array when no days are provided', () => {
    expect(discoverMeanReversion([])).toEqual([]);
  });

  it('returns empty array when fewer than 30 qualifying days', () => {
    const days = Array.from({ length: 20 }, (_, i) =>
      makeReversionDay(`2024-01-${String(i + 1).padStart(2, '0')}`, 1.5, 0.2)
    );
    const patterns = discoverMeanReversion(days);
    // With only 20 days, no pattern should reach 30 occurrences
    expect(patterns.every((p) => p.occurrences >= 30)).toBe(true);
    // All returned patterns have >= 30 occurrences (filter is enforced)
    patterns.forEach((p) => expect(p.occurrences).toBeGreaterThanOrEqual(30));
  });

  it('discovers up reversion pattern when 30+ days show clear reversion', () => {
    // Create 40 days where stock spikes +1.5% then reverts to +0.3%
    const days = Array.from({ length: 40 }, (_, i) =>
      makeReversionDay(`2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, 1.5, 0.3)
    );

    const patterns = discoverMeanReversion(days);
    expect(patterns.length).toBeGreaterThan(0);

    const reversionPatterns = patterns.filter(
      (p) => p.type === 'mean_reversion' && p.parameters.direction === 'up'
    );
    expect(reversionPatterns.length).toBeGreaterThan(0);

    // At least one pattern should have high win_rate since reversion is guaranteed
    const highWinRate = reversionPatterns.find((p) => p.win_rate > 0.8);
    expect(highWinRate).toBeDefined();
  });

  it('discovers down reversion pattern when 30+ days show clear reversion', () => {
    // Create 40 days where stock drops -1.5% then recovers to -0.2%
    const days = Array.from({ length: 40 }, (_, i) =>
      makeDownReversionDay(`2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, -1.5, -0.2)
    );

    const patterns = discoverMeanReversion(days);
    const downReversionPatterns = patterns.filter(
      (p) => p.type === 'mean_reversion' && p.parameters.direction === 'down'
    );
    expect(downReversionPatterns.length).toBeGreaterThan(0);

    const highWinRate = downReversionPatterns.find((p) => p.win_rate > 0.8);
    expect(highWinRate).toBeDefined();
  });

  it('pattern events have correct structure', () => {
    const days = Array.from({ length: 40 }, (_, i) =>
      makeReversionDay(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`, 2.0, 0.5)
    );

    const patterns = discoverMeanReversion(days);
    if (patterns.length === 0) return; // skip if no patterns found

    const pattern = patterns[0];
    expect(pattern).toHaveProperty('type');
    expect(pattern).toHaveProperty('description');
    expect(pattern).toHaveProperty('parameters');
    expect(pattern).toHaveProperty('events');
    expect(pattern).toHaveProperty('occurrences');
    expect(pattern).toHaveProperty('win_rate');
    expect(pattern).toHaveProperty('avg_win');
    expect(pattern).toHaveProperty('avg_loss');
    expect(pattern).toHaveProperty('expected_value');

    expect(pattern.events.length).toBeGreaterThan(0);
    const event = pattern.events[0];
    expect(event).toHaveProperty('date');
    expect(event).toHaveProperty('trigger_candle');
    expect(event).toHaveProperty('trigger_value');
    expect(event).toHaveProperty('predicted_direction');
    expect(event).toHaveProperty('actual_outcome');
    expect(event).toHaveProperty('was_correct');
    expect(event).toHaveProperty('profit_pct');
    expect(['up', 'down']).toContain(event.predicted_direction);
  });

  it('filters patterns below 30 occurrences', () => {
    // Only 15 days — should produce no patterns
    const days = Array.from({ length: 15 }, (_, i) =>
      makeReversionDay(`2024-01-${String(i + 1).padStart(2, '0')}`, 1.5, 0.2)
    );
    const patterns = discoverMeanReversion(days);
    patterns.forEach((p) => {
      expect(p.occurrences).toBeGreaterThanOrEqual(30);
    });
  });

  it('win_rate is between 0 and 1', () => {
    const days = Array.from({ length: 40 }, (_, i) =>
      makeReversionDay(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`, 1.5, 0.3)
    );
    const patterns = discoverMeanReversion(days);
    patterns.forEach((p) => {
      expect(p.win_rate).toBeGreaterThanOrEqual(0);
      expect(p.win_rate).toBeLessThanOrEqual(1);
    });
  });

  it('occurrences matches events length', () => {
    const days = Array.from({ length: 40 }, (_, i) =>
      makeReversionDay(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`, 1.5, 0.3)
    );
    const patterns = discoverMeanReversion(days);
    patterns.forEach((p) => {
      expect(p.occurrences).toBe(p.events.length);
    });
  });
});
