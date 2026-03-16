# Phase 1: Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the complete data pipeline — Supabase database with pgvector, Polygon.io data fetching, and automated daily updates via GitHub Actions. After this phase, all historical and daily data flows into the database automatically.

**Architecture:** TypeScript project using Supabase as the database (PostgreSQL + pgvector). GitHub Actions runs scheduled TypeScript scripts that fetch data from Polygon.io REST API, compute derived fields (pct_from_open, relative_move), and store everything in Supabase. A mutex-based queue rate limiter keeps Polygon.io calls under 5/second.

**Tech Stack:** TypeScript, Supabase (PostgreSQL + pgvector), Polygon.io REST API, GitHub Actions, tsx (for running TS scripts), dotenv, vitest

**Spec:** `docs/superpowers/specs/2026-03-16-trading-intelligence-system-design.md`

**Deferred to Phase 2:**
- Earnings calendar integration (will use Polygon.io reference data API)
- Real-time pre-market fetching during live session (Phase 1 only fetches historical pre-market data)

---

## File Structure

```
stock-analysis/
├── package.json                  # type: "module", scripts, deps
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
├── .env                          # POLYGON_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
├── .env.example
├── src/
│   ├── config.ts                 # env vars, constants (market hours, intervals)
│   ├── db/
│   │   ├── client.ts             # Supabase client singleton
│   │   └── migrations/
│   │       └── 001_initial_schema.sql
│   ├── polygon/
│   │   ├── client.ts             # Rate-limited Polygon.io client with retry
│   │   └── types.ts              # Polygon API response types
│   ├── fetcher/
│   │   ├── daily.ts              # Fetch & store daily OHLCV candles
│   │   ├── intraday.ts           # Fetch & store 15-min candles
│   │   ├── market-context.ts     # Fetch & store SPY/QQQ data
│   │   └── profiles.ts           # Compute & store day_profiles from candles
│   └── scripts/
│       ├── backfill.ts           # One-time historical data backfill
│       └── daily-update.ts       # Daily data fetch + profile computation
├── tests/
│   ├── polygon-client.test.ts
│   ├── daily-fetcher.test.ts
│   ├── intraday-fetcher.test.ts
│   ├── market-context.test.ts
│   └── profiles.test.ts
└── .github/
    └── workflows/
        └── daily-update.yml      # Cron job for daily data pipeline
```

---

## Chunk 1: Project Setup & Database Schema

### Task 1: Initialize TypeScript project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/config.ts`

- [ ] **Step 1: Initialize npm project and install dependencies**

```bash
cd /Users/timur/stock-analysis
npm init -y
# Add type: module to package.json
node -e "const p=require('./package.json'); p.type='module'; p.scripts={backfill:'tsx src/scripts/backfill.ts','daily-update':'tsx src/scripts/daily-update.ts',test:'vitest run'}; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
npm install @supabase/supabase-js dotenv
npm install -D typescript @types/node tsx vitest
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Create .env.example**

```
POLYGON_API_KEY=your_polygon_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
```

- [ ] **Step 5: Update .gitignore**

Append to existing `.gitignore`:
```
node_modules/
dist/
.env
```

- [ ] **Step 6: Create src/config.ts**

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  polygon: {
    apiKey: process.env.POLYGON_API_KEY!,
    baseUrl: 'https://api.polygon.io',
    maxRequestsPerSecond: 5,
    maxRetries: 3,
  },
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_KEY!,
  },
  market: {
    regularOpen: '09:30',
    regularClose: '16:00',
    preMarketOpen: '04:00',
    timezone: 'America/New_York',
    candleInterval: 15, // minutes
    candlesPerDay: 26,  // regular session: 9:30-16:00 = 6.5h = 26 x 15min
  },
  defaultStocks: ['ALAB'],
  marketIndexes: ['SPY', 'QQQ'],
} as const;

export function toETDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function toETTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isOPEX(dateStr: string): boolean {
  // Parse as ET to avoid UTC day-of-week mismatch
  const parts = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0)); // noon UTC avoids timezone edge
  return d.getUTCDay() === 5 && Math.ceil(d.getUTCDate() / 7) === 3;
}
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .gitignore src/config.ts
git commit -m "feat: initialize TypeScript project with config and tooling"
```

---

### Task 2: Create Supabase project and database schema

**Files:**
- Create: `src/db/migrations/001_initial_schema.sql`
- Create: `src/db/client.ts`

