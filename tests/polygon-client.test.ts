import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolygonClient } from '../src/polygon/client.js';

describe('PolygonClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should serialize concurrent requests through the queue', async () => {
    const client = new PolygonClient('test-key', 5);
    const callOrder: number[] = [];

    global.fetch = vi.fn().mockImplementation(async () => {
      callOrder.push(Date.now());
      return {
        ok: true,
        json: async () => ({ results: [], resultsCount: 0, status: 'OK' }),
      };
    });

    await Promise.all([
      client.request('/a'),
      client.request('/b'),
      client.request('/c'),
    ]);

    expect(callOrder).toHaveLength(3);
    for (let i = 1; i < callOrder.length; i++) {
      expect(callOrder[i] - callOrder[i - 1]).toBeGreaterThanOrEqual(150);
    }
  });

  it('should fetch aggregate bars for a ticker', async () => {
    const client = new PolygonClient('test-key', 5);
    const mockBars = [
      { o: 100, h: 105, l: 99, c: 103, v: 1000, t: 1700000000000, n: 50 },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockBars, resultsCount: 1, status: 'OK', ticker: 'ALAB' }),
    });

    const result = await client.getAggregates('ALAB', 1, 'day', '2025-01-01', '2025-01-02');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].o).toBe(100);
  });

  it('should retry on 429 response', async () => {
    const client = new PolygonClient('test-key', 5, 1); // 1ms retry delay for fast tests
    let callCount = 0;

    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' };
      }
      return {
        ok: true,
        json: async () => ({ results: [], resultsCount: 0, status: 'OK' }),
      };
    });

    const result = await client.request('/test');
    expect(callCount).toBe(2);
    expect(result.status).toBe('OK');
  });

  it('should throw after max retries on persistent 429', async () => {
    const client = new PolygonClient('test-key', 5, 1); // 1ms retry delay for fast tests

    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, statusText: 'Too Many Requests',
    });

    await expect(client.request('/test')).rejects.toThrow('429');
  });

  it('should throw on non-429 error responses', async () => {
    const client = new PolygonClient('test-key', 5);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
    });

    await expect(client.request('/test')).rejects.toThrow('403');
  });

  it('should warn when next_url is present (pagination)', async () => {
    const client = new PolygonClient('test-key', 5);
    const consoleSpy = vi.spyOn(console, 'warn');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ o: 1, h: 2, l: 0, c: 1, v: 1, t: 1, n: 1 }],
        resultsCount: 1,
        status: 'OK',
        next_url: 'https://api.polygon.io/v2/next',
      }),
    });

    await client.getAggregates('ALAB', 1, 'day', '2020-01-01', '2025-01-01');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pagination'));
  });
});
