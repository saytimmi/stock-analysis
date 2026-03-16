import { config } from '../config.js';
import type { PolygonAggResponse } from './types.js';

export class PolygonClient {
  private apiKey: string;
  private maxRps: number;
  private maxRetries: number;
  private retryDelay: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(apiKey?: string, maxRps?: number, retryDelay?: number) {
    this.apiKey = apiKey ?? config.polygon.apiKey;
    this.maxRps = maxRps ?? config.polygon.maxRequestsPerSecond;
    this.maxRetries = config.polygon.maxRetries ?? 3;
    this.retryDelay = retryDelay ?? 1000;
  }

  private async waitForSlot(): Promise<void> {
    const minInterval = 1000 / this.maxRps;
    this.queue = this.queue.then(
      () => new Promise(resolve => setTimeout(resolve, minInterval))
    );
    return this.queue;
  }

  async request(path: string): Promise<any> {
    await this.waitForSlot();

    const separator = path.includes('?') ? '&' : '?';
    const url = `${config.polygon.baseUrl}${path}${separator}apiKey=${this.apiKey}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const response = await fetch(url);

      if (response.ok) {
        return response.json();
      }

      if (response.status === 429 && attempt < this.maxRetries) {
        const backoffMs = this.retryDelay * Math.pow(2, attempt);
        console.warn(`Rate limited (429), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${this.maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        await this.waitForSlot();
        continue;
      }

      throw new Error(`Polygon API error: ${response.status} ${response.statusText} for ${path}`);
    }
  }

  async getAggregates(
    ticker: string,
    multiplier: number,
    timespan: 'minute' | 'hour' | 'day',
    from: string,
    to: string,
    limit = 50000
  ): Promise<PolygonAggResponse> {
    const path = `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}`;
    const result = await this.request(path) as PolygonAggResponse;

    if (result.next_url) {
      console.warn(`Polygon response has pagination (next_url present) for ${ticker} ${timespan}. Some data may be truncated.`);
    }

    return result;
  }
}