**Prerequisites:** User needs to create a Supabase project via dashboard (https://supabase.com/dashboard) and enable pgvector extension. Get SUPABASE_URL and SUPABASE_SERVICE_KEY.

- [ ] **Step 1: Create the migration SQL file**

```sql
-- Enable pgvector extension for similarity search
create extension if not exists vector;

-- Tracked stocks
create table stocks (
  id serial primary key,
  ticker text not null unique,
  name text,
  sector text,
  added_at timestamptz default now(),
  active boolean default true
);

-- 15-minute intraday candles
create table candles_15m (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  date date not null,
  time time not null,
  session text not null check (session in ('pre_market', 'regular', 'after_hours')),
  open numeric(12,4) not null,
  high numeric(12,4) not null,
  low numeric(12,4) not null,
  close numeric(12,4) not null,
  volume bigint not null,
  pct_from_open numeric(8,4),
  relative_move numeric(8,4),
  unique(stock_id, date, time)
);

create index idx_candles_15m_stock_date on candles_15m(stock_id, date);
create index idx_candles_15m_stock_date_session on candles_15m(stock_id, date, session);

-- Daily OHLCV candles
create table candles_daily (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  date date not null,
  open numeric(12,4) not null,
  high numeric(12,4) not null,
  low numeric(12,4) not null,
  close numeric(12,4) not null,
  volume bigint not null,
  gap_pct numeric(8,4),
  unique(stock_id, date)
);

create index idx_candles_daily_stock_date on candles_daily(stock_id, date);

-- Computed day profiles for similarity search
create table day_profiles (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  date date not null,
  open_price numeric(12,4) not null,
  day_change_pct numeric(8,4),
  profile_vector vector(26),
  relative_profile_vector vector(26),
  volume_profile real[],
  pre_market_direction text check (pre_market_direction in ('up', 'down', 'flat')),
  pre_market_volume_ratio numeric(8,4),
  is_earnings boolean default false,
  is_opex boolean default false,
  day_of_week smallint,
  candle_count smallint,
  unique(stock_id, date)
);

create index idx_day_profiles_stock_date on day_profiles(stock_id, date);

-- pgvector indexes (created after backfill when data exists)
-- create index idx_profile_vector on day_profiles using ivfflat (profile_vector vector_l2_ops) with (lists = 50);
-- create index idx_relative_profile_vector on day_profiles using ivfflat (relative_profile_vector vector_l2_ops) with (lists = 50);

-- Market context (SPY/QQQ) for relative move computation
create table market_context (
  id bigserial primary key,
  date date not null,
  time time not null,
  spy_open numeric(12,4),
  spy_close numeric(12,4),
  spy_pct_from_open numeric(8,4),
  spy_volume bigint,
  qqq_open numeric(12,4),
  qqq_close numeric(12,4),
  qqq_pct_from_open numeric(8,4),
  qqq_volume bigint,
  unique(date, time)
);

create index idx_market_context_date on market_context(date);

-- Insert default stock
insert into stocks (ticker, name, sector) values ('ALAB', 'Astera Labs', 'Semiconductors');
```

- [ ] **Step 2: Create Supabase client**

```typescript
// src/db/client.ts
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);
```

- [ ] **Step 3: Run migration on Supabase**

Go to Supabase Dashboard → SQL Editor → paste contents of `001_initial_schema.sql` → Run.

- [ ] **Step 4: Create .env with real credentials**

```bash
cp .env.example .env
# Edit .env with real values from Supabase dashboard and Polygon.io
```

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/001_initial_schema.sql src/db/client.ts
git commit -m "feat: add database schema with pgvector and Supabase client"
```

---

## Chunk 2: Polygon.io Client with Rate Limiting & Retry

### Task 3: Build rate-limited Polygon.io client

**Files:**
- Create: `src/polygon/types.ts`
- Create: `src/polygon/client.ts`
- Create: `tests/polygon-client.test.ts`

- [ ] **Step 1: Create Polygon API types**

```typescript
// src/polygon/types.ts
export interface PolygonBar {
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
  t: number;  // timestamp (ms)
  n: number;  // number of trades
}

export interface PolygonAggResponse {
  ticker: string;
  status: string;
  resultsCount: number;
  results: PolygonBar[];
  next_url?: string;
}
```

- [ ] **Step 2: Write tests for rate-limited client**

```typescript
// tests/polygon-client.test.ts
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

    // Fire 3 concurrent requests
    await Promise.all([
      client.request('/a'),
      client.request('/b'),
      client.request('/c'),
    ]);

    // All 3 should have completed
    expect(callOrder).toHaveLength(3);
    // Each call should be spaced by at least ~180ms (200ms target with some slack)
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
    const client = new PolygonClient('test-key', 5);
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
    const client = new PolygonClient('test-key', 5);

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
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/polygon-client.test.ts
```
Expected: FAIL — `PolygonClient` not found

- [ ] **Step 4: Implement PolygonClient with mutex queue and retry**

```typescript
// src/polygon/client.ts
import { config } from '../config.js';
import type { PolygonAggResponse } from './types.js';

export class PolygonClient {
  private apiKey: string;
  private maxRps: number;
  private maxRetries: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(apiKey?: string, maxRps?: number) {
    this.apiKey = apiKey ?? config.polygon.apiKey;
    this.maxRps = maxRps ?? config.polygon.maxRequestsPerSecond;
    this.maxRetries = config.polygon.maxRetries ?? 3;
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
        const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/polygon-client.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/polygon/ tests/polygon-client.test.ts
git commit -m "feat: add rate-limited Polygon.io client with retry and pagination warning"
```

---

## Chunk 3: Daily & Intraday Fetchers

### Task 4: Build daily candle fetcher

**Files:**
- Create: `src/fetcher/daily.ts`
- Create: `tests/daily-fetcher.test.ts`

- [ ] **Step 1: Write tests for daily fetcher**

```typescript
// tests/daily-fetcher.test.ts
import { describe, it, expect } from 'vitest';
import { transformDailyBars, computeGapPct } from '../src/fetcher/daily.js';

describe('Daily Fetcher', () => {
  it('should transform Polygon bars to daily candle records', () => {
    // 2025-11-15 12:00 UTC = 2025-11-15 07:00 ET
    const bars = [
      { o: 100, h: 110, l: 95, c: 105, v: 50000, t: 1731672000000, n: 100 },
    ];
    const result = transformDailyBars(bars, 1);
    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(100);
    expect(result[0].close).toBe(105);
    expect(result[0].stock_id).toBe(1);
    expect(result[0].date).toBe('2025-11-15');
  });

  it('should compute gap percentage correctly', () => {
    expect(computeGapPct(102, 100)).toBeCloseTo(2.0, 1);
    expect(computeGapPct(98, 100)).toBeCloseTo(-2.0, 1);
    expect(computeGapPct(100, 100)).toBe(0);
  });

  it('should return 0 gap when previous close is 0', () => {
    expect(computeGapPct(100, 0)).toBe(0);
  });

  it('should handle empty bars array', () => {
    const result = transformDailyBars([], 1);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/daily-fetcher.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement daily fetcher**

```typescript
// src/fetcher/daily.ts
import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { toETDate } from '../config.js';
import type { PolygonBar } from '../polygon/types.js';

export function computeGapPct(todayOpen: number, prevClose: number): number {
  if (prevClose === 0) return 0;
  return Number(((todayOpen - prevClose) / prevClose * 100).toFixed(4));
}

export function transformDailyBars(bars: PolygonBar[], stockId: number) {
  return bars.map(bar => ({
    stock_id: stockId,
    date: toETDate(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    gap_pct: null as number | null,
  }));
}

export async function fetchAndStoreDailyCandles(
  client: PolygonClient,
  ticker: string,
  stockId: number,
  from: string,
  to: string
): Promise<number> {
  console.log(`Fetching daily candles for ${ticker} from ${from} to ${to}...`);
  const response = await client.getAggregates(ticker, 1, 'day', from, to);

  if (!response.results?.length) {
    console.log(`No daily data for ${ticker}`);
    return 0;
  }

  const records = transformDailyBars(response.results, stockId);

  // Compute gap_pct
  for (let i = 1; i < records.length; i++) {
    records[i].gap_pct = computeGapPct(records[i].open, records[i - 1].close);
  }

  // Upsert into Supabase
  const { error } = await supabase
    .from('candles_daily')
    .upsert(records, { onConflict: 'stock_id,date' });

  if (error) throw new Error(`Failed to upsert daily candles: ${error.message}`);

  console.log(`Stored ${records.length} daily candles for ${ticker}`);
  return records.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/daily-fetcher.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/daily.ts tests/daily-fetcher.test.ts
git commit -m "feat: add daily candle fetcher with gap computation"
```

---

### Task 5: Build 15-minute intraday candle fetcher

**Files:**
- Create: `src/fetcher/intraday.ts`
- Create: `tests/intraday-fetcher.test.ts`

- [ ] **Step 1: Write tests for intraday fetcher**

```typescript
// tests/intraday-fetcher.test.ts
import { describe, it, expect } from 'vitest';
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/intraday-fetcher.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement intraday fetcher**

```typescript
// src/fetcher/intraday.ts
import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { toETDate, toETTime } from '../config.js';
import type { PolygonBar } from '../polygon/types.js';

export function classifySession(time: string): 'pre_market' | 'regular' | 'after_hours' {
  const [h, m] = time.split(':').map(Number);
  const minutes = h * 60 + m;

  if (minutes < 570) return 'pre_market';   // before 9:30
  if (minutes < 960) return 'regular';       // 9:30 - 16:00
  return 'after_hours';                       // 16:00+
}

export function computePctFromOpen(close: number, dayOpen: number): number {
  if (dayOpen === 0) return 0;
  return Number(((close - dayOpen) / dayOpen * 100).toFixed(4));
}

export async function fetchAndStoreIntradayCandles(
  client: PolygonClient,
  ticker: string,
  stockId: number,
  from: string,
  to: string
): Promise<number> {
  console.log(`Fetching 15-min candles for ${ticker} from ${from} to ${to}...`);
  const response = await client.getAggregates(ticker, 15, 'minute', from, to);

  if (!response.results?.length) {
    console.log(`No intraday data for ${ticker}`);
    return 0;
  }

  // Group bars by ET date
  const barsByDate = new Map<string, PolygonBar[]>();
  for (const bar of response.results) {
    const date = toETDate(bar.t);
    if (!barsByDate.has(date)) barsByDate.set(date, []);
    barsByDate.get(date)!.push(bar);
  }

  let totalStored = 0;

  for (const [date, bars] of barsByDate) {
    // Find regular session open (first bar at or after 9:30 ET)
    const regularBars = bars.filter(b => classifySession(toETTime(b.t)) === 'regular');
    const dayOpenPrice = regularBars.length > 0 ? regularBars[0].o : bars[0].o;

    const records = bars.map(bar => {
      const time = toETTime(bar.t);
      return {
        stock_id: stockId,
        date,
        time,
        session: classifySession(time),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        pct_from_open: computePctFromOpen(bar.c, dayOpenPrice),
        relative_move: null as number | null, // filled after market_context available
      };
    });

    const { error } = await supabase
      .from('candles_15m')
      .upsert(records, { onConflict: 'stock_id,date,time' });

    if (error) throw new Error(`Failed to upsert 15m candles for ${date}: ${error.message}`);
    totalStored += records.length;
  }

  console.log(`Stored ${totalStored} intraday candles for ${ticker}`);
  return totalStored;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/intraday-fetcher.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/intraday.ts tests/intraday-fetcher.test.ts
git commit -m "feat: add 15-min intraday candle fetcher with session classification"
```

---

### Task 6: Build market context fetcher (SPY/QQQ)

**Files:**
- Create: `src/fetcher/market-context.ts`
- Create: `tests/market-context.test.ts`

- [ ] **Step 1: Write tests for market context**

```typescript
// tests/market-context.test.ts
import { describe, it, expect } from 'vitest';
import { buildMarketRecord } from '../src/fetcher/market-context.js';

describe('Market Context', () => {
  it('should build a market record with SPY pct_from_open', () => {
    const record = buildMarketRecord({
      date: '2025-11-15',
      time: '10:00',
      spyBar: { o: 500, h: 505, l: 498, c: 503, v: 100000, t: 0, n: 0 },
      spyDayOpen: 500,
      qqqBar: { o: 400, h: 404, l: 398, c: 402, v: 80000, t: 0, n: 0 },
      qqqDayOpen: 400,
    });

    expect(record.date).toBe('2025-11-15');
    expect(record.spy_pct_from_open).toBeCloseTo(0.6, 1); // (503-500)/500 * 100
    expect(record.qqq_pct_from_open).toBeCloseTo(0.5, 1); // (402-400)/400 * 100
  });

  it('should handle missing QQQ bar', () => {
    const record = buildMarketRecord({
      date: '2025-11-15',
      time: '10:00',
      spyBar: { o: 500, h: 505, l: 498, c: 503, v: 100000, t: 0, n: 0 },
      spyDayOpen: 500,
      qqqBar: null,
      qqqDayOpen: 0,
    });

    expect(record.spy_pct_from_open).toBeCloseTo(0.6, 1);
    expect(record.qqq_pct_from_open).toBeNull();
    expect(record.qqq_open).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/market-context.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement market context fetcher**

```typescript
// src/fetcher/market-context.ts
import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { toETDate, toETTime } from '../config.js';
import { classifySession } from './intraday.js';
import type { PolygonBar } from '../polygon/types.js';

interface MarketRecordInput {
  date: string;
  time: string;
  spyBar: PolygonBar;
  spyDayOpen: number;
  qqqBar: PolygonBar | null;
  qqqDayOpen: number;
}

export function buildMarketRecord(input: MarketRecordInput) {
  const { date, time, spyBar, spyDayOpen, qqqBar, qqqDayOpen } = input;
  return {
    date,
    time,
    spy_open: spyBar.o,
    spy_close: spyBar.c,
    spy_pct_from_open: spyDayOpen > 0
      ? Number(((spyBar.c - spyDayOpen) / spyDayOpen * 100).toFixed(4))
      : 0,
    spy_volume: spyBar.v,
    qqq_open: qqqBar?.o ?? null,
    qqq_close: qqqBar?.c ?? null,
    qqq_pct_from_open: qqqBar && qqqDayOpen > 0
      ? Number(((qqqBar.c - qqqDayOpen) / qqqDayOpen * 100).toFixed(4))
      : null,
    qqq_volume: qqqBar?.v ?? null,
  };
}

function findDayOpen(bars: PolygonBar[]): number {
  const regular = bars.filter(b => classifySession(toETTime(b.t)) === 'regular');
  return regular.length > 0 ? regular[0].o : bars[0]?.o ?? 0;
}

export async function fetchAndStoreMarketContext(
  client: PolygonClient,
  from: string,
  to: string
): Promise<number> {
  console.log(`Fetching market context (SPY/QQQ) from ${from} to ${to}...`);

  // Fetch sequentially to respect rate limiter
  const spyResponse = await client.getAggregates('SPY', 15, 'minute', from, to);
  const qqqResponse = await client.getAggregates('QQQ', 15, 'minute', from, to);

  // Group SPY by date
  const spyByDate = new Map<string, PolygonBar[]>();
  for (const bar of spyResponse.results ?? []) {
    const date = toETDate(bar.t);
    if (!spyByDate.has(date)) spyByDate.set(date, []);
    spyByDate.get(date)!.push(bar);
  }

  // Index QQQ bars by date+time
  const qqqIndex = new Map<string, PolygonBar>();
  const qqqByDate = new Map<string, PolygonBar[]>();
  for (const bar of qqqResponse.results ?? []) {
    const date = toETDate(bar.t);
    const time = toETTime(bar.t);
    qqqIndex.set(`${date}_${time}`, bar);
    if (!qqqByDate.has(date)) qqqByDate.set(date, []);
    qqqByDate.get(date)!.push(bar);
  }

  const records: ReturnType<typeof buildMarketRecord>[] = [];

  for (const [date, spyBars] of spyByDate) {
    const spyDayOpen = findDayOpen(spyBars);
    const qqqDayBars = qqqByDate.get(date) ?? [];
    const qqqDayOpen = findDayOpen(qqqDayBars);

    for (const bar of spyBars) {
      const time = toETTime(bar.t);
      const qqqBar = qqqIndex.get(`${date}_${time}`) ?? null;

      records.push(buildMarketRecord({
        date, time, spyBar: bar, spyDayOpen, qqqBar, qqqDayOpen,
      }));
    }
  }

  const { error } = await supabase
    .from('market_context')
    .upsert(records, { onConflict: 'date,time' });

  if (error) throw new Error(`Failed to upsert market context: ${error.message}`);

  console.log(`Stored ${records.length} market context records`);
  return records.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/market-context.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/market-context.ts tests/market-context.test.ts
git commit -m "feat: add SPY/QQQ market context fetcher"
```

---

## Chunk 4: Day Profiles & Relative Moves

### Task 7: Build day profile computation

**Files:**
- Create: `src/fetcher/profiles.ts`
- Create: `tests/profiles.test.ts`

- [ ] **Step 1: Write tests for profile computation**

```typescript
// tests/profiles.test.ts
import { describe, it, expect } from 'vitest';
import { buildProfileVector, padVector, classifyPreMarket } from '../src/fetcher/profiles.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/profiles.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement profile computation**

```typescript
// src/fetcher/profiles.ts
import { supabase } from '../db/client.js';
import { config, isOPEX } from '../config.js';

export function buildProfileVector(candles: { pct_from_open: number }[]): number[] {
  return candles.map(c => c.pct_from_open);
}

export function padVector(vector: number[], targetLength: number): number[] {
  if (vector.length === 0) return Array(targetLength).fill(0);
  if (vector.length >= targetLength) return vector.slice(0, targetLength);
  const lastVal = vector[vector.length - 1];
  return [...vector, ...Array(targetLength - vector.length).fill(lastVal)];
}

export function classifyPreMarket(pctChange: number): 'up' | 'down' | 'flat' {
  if (pctChange > 0.25) return 'up';
  if (pctChange < -0.25) return 'down';
  return 'flat';
}

export async function computeAndStoreProfiles(
  stockId: number,
  fromDate?: string,
  toDate?: string
): Promise<number> {
  // Get dates that have regular candles
  let query = supabase
    .from('candles_15m')
    .select('date')
    .eq('stock_id', stockId)
    .eq('session', 'regular')
    .order('date');

  if (fromDate) query = query.gte('date', fromDate);
  if (toDate) query = query.lte('date', toDate);

  const { data: dateRows, error: dateError } = await query;
  if (dateError) throw dateError;

  const uniqueDates = [...new Set(dateRows?.map(r => r.date) ?? [])];
  let stored = 0;

  for (const date of uniqueDates) {
    // Get regular session candles for this day
    const { data: candles, error: candleError } = await supabase
      .from('candles_15m')
      .select('time, open, close, volume, pct_from_open, relative_move')
      .eq('stock_id', stockId)
      .eq('date', date)
      .eq('session', 'regular')
      .order('time');

    if (candleError) throw candleError;
    if (!candles?.length) continue;

    // Get pre-market candles
    const { data: preMarketCandles } = await supabase
      .from('candles_15m')
      .select('close, volume')
      .eq('stock_id', stockId)
      .eq('date', date)
      .eq('session', 'pre_market')
      .order('time');

    const dayOpen = candles[0].open;
    const dayClose = candles[candles.length - 1].close;
    const dayChangePct = dayOpen > 0 ? Number(((dayClose - dayOpen) / dayOpen * 100).toFixed(4)) : 0;

    // Profile vector
    const rawProfile = buildProfileVector(candles.map(c => ({ pct_from_open: c.pct_from_open ?? 0 })));
    const profileVector = padVector(rawProfile, config.market.candlesPerDay);

    // Relative profile vector
    const rawRelative = candles.map(c => c.relative_move ?? 0);
    const relativeVector = padVector(rawRelative, config.market.candlesPerDay);

    // Volume profile (normalized to average)
    const volumes = candles.map(c => c.volume);
    const avgVol = volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length;
    const volumeProfile = volumes.map((v: number) => avgVol > 0 ? Number((v / avgVol).toFixed(4)) : 0);

    // Pre-market analysis
    let preMarketDirection: 'up' | 'down' | 'flat' = 'flat';
    let preMarketVolumeRatio = 0;
    if (preMarketCandles?.length) {
      const pmLastClose = preMarketCandles[preMarketCandles.length - 1].close;
      const pmPct = dayOpen > 0 ? ((pmLastClose - dayOpen) / dayOpen * 100) : 0;
      preMarketDirection = classifyPreMarket(pmPct);
      const pmVol = preMarketCandles.reduce((sum: number, c: any) => sum + c.volume, 0);
      const regVol = volumes.reduce((a: number, b: number) => a + b, 0);
      preMarketVolumeRatio = regVol > 0 ? Number((pmVol / regVol).toFixed(4)) : 0;
    }

    const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay();

    const profile = {
      stock_id: stockId,
      date,
      open_price: dayOpen,
      day_change_pct: dayChangePct,
      profile_vector: `[${profileVector.join(',')}]`,
      relative_profile_vector: `[${relativeVector.join(',')}]`,
      volume_profile: volumeProfile,
      pre_market_direction: preMarketDirection,
      pre_market_volume_ratio: preMarketVolumeRatio,
      is_earnings: false, // deferred to Phase 2
      is_opex: isOPEX(date),
      day_of_week: dayOfWeek,
      candle_count: rawProfile.length,
    };

    const { error } = await supabase
      .from('day_profiles')
      .upsert(profile, { onConflict: 'stock_id,date' });

    if (error) throw new Error(`Failed to upsert profile for ${date}: ${error.message}`);
    stored++;
  }

  console.log(`Computed ${stored} day profiles for stock ${stockId}`);
  return stored;
}

export async function updateRelativeMoves(
  stockId: number,
  fromDate?: string,
  toDate?: string
): Promise<void> {
  let query = supabase
    .from('candles_15m')
    .select('id, date, time, pct_from_open')
    .eq('stock_id', stockId)
    .eq('session', 'regular');

  if (fromDate) query = query.gte('date', fromDate);
  if (toDate) query = query.lte('date', toDate);

  const { data: candles, error } = await query;
  if (error) throw error;
  if (!candles?.length) return;

  // Get market context for the date range
  const candleDates = [...new Set(candles.map(c => c.date))];
  const { data: marketData, error: mError } = await supabase
    .from('market_context')
    .select('date, time, spy_pct_from_open')
    .in('date', candleDates);

  if (mError) throw mError;

  const marketIndex = new Map<string, number>();
  for (const m of marketData ?? []) {
    marketIndex.set(`${m.date}_${m.time}`, m.spy_pct_from_open ?? 0);
  }

  // Batch update relative_move
  const updates = candles.map(candle => {
    const spyPct = marketIndex.get(`${candle.date}_${candle.time}`) ?? 0;
    return {
      id: candle.id,
      relative_move: Number(((candle.pct_from_open ?? 0) - spyPct).toFixed(4)),
    };
  });

  // Update in batches of 500
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    for (const u of batch) {
      await supabase
        .from('candles_15m')
        .update({ relative_move: u.relative_move })
        .eq('id', u.id);
    }
  }

  console.log(`Updated relative moves for ${candles.length} candles`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/profiles.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetcher/profiles.ts tests/profiles.test.ts
git commit -m "feat: add day profile computation with pgvector and relative moves"
```

---

## Chunk 5: Scripts & GitHub Actions

### Task 8: Create backfill script

**Files:**
- Create: `src/scripts/backfill.ts`

- [ ] **Step 1: Implement backfill script**

```typescript
// src/scripts/backfill.ts
import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { fetchAndStoreDailyCandles } from '../fetcher/daily.js';
import { fetchAndStoreIntradayCandles } from '../fetcher/intraday.js';
import { fetchAndStoreMarketContext } from '../fetcher/market-context.js';
import { computeAndStoreProfiles, updateRelativeMoves } from '../fetcher/profiles.js';

async function backfill() {
  const client = new PolygonClient();

  // 2 years back for robust backtesting (per spec)
  const to = new Date().toISOString().split('T')[0];
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = fromDate.toISOString().split('T')[0];

  console.log(`\n=== Backfill: ${from} to ${to} ===\n`);

  // 1. Market context first (needed for relative moves)
  console.log('--- Step 1: Market Context (SPY/QQQ) ---');
  await fetchAndStoreMarketContext(client, from, to);

  // 2. All active stocks
  const { data: stocks, error } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  if (error) throw error;
  if (!stocks?.length) {
    console.log('No active stocks found.');
    return;
  }

  for (const stock of stocks) {
    console.log(`\n--- Processing ${stock.ticker} ---`);

    console.log('Fetching daily candles...');
    await fetchAndStoreDailyCandles(client, stock.ticker, stock.id, from, to);

    console.log('Fetching 15-min candles...');
    await fetchAndStoreIntradayCandles(client, stock.ticker, stock.id, from, to);

    console.log('Computing relative moves...');
    await updateRelativeMoves(stock.id);

    console.log('Computing day profiles...');
    await computeAndStoreProfiles(stock.id);
  }

  console.log('\n=== Backfill complete ===');
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/backfill.ts
git commit -m "feat: add historical data backfill script"
```

---

### Task 9: Create daily update script

**Files:**
- Create: `src/scripts/daily-update.ts`

- [ ] **Step 1: Implement daily update script**

```typescript
// src/scripts/daily-update.ts
import { supabase } from '../db/client.js';
import { PolygonClient } from '../polygon/client.js';
import { fetchAndStoreDailyCandles } from '../fetcher/daily.js';
import { fetchAndStoreIntradayCandles } from '../fetcher/intraday.js';
import { fetchAndStoreMarketContext } from '../fetcher/market-context.js';
import { computeAndStoreProfiles, updateRelativeMoves } from '../fetcher/profiles.js';

async function dailyUpdate() {
  const client = new PolygonClient();

  // 5-day lookback to handle weekends + holidays (e.g., Thursday holiday + 3-day weekend)
  const to = new Date().toISOString().split('T')[0];
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 5);
  const from = fromDate.toISOString().split('T')[0];

  console.log(`\n=== Daily Update: ${from} to ${to} ===\n`);

  // 1. Market context
  await fetchAndStoreMarketContext(client, from, to);

  // 2. All active stocks
  const { data: stocks, error } = await supabase
    .from('stocks')
    .select('id, ticker')
    .eq('active', true);

  if (error) throw error;

  for (const stock of stocks ?? []) {
    console.log(`\nUpdating ${stock.ticker}...`);
    await fetchAndStoreDailyCandles(client, stock.ticker, stock.id, from, to);
    await fetchAndStoreIntradayCandles(client, stock.ticker, stock.id, from, to);
    await updateRelativeMoves(stock.id, from, to);
    await computeAndStoreProfiles(stock.id, from, to);
  }

  console.log('\n=== Daily update complete ===');
}

dailyUpdate().catch(err => {
  console.error('Daily update failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/daily-update.ts
git commit -m "feat: add daily data update script with 5-day lookback"
```

---

### Task 10: Create GitHub Actions workflow

**Files:**
- Replace: `.github/workflows/update-data.yml` → `.github/workflows/daily-update.yml`

- [ ] **Step 1: Remove old workflow and create new one**

```bash
git rm .github/workflows/update-data.yml
```

Create `.github/workflows/daily-update.yml`:

```yaml
name: Daily Data Update

on:
  schedule:
    # Run at 9:30 PM UTC (after US market close) on weekdays
    - cron: '30 21 * * 1-5'
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run daily update
        env:
          POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: npm run daily-update
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/
git commit -m "feat: replace old workflow with TypeScript daily-update pipeline"
```

---

### Task 11: Clean up old Python files

**Files:**
- Remove: `scripts/fetch_data.py`
- Remove: `scripts/analyze_patterns.py`
- Remove: `scripts/pattern_discovery.py`
- Remove: `scripts/requirements.txt`

- [ ] **Step 1: Remove old Python scripts**

```bash
git rm scripts/fetch_data.py scripts/analyze_patterns.py scripts/pattern_discovery.py scripts/requirements.txt
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove old Python scripts, replaced by TypeScript pipeline"
```

---

### Task 12: Run backfill and verify

- [ ] **Step 1: Set up .env with real credentials**

```bash
cp .env.example .env
# Fill in POLYGON_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
```

- [ ] **Step 2: Run the Supabase migration**

Go to Supabase Dashboard → SQL Editor → paste `src/db/migrations/001_initial_schema.sql` → Run.

- [ ] **Step 3: Run all tests**

```bash
npm test
```
Expected: All tests PASS

- [ ] **Step 4: Run backfill**

```bash
npm run backfill
```

Expected output:
```
=== Backfill: 2024-03-16 to 2026-03-16 ===
--- Step 1: Market Context (SPY/QQQ) ---
Stored XXXX market context records
--- Processing ALAB ---
Fetching daily candles...
Stored ~500 daily candles for ALAB
Fetching 15-min candles...
Stored ~13000 intraday candles for ALAB
Computing relative moves...
Updated relative moves for XXXX candles
Computing day profiles...
Computed ~500 day profiles for stock 1
=== Backfill complete ===
```

- [ ] **Step 5: Verify data in Supabase Dashboard**

Check in Supabase Table Editor:
- `stocks`: 1 row (ALAB)
- `candles_daily`: ~500 rows
- `candles_15m`: ~13,000 rows
- `day_profiles`: ~500 rows
- `market_context`: ~13,000 rows

- [ ] **Step 6: Create pgvector indexes (data must exist first)**

Run in Supabase SQL Editor:
```sql
create index idx_profile_vector on day_profiles
  using ivfflat (profile_vector vector_l2_ops) with (lists = 50);
create index idx_relative_profile_vector on day_profiles
  using ivfflat (relative_profile_vector vector_l2_ops) with (lists = 50);
```

- [ ] **Step 7: Set GitHub Actions secrets**

Go to repo Settings → Secrets → Actions → Add:
- `POLYGON_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

- [ ] **Step 8: Push everything**

```bash
git push origin main
```
