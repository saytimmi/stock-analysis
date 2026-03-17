# Stock Pattern Analyzer — Telegram Mini App

## Overview

Telegram Mini App for ALAB stock pattern visualization with real-time signals, pattern library, and trade levels. Works alongside existing Telegram bot (Grammy + Claude) for custom pattern creation via dialogue.

## Architecture

```
Telegram Mini App (React + Vite)
    ↓ API calls
Supabase Edge Functions
    ↓ queries
Supabase DB (PostgreSQL + pgvector)  ← existing
    ↑ writes
Pattern Engine (extended src/patterns/)
    ↑ data
Polygon API  ← existing

Telegram Bot (Grammy + Claude)  ← existing, extended
    ↓ saves custom patterns
Supabase DB
```

**Stack:** React, Vite, TypeScript, @telegram-apps/sdk-react v2, lightweight-charts (TradingView), Vercel deploy

## Screens

### Tab 1: "Сейчас" (main)
- Ticker selector (ALAB default), market status
- Price hero: current price, change, OHLC, gap
- Market context row: SPY, QQQ, SOXX, VIX
- Earnings context: days until/since earnings, quarter phase
- **Live signal block:**
  - What happened today (gap, dip, rally — narrative)
  - Matched pattern with % confidence
  - Phase progress bar (Dip ✓ → Rally ✓ → Retest ◄ → Close)
  - Trade levels from current price: TP2, TP1, HERE, Open, STOP
  - R:R ratio, win rate, risk metrics
  - Context tags: trend, sector, VIX, volume, quarter
  - Deep link to bot for detailed Q&A
- Active pattern cards (sorted by match %)

### Tab 2: "Паттерны" (library)
- Chip filters: All, System, My, Pre/Post-earnings, Multi-day
- Sort by: accuracy, R:R, frequency
- Library cards per pattern:
  - Name + timeframe
  - Sparkline with phase annotations on chart
  - Plain-language explanation (like explaining to a beginner)
  - 4 key metrics: Win rate, Avg move, R:R, sample size
  - Tags: type, earnings phase, best quarters
- Click → detail overlay
- CTA: "Describe new pattern to bot"

### Pattern detail overlay
- Hero stats: win rate, avg return, sample count, confidence grade
- Average day profile chart with ±1 std band, phase zones annotated
- Step-by-step timeline (4 phases with times, descriptions, examples)
- **Trade levels:** TP2, TP1, Entry, Stop — calculated from today's open
- **R:R box + timing:** when to enter, where stop, partial take, trailing
- **Expectancy:** dollar value per $100
- **Fail analysis:** why pattern fails, % breakdown of reasons
- **Conditions:** what must be true for pattern to trigger
- Detailed stats grid (6 metrics)
- Breakdown by: earnings phase, quarter (Q1-Q4), day of week
- Example days (best, typical, worst) with mini charts + tags
- Disclaimer

### Tab 3: "История"
- Calendar view (Mon-Fri grid), green/red dots per day
- Win rate summary for the month
- Day detail cards: OHLC, matched pattern, prediction vs actual

### Tab 4: "Ещё"
- Ticker management (add/remove)
- Pattern counts (system vs custom)
- Links: create pattern (bot), backtest
- App version

## Patterns (8 discovered)

| # | Pattern | Type | Timeframe | Win | Avg | Phase |
|---|---------|------|-----------|-----|-----|-------|
| 1 | Morning Dip → Rally | Intraday | 15m | 73% | +2.1% | Any |
| 2 | Gap Up Fade | Intraday | 15m | 68% | -1.4% | Post-ER |
| 3 | VWAP Reclaim | Intraday | 15m | 65% | +1.8% | Any |
| 4 | Volume Spike Breakout | Intraday | 15m | 62% | +3.1% | Pre-ER |
| 5 | Mean Reversion 3-Day | Multi-day | Daily | 70% | +1.6% | Mid-Q |
| 6 | Post-Earnings Drift | Multi-day | Daily | 66% | +2.8% | Post-ER |
| 7 | Дип 1% → ралли (user) | Intraday | 15m | 71% | +2.3% | Any |
| 8 | Пт → Пн Gap (user) | Multi-day | Daily | 64% | +0.7% | Mid-Q |

## Custom patterns flow (via bot)

1. User describes pattern in Russian text
2. Claude asks clarifying questions (timeframe, thresholds, conditions)
3. Claude formalizes into rules
4. System backtests against historical data
5. Shows results: win rate, sample size, examples
6. User approves → saved to DB, appears in Mini App library

## DB changes needed

New tables:
- `pattern_catalog` — discovered and user patterns with rules, stats
- `pattern_signals` — daily signals (which patterns matched, confidence)
- `trade_levels` — computed entry/stop/TP per pattern per day

## Telegram Mini App specifics

- Theme: `--tg-theme-*` CSS variables (auto light/dark)
- Haptic feedback on all taps
- Safe areas: `env(safe-area-inset-*)`
- BackButton: native Telegram on nested views
- CloudStorage: user preferences
- `disableVerticalSwipes()` where needed
- Deploy: Vercel, registered as Mini App via BotFather

## Multi-ticker support

- DB already supports multiple stocks via `stock_id`
- Ticker selector in header
- Adding a ticker: triggers backfill + pattern discovery pipeline
- Each ticker has independent pattern catalog

## Prototype

Working HTML prototype: `prototype/index.html`
