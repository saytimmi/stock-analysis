import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  supabase: { from: vi.fn() },
}));

import { classifySession, computePctFromOpen } from '../src/fetcher/intraday.js';

describe('Intraday Fetcher', () => {
  it('should classify pre-market session', () => {
    expect(classifySession('04:00')).toBe('pre_market');
    expect(classifySession('09:15')).toBe('pre_market');
    expect(classifySession('09:29')).toBe('pre_market');
  });

  it('should classify regular session', () => {
    expect(classifySession('09:30')).toBe('regular');
    expect(classifySession('12:00')).toBe('regular');
    expect(classifySession('15:45')).toBe('regular');
    expect(classifySession('15:59')).toBe('regular');
  });

  it('should classify after-hours session', () => {
    expect(classifySession('16:00')).toBe('after_hours');
    expect(classifySession('18:30')).toBe('after_hours');
  });

  it('should compute pct_from_open correctly', () => {
    expect(computePctFromOpen(102, 100)).toBeCloseTo(2.0, 2);
    expect(computePctFromOpen(97, 100)).toBeCloseTo(-3.0, 2);
  });

  it('should return 0 pct when day open is 0', () => {
    expect(computePctFromOpen(100, 0)).toBe(0);
  });
});
