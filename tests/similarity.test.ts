import { describe, it, expect, vi } from 'vitest';
import { computeSimilarity } from '../src/scoring/similarity.js';

vi.mock('../src/db/client.js', () => ({ supabase: {} }));

describe('computeSimilarity', () => {
  it('identical vectors return similarity = 1.0', () => {
    const v = [0.5, 1.0, -0.3, 2.1];
    expect(computeSimilarity(v, v, v.length)).toBe(1.0);
  });

  it('identical vectors of zeros return similarity = 1.0', () => {
    const v = [0, 0, 0, 0];
    expect(computeSimilarity(v, v, v.length)).toBe(1.0);
  });

  it('opposite vectors return low similarity', () => {
    const a = [5, 10, 15, 20];
    const b = [-5, -10, -15, -20];
    const sim = computeSimilarity(a, b, a.length);
    // Distance = sqrt(100+400+900+1600) = ~55.7 → similarity ≈ 0.018
    expect(sim).toBeLessThan(0.05);
  });

  it('partially similar vectors return medium similarity', () => {
    const a = [1, 2, 3, 4];
    const b = [1.1, 2.1, 3.1, 4.1]; // very close
    const sim = computeSimilarity(a, b, a.length);
    // Distance = sqrt(4 * 0.01) = 0.2 → similarity = 1/1.2 ≈ 0.833
    expect(sim).toBeGreaterThan(0.8);
    expect(sim).toBeLessThan(1.0);
  });

  it('similarity decreases as distance increases', () => {
    const base = [1, 2, 3];
    const close = [1.1, 2.1, 3.1];
    const far = [3, 5, 8];
    const simClose = computeSimilarity(base, close, base.length);
    const simFar = computeSimilarity(base, far, base.length);
    expect(simClose).toBeGreaterThan(simFar);
  });

  it('uses only first n elements for comparison', () => {
    const a = [1, 2, 99, 99];
    const b = [1, 2, 0, 0];
    // n=2: compare only first two elements (identical) → similarity = 1.0
    expect(computeSimilarity(a, b, 2)).toBe(1.0);
    // n=4: diverge heavily → much lower
    expect(computeSimilarity(a, b, 4)).toBeLessThan(0.1);
  });

  it('handles n larger than vector length gracefully (uses min length)', () => {
    const a = [1.0, 2.0];
    const b = [1.0, 2.0];
    // n=100 but vectors only have 2 elements
    expect(computeSimilarity(a, b, 100)).toBe(1.0);
  });

  it('handles empty vectors', () => {
    // distance = 0, similarity = 1.0
    expect(computeSimilarity([], [], 0)).toBe(1.0);
  });

  it('similarity is always between 0 and 1', () => {
    const a = [100, -50, 30];
    const b = [-100, 50, -30];
    const sim = computeSimilarity(a, b, a.length);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});
