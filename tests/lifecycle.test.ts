import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BacktestResult } from '../src/patterns/backtest.js';
import { DiscoveredPattern, PatternEvent } from '../src/patterns/types.js';

// Mock supabase
vi.mock('../src/db/client.js', () => ({ supabase: {} }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(was_correct: boolean): PatternEvent {
  return {
    date: '2023-06-01',
    trigger_candle: 1,
    trigger_value: 1,
    predicted_direction: 'up',
    predicted_magnitude: 1,
    actual_outcome: was_correct ? 1 : -1,
    was_correct,
    profit_pct: was_correct ? 2 : -1,
  };
}

function makePattern(winRate = 0.7, occurrences = 50): DiscoveredPattern {
  const wins = Math.round(occurrences * winRate);
  const events = Array.from({ length: occurrences }, (_, i) => makeEvent(i < wins));
  return {
    type: 'test_pattern',
    description: 'A test pattern',
    parameters: { threshold: 1.0 },
    events,
    occurrences,
    win_rate: winRate,
    avg_win: 2,
    avg_loss: -1,
    expected_value: winRate * 2 + (1 - winRate) * -1,
  };
}

function makeBacktestResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    pattern: makePattern(),
    windows_tested: 5,
    overall_win_rate: 0.7,
    overall_ev: 1.1,
    p_value: 0.02,
    passed: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('storePatterns', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('stores only passing patterns', async () => {
    const insertedPatterns: any[] = [];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'patterns') {
          return {
            insert: vi.fn().mockImplementation((data: any) => {
              insertedPatterns.push(data);
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
                }),
              };
            }),
          };
        }
        if (table === 'pattern_events') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    };

    // Override the mock
    const { supabase } = await import('../src/db/client.js');
    Object.assign(supabase, mockSupabase);

    const { storePatterns } = await import('../src/patterns/lifecycle.js');

    const results: BacktestResult[] = [
      makeBacktestResult({ passed: true }),
      makeBacktestResult({ passed: false }),
      makeBacktestResult({ passed: true }),
    ];

    const count = await storePatterns(1, results);
    expect(count).toBe(2);
  });

  it('returns 0 when no patterns pass', async () => {
    const { storePatterns } = await import('../src/patterns/lifecycle.js');
    const count = await storePatterns(1, [makeBacktestResult({ passed: false })]);
    expect(count).toBe(0);
  });

  it('returns 0 for empty results', async () => {
    const { storePatterns } = await import('../src/patterns/lifecycle.js');
    const count = await storePatterns(1, []);
    expect(count).toBe(0);
  });
});

describe('retireDegraded', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('retires patterns with accuracy_30d < 0.45 that are stale', async () => {
    const retiredIds: number[] = [];
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'patterns') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({
                    data: [{ id: 10 }, { id: 20 }],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((data: any) => {
              return {
                in: vi.fn().mockImplementation((col: string, ids: number[]) => {
                  retiredIds.push(...ids);
                  return Promise.resolve({ error: null });
                }),
              };
            }),
          };
        }
        return {};
      }),
    };

    const { supabase } = await import('../src/db/client.js');
    Object.assign(supabase, mockSupabase);

    const { retireDegraded } = await import('../src/patterns/lifecycle.js');
    const count = await retireDegraded();
    expect(count).toBe(2);
    expect(retiredIds).toContain(10);
    expect(retiredIds).toContain(20);
  });

  it('returns 0 when no degraded patterns found', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              lte: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      })),
    };

    const { supabase } = await import('../src/db/client.js');
    Object.assign(supabase, mockSupabase);

    const { retireDegraded } = await import('../src/patterns/lifecycle.js');
    const count = await retireDegraded();
    expect(count).toBe(0);
  });
});

describe('promoteValidated', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('promotes validated patterns older than 2 weeks to live', async () => {
    const promotedIds: number[] = [];
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'patterns') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockResolvedValue({
                  data: [{ id: 5 }, { id: 6 }],
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((_data: any) => ({
              in: vi.fn().mockImplementation((_col: string, ids: number[]) => {
                promotedIds.push(...ids);
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }
        return {};
      }),
    };

    const { supabase } = await import('../src/db/client.js');
    Object.assign(supabase, mockSupabase);

    const { promoteValidated } = await import('../src/patterns/lifecycle.js');
    const count = await promoteValidated();
    expect(count).toBe(2);
    expect(promotedIds).toContain(5);
    expect(promotedIds).toContain(6);
  });

  it('returns 0 when no validated patterns are ready', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lte: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      })),
    };

    const { supabase } = await import('../src/db/client.js');
    Object.assign(supabase, mockSupabase);

    const { promoteValidated } = await import('../src/patterns/lifecycle.js');
    const count = await promoteValidated();
    expect(count).toBe(0);
  });
});

describe('updateAccuracy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('updates accuracy_30d and detects declining trend', async () => {
    const updatedData: any[] = [];
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'patterns') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ id: 1, win_rate: 0.7, accuracy_30d: 0.7 }],
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((data: any) => {
              updatedData.push(data);
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              };
            }),
          };
        }
        if (table === 'pattern_events') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({
                  // 4/10 = 40% accuracy → declining from 70%
                  data: Array.from({ length: 10 }, (_, i) => ({ was_correct: i < 4 })),
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const { supabase } = await import('../src/db/client.js');
    Object.assign(supabase, mockSupabase);

    const { updateAccuracy } = await import('../src/patterns/lifecycle.js');
    await updateAccuracy(1);

    expect(updatedData.length).toBeGreaterThan(0);
    expect(updatedData[0].accuracy_30d).toBeCloseTo(0.4);
    expect(updatedData[0].accuracy_trend).toBe('declining');
  });
});
