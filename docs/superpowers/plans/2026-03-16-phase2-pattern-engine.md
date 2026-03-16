# Phase 2: Pattern Engine — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pattern discovery engine that finds, backtests, validates, and manages the lifecycle of intraday trading patterns. After this phase, the system automatically identifies statistically significant patterns for any tracked stock.

**Architecture:** TypeScript modules that run via GitHub Actions after daily data updates. Pattern discovery scans day_profiles and candles for conditional probabilities. Backtester validates patterns using rolling walk-forward windows. Lifecycle manager tracks accuracy and auto-retires degraded patterns. Multi-timeframe analysis aggregates 15-min candles into 30-min and 1-hour views.

**Tech Stack:** TypeScript, Supabase PostgreSQL, vitest

**Spec:** `docs/superpowers/specs/2026-03-16-trading-intelligence-system-design.md`

---

## File Structure

```
src/
├── patterns/
│   ├── types.ts              # Pattern type definitions
│   ├── discovery/
│   │   ├── mean-reversion.ts  # "After X% move, reverts Y%"
│   │   ├── momentum.ts        # "Strong first hour → continues"
│   │   ├── gap.ts             # "Gap up/down → fills or extends"
│   │   ├── time-of-day.ts     # "Morning pump, lunch dip, power hour"
│   │   ├── volume.ts          # "Abnormal volume → big move"
│   │   └── runner.ts          # Orchestrates all discovery modules
│   ├── backtest.ts            # Walk-forward backtesting engine
│   ├── lifecycle.ts           # Pattern lifecycle management
│   └── multi-timeframe.ts     # Aggregate 15m → 30m, 1h candles
├── db/
│   └── migrations/
│       └── 002_patterns_schema.sql
└── scripts/
    └── discover-patterns.ts   # Run pattern discovery + backtest
tests/
├── mean-reversion.test.ts
├── momentum.test.ts
├── backtest.test.ts
├── lifecycle.test.ts
└── multi-timeframe.test.ts
```

---

## Task 1: Database schema for patterns

**Files:**
- Create: `src/db/migrations/002_patterns_schema.sql`

- [ ] **Step 1: Create migration**

```sql
-- Discovered patterns
create table patterns (
  id serial primary key,
  stock_id integer not null references stocks(id),
  type text not null,
  source text not null default 'algorithmic' check (source in ('algorithmic', 'user')),
  description text not null,
  parameters jsonb not null,
  lifecycle_stage text not null default 'discovered'
    check (lifecycle_stage in ('discovered', 'backtested', 'validated', 'live', 'monitored', 'degraded', 'retired')),
  discovered_at timestamptz default now(),
  last_validated timestamptz,
  retired_at timestamptz,
  occurrences integer default 0,
  win_rate numeric(5,2),
  avg_win numeric(8,4),
  avg_loss numeric(8,4),
  expected_value numeric(8,4),
  p_value numeric(8,6),
  accuracy_30d numeric(5,2),
  accuracy_trend text check (accuracy_trend in ('improving', 'stable', 'degrading'))
);

create index idx_patterns_stock on patterns(stock_id);
create index idx_patterns_stage on patterns(lifecycle_stage);

-- Each time a pattern triggered historically or in live
create table pattern_events (
  id bigserial primary key,
  pattern_id integer not null references patterns(id),
  date date not null,
  trigger_candle smallint,
  trigger_value numeric(8,4),
  predicted_direction text check (predicted_direction in ('up', 'down')),
  predicted_magnitude numeric(8,4),
  actual_outcome numeric(8,4),
  was_correct boolean,
  profit_pct numeric(8,4)
);

create index idx_pattern_events_pattern on pattern_events(pattern_id);
create index idx_pattern_events_date on pattern_events(date);
```

- [ ] **Step 2: Apply migration to Supabase**
- [ ] **Step 3: Commit**

---

## Task 2: Pattern type definitions & multi-timeframe

**Files:**
- Create: `src/patterns/types.ts`
- Create: `src/patterns/multi-timeframe.ts`
- Create: `tests/multi-timeframe.test.ts`

- [ ] **Step 1: Create pattern types**

Pattern types, discovery result interface, backtest result interface.

- [ ] **Step 2: Write multi-timeframe tests**

Test aggregation: 2×15min → 1×30min, 4×15min → 1×1h candle. Verify OHLCV aggregation rules (open=first.open, high=max, low=min, close=last.close, volume=sum).

- [ ] **Step 3: Implement multi-timeframe aggregation**
- [ ] **Step 4: Commit**

---

## Task 3: Mean reversion pattern discovery

**Files:**
- Create: `src/patterns/discovery/mean-reversion.ts`
- Create: `tests/mean-reversion.test.ts`

Core pattern: "If stock moves X% from open by candle N, it reverts Y% by candle M with Z% probability."

- [ ] **Step 1: Write tests** — test with mock candle data, verify pattern detection
- [ ] **Step 2: Implement** — scan all day profiles, find trigger→outcome pairs
- [ ] **Step 3: Commit**

---

## Task 4: Momentum & gap pattern discovery

**Files:**
- Create: `src/patterns/discovery/momentum.ts`
- Create: `src/patterns/discovery/gap.ts`
- Create: `tests/momentum.test.ts`

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Implement momentum** — "strong first hour continues" patterns
- [ ] **Step 3: Implement gap** — "gap fills or extends" patterns using candles_daily gap_pct
- [ ] **Step 4: Commit**

---

## Task 5: Time-of-day & volume pattern discovery

**Files:**
- Create: `src/patterns/discovery/time-of-day.ts`
- Create: `src/patterns/discovery/volume.ts`

- [ ] **Step 1: Implement time-of-day** — morning pump, lunch dip, power hour stats
- [ ] **Step 2: Implement volume** — abnormal first-hour volume → movement prediction
- [ ] **Step 3: Commit**

---

## Task 6: Backtesting engine

**Files:**
- Create: `src/patterns/backtest.ts`
- Create: `tests/backtest.test.ts`

Rolling walk-forward: train 4 months, test 1 month, roll forward. Minimum 30 occurrences. Binomial test for significance. EV calculation.

- [ ] **Step 1: Write tests** — test walk-forward splits, p-value calculation, EV
- [ ] **Step 2: Implement backtester**
- [ ] **Step 3: Commit**

---

## Task 7: Pattern lifecycle manager

**Files:**
- Create: `src/patterns/lifecycle.ts`
- Create: `tests/lifecycle.test.ts`

Manage transitions: discovered → backtested → validated → live → monitored → degraded → retired. Track rolling 30-day accuracy. Auto-retire when accuracy drops.

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Implement lifecycle manager**
- [ ] **Step 3: Commit**

---

## Task 8: Discovery runner & script

**Files:**
- Create: `src/patterns/discovery/runner.ts`
- Create: `src/scripts/discover-patterns.ts`

Orchestrates all discovery modules, runs backtest, stores results.

- [ ] **Step 1: Implement runner** — calls all discovery modules, deduplicates
- [ ] **Step 2: Create script** — CLI entry point
- [ ] **Step 3: Add to package.json scripts** — `"discover": "tsx src/scripts/discover-patterns.ts"`
- [ ] **Step 4: Update GitHub Actions** — run after daily-update
- [ ] **Step 5: Run discovery on ALAB data**
- [ ] **Step 6: Commit and push**
