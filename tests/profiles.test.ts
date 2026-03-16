import { describe, it, expect, vi } from 'vitest';
import { buildProfileVector, padVector, classifyPreMarket } from '../src/fetcher/profiles.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

describe('Profile Computation', () => {
  it('should build profile vector from candle pct_from_open values', () => {
    const candles = [
      { pct_from_open: 0.5 },
      { pct_from_open: 1.2 },
      { pct_from_open: 0.8 },
    ];
    const vector = buildProfileVector(candles);
    expect(vector).toEqual([0.5, 1.2, 0.8]);
  });

  it('should pad vector to target length with last value', () => {
    const vector = [0.5, 1.2, 0.8];
    const padded = padVector(vector, 26);
    expect(padded).toHaveLength(26);
    expect(padded[0]).toBe(0.5);
    expect(padded[2]).toBe(0.8);
    expect(padded[25]).toBe(0.8);
  });

  it('should pad empty vector with zeros', () => {
    const padded = padVector([], 26);
    expect(padded).toHaveLength(26);
    expect(padded[0]).toBe(0);
  });

  it('should truncate vector longer than target', () => {
    const vector = Array.from({ length: 30 }, (_, i) => i);
    const padded = padVector(vector, 26);
    expect(padded).toHaveLength(26);
    expect(padded[25]).toBe(25);
  });

  it('should classify pre-market direction', () => {
    expect(classifyPreMarket(1.5)).toBe('up');
    expect(classifyPreMarket(-0.8)).toBe('down');
    expect(classifyPreMarket(0.05)).toBe('flat');
    expect(classifyPreMarket(0.25)).toBe('flat');
    expect(classifyPreMarket(0.26)).toBe('up');
    expect(classifyPreMarket(-0.26)).toBe('down');
  });
});
