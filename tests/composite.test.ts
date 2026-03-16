import { describe, it, expect } from 'vitest';
import { computeComposite } from '../src/scoring/composite.js';
import type { Signal } from '../src/scoring/composite.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

describe('computeComposite', () => {
  it('returns score=0 and confidence=low for empty signals', () => {
    const result = computeComposite([]);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe('low');
    expect(result.signals).toHaveLength(0);
  });

  it('produces score near +100 for all bullish signals', () => {
    const signals: Signal[] = [
      { source: 'analog_consensus', direction: 'up', strength: 1, weight: 0.30, accuracy: 1 },
      { source: 'active_pattern', direction: 'up', strength: 1, weight: 0.25, accuracy: 1 },
      { source: 'volume', direction: 'up', strength: 1, weight: 0.15, accuracy: 1 },
      { source: 'market_correlation', direction: 'up', strength: 1, weight: 0.10, accuracy: 1 },
      { source: 'multi_timeframe', direction: 'up', strength: 1, weight: 0.10, accuracy: 1 },
      { source: 'pre_market', direction: 'up', strength: 1, weight: 0.05, accuracy: 1 },
      { source: 'calendar', direction: 'up', strength: 1, weight: 0.05, accuracy: 1 },
    ];
    const result = computeComposite(signals);
    expect(result.score).toBe(100);
    expect(result.score).toBeGreaterThan(0);
  });

  it('produces score near -100 for all bearish signals', () => {
    const signals: Signal[] = [
      { source: 'analog_consensus', direction: 'down', strength: 1, weight: 0.30, accuracy: 1 },
      { source: 'active_pattern', direction: 'down', strength: 1, weight: 0.25, accuracy: 1 },
      { source: 'volume', direction: 'down', strength: 1, weight: 0.15, accuracy: 1 },
      { source: 'market_correlation', direction: 'down', strength: 1, weight: 0.10, accuracy: 1 },
      { source: 'multi_timeframe', direction: 'down', strength: 1, weight: 0.10, accuracy: 1 },
      { source: 'pre_market', direction: 'down', strength: 1, weight: 0.05, accuracy: 1 },
      { source: 'calendar', direction: 'down', strength: 1, weight: 0.05, accuracy: 1 },
    ];
    const result = computeComposite(signals);
    expect(result.score).toBe(-100);
    expect(result.score).toBeLessThan(0);
  });

  it('produces score near 0 for perfectly mixed signals', () => {
    const signals: Signal[] = [
      { source: 'analog_consensus', direction: 'up', strength: 1, weight: 0.30, accuracy: 0.8 },
      { source: 'active_pattern', direction: 'down', strength: 1, weight: 0.30, accuracy: 0.8 },
      { source: 'volume', direction: 'up', strength: 1, weight: 0.20, accuracy: 0.8 },
      { source: 'market_correlation', direction: 'down', strength: 1, weight: 0.20, accuracy: 0.8 },
    ];
    const result = computeComposite(signals);
    expect(result.score).toBe(0);
  });

  it('returns confidence=high when 5+ signals agree', () => {
    const signals: Signal[] = [
      { source: 's1', direction: 'up', strength: 0.8, weight: 0.15, accuracy: 0.7 },
      { source: 's2', direction: 'up', strength: 0.8, weight: 0.15, accuracy: 0.7 },
      { source: 's3', direction: 'up', strength: 0.8, weight: 0.15, accuracy: 0.7 },
      { source: 's4', direction: 'up', strength: 0.8, weight: 0.15, accuracy: 0.7 },
      { source: 's5', direction: 'up', strength: 0.8, weight: 0.15, accuracy: 0.7 },
      { source: 's6', direction: 'down', strength: 0.2, weight: 0.05, accuracy: 0.5 },
    ];
    const result = computeComposite(signals);
    expect(result.confidence).toBe('high');
  });

  it('returns confidence=medium when 3-4 signals agree', () => {
    const signals: Signal[] = [
      { source: 's1', direction: 'up', strength: 0.8, weight: 0.25, accuracy: 0.7 },
      { source: 's2', direction: 'up', strength: 0.8, weight: 0.25, accuracy: 0.7 },
      { source: 's3', direction: 'up', strength: 0.8, weight: 0.25, accuracy: 0.7 },
      { source: 's4', direction: 'down', strength: 0.8, weight: 0.25, accuracy: 0.7 },
    ];
    const result = computeComposite(signals);
    expect(result.confidence).toBe('medium');
  });

  it('returns confidence=low when fewer than 3 signals agree', () => {
    const signals: Signal[] = [
      { source: 's1', direction: 'up', strength: 0.8, weight: 0.4, accuracy: 0.7 },
      { source: 's2', direction: 'down', strength: 0.8, weight: 0.3, accuracy: 0.7 },
      { source: 's3', direction: 'down', strength: 0.8, weight: 0.3, accuracy: 0.7 },
    ];
    const result = computeComposite(signals);
    // up: 1 agreeing, down: 2 agreeing → score is negative → dominant is down with 2 agreeing → low
    expect(result.confidence).toBe('low');
  });

  it('includes all signals in the result', () => {
    const signals: Signal[] = [
      { source: 'analog_consensus', direction: 'up', strength: 0.7, weight: 0.30 },
      { source: 'volume', direction: 'up', strength: 0.5, weight: 0.15 },
    ];
    const result = computeComposite(signals);
    expect(result.signals).toHaveLength(2);
    expect(result.signals).toEqual(signals);
  });

  it('uses default accuracy of 0.5 when accuracy is not provided', () => {
    const withAccuracy: Signal[] = [
      { source: 's1', direction: 'up', strength: 1, weight: 0.5, accuracy: 0.5 },
    ];
    const withoutAccuracy: Signal[] = [
      { source: 's1', direction: 'up', strength: 1, weight: 0.5 },
    ];
    expect(computeComposite(withAccuracy).score).toBe(computeComposite(withoutAccuracy).score);
  });

  it('returns positive risk_reward for non-zero score', () => {
    const signals: Signal[] = [
      { source: 's1', direction: 'up', strength: 1, weight: 1, accuracy: 0.8 },
    ];
    const result = computeComposite(signals);
    expect(result.risk_reward).toBeGreaterThan(0);
    expect(result.suggested_stop_loss).toBeGreaterThan(0);
  });
});
