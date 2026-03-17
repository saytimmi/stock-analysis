import { describe, it, expect, vi } from 'vitest';
import {
  computeTradeLevels,
  determinePhase,
  generateTags,
} from '../src/catalog/signals.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

// ─── computeTradeLevels ────────────────────────────────────────

describe('computeTradeLevels', () => {
  it('computes levels for a long pattern (negative stop)', () => {
    // Long: stop below entry, TPs above
    const levels = computeTradeLevels(100, -2, 3, 5);
    expect(levels.entry).toBe(100);
    expect(levels.stop).toBe(98);    // 100 * (1 + (-2)/100)
    expect(levels.tp1).toBe(103);    // 100 * (1 + 3/100)
    expect(levels.tp2).toBe(105);    // 100 * (1 + 5/100)
  });

  it('computes levels for a short pattern (positive stop)', () => {
    // Short: stop above entry, TPs below
    const levels = computeTradeLevels(200, 1.5, -2, -4);
    expect(levels.entry).toBe(200);
    expect(levels.stop).toBe(203);   // 200 * (1 + 1.5/100)
    expect(levels.tp1).toBe(196);    // 200 * (1 + (-2)/100)
    expect(levels.tp2).toBe(192);    // 200 * (1 + (-4)/100)
  });

  it('rounds to 2 decimal places', () => {
    const levels = computeTradeLevels(33.33, -1.5, 2.7, 4.3);
    expect(levels.entry).toBe(33.33);
    expect(levels.stop).toBe(32.83);   // 33.33 * 0.985 = 32.83005 → 32.83
    expect(levels.tp1).toBe(34.23);    // 33.33 * 1.027 = 34.22991 → 34.23
    expect(levels.tp2).toBe(34.76);    // 33.33 * 1.043 = 34.77219 → 34.77
  });
});

// ─── determinePhase ────────────────────────────────────────────

describe('determinePhase', () => {
  const phases = [
    { time: '09:30–10:30', name: 'Opening', name_ru: 'Открытие', color: 'red' as const, description_ru: '', avg_move: -0.5, example: '' },
    { time: '10:30–12:00', name: 'Development', name_ru: 'Развитие', color: 'orange' as const, description_ru: '', avg_move: 0.2, example: '' },
    { time: '12:00–13:30', name: 'Midday', name_ru: 'Полдень', color: 'green' as const, description_ru: '', avg_move: 0.5, example: '' },
    { time: '13:30–16:00', name: 'Close', name_ru: 'Закрытие', color: 'blue' as const, description_ru: '', avg_move: 0.3, example: '' },
  ];

  it('returns first phase at 45 minutes', () => {
    const result = determinePhase(phases, 45);
    expect(result.current).toBe('Opening');
    expect(result.progress[0]).toEqual({ name: 'Opening', status: 'active' });
    expect(result.progress[1]).toEqual({ name: 'Development', status: 'pending' });
    expect(result.progress[2]).toEqual({ name: 'Midday', status: 'pending' });
    expect(result.progress[3]).toEqual({ name: 'Close', status: 'pending' });
  });

  it('returns third phase at 180 minutes', () => {
    // 180 min: past boundary 60 and 150, so index 2 is active
    const result = determinePhase(phases, 180);
    expect(result.current).toBe('Midday');
    expect(result.progress[0].status).toBe('done');
    expect(result.progress[1].status).toBe('done');
    expect(result.progress[2].status).toBe('active');
    expect(result.progress[3].status).toBe('pending');
  });

  it('returns last phase at 350 minutes', () => {
    // 350 min: past boundaries 60, 150, 240 but not 390
    const result = determinePhase(phases, 350);
    expect(result.current).toBe('Close');
    expect(result.progress[0].status).toBe('done');
    expect(result.progress[1].status).toBe('done');
    expect(result.progress[2].status).toBe('done');
    expect(result.progress[3].status).toBe('active');
  });

  it('handles empty phases gracefully', () => {
    const result = determinePhase([], 100);
    expect(result.current).toBe('Unknown');
    expect(result.progress).toEqual([]);
  });
});

// ─── generateTags ──────────────────────────────────────────────

describe('generateTags', () => {
  it('returns bullish when SPY is up', () => {
    const tags = generateTags(0.5, 1.0, '');
    expect(tags).toContain('bullish');
    expect(tags).not.toContain('bearish');
    expect(tags).not.toContain('neutral');
  });

  it('returns bearish when SPY is down', () => {
    const tags = generateTags(-0.8, 1.0, '');
    expect(tags).toContain('bearish');
    expect(tags).not.toContain('bullish');
  });

  it('returns neutral when SPY is flat', () => {
    const tags = generateTags(0.1, 1.0, '');
    expect(tags).toContain('neutral');
  });

  it('adds volume tag when ratio >= 1.5', () => {
    const tags = generateTags(0.0, 2.3, '');
    expect(tags).toContain('vol_2.3x');
  });

  it('does not add volume tag when ratio < 1.5', () => {
    const tags = generateTags(0.0, 1.2, '');
    expect(tags.some(t => t.startsWith('vol_'))).toBe(false);
  });

  it('adds earnings phase tag', () => {
    const tags = generateTags(0.0, 1.0, 'mid-quarter');
    expect(tags).toContain('mid-quarter');
  });

  it('does not add empty earnings phase', () => {
    const tags = generateTags(0.0, 1.0, '');
    expect(tags).toHaveLength(1); // only direction tag
  });
});
