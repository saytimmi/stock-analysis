# Trading Intelligence System — Design Spec

## Overview

An evolutionary trading intelligence system that discovers, validates, tracks, and retires intraday stock patterns. The system automates what was previously done manually — recognizing similar historical intraday situations and predicting likely outcomes based on statistical probability.

**Core principle:** The system always finds the closest historical analogs. It never says "I don't know." There is always a similar day — the question is only the degree of similarity.

**Core edge:** Not any single pattern, but the machine that manages the lifecycle of all patterns — discovering, validating, monitoring, and retiring them automatically.

---

## Architecture: 5 Layers

```
┌─────────────────────────────────────────────────┐
│  Layer 5: DECISION (user)                       │
│  Telegram — receive signals, make decisions      │
├─────────────────────────────────────────────────┤
│  Layer 4: INTELLIGENCE (3 agents)               │
│  Trader → Auditor → Meta-Analyst                │
├─────────────────────────────────────────────────┤
│  Layer 3: SCORING & HISTORICAL ANALOGS          │
│  Composite Score + similar historical days       │
├─────────────────────────────────────────────────┤
│  Layer 2: PATTERN LIFECYCLE                     │
│  Discovery → Backtest → Validate → Live → Decay │
├─────────────────────────────────────────────────┤
│  Layer 1: DATA FOUNDATION                       │
│  Polygon.io → Supabase PostgreSQL               │
└─────────────────────────────────────────────────┘
```

---

## Layer 1: Data Foundation

### Data Sources

| Data | Source | Frequency | Purpose |
|------|--------|-----------|---------|
| 15-min candles (1+ year) | Polygon.io | Daily after close | Core pattern data |
| Daily OHLCV | Polygon.io | Daily after close | Big picture context |
| Pre-market data | Polygon.io | Real-time during session | Predict open behavior |
| SPY/QQQ candles | Polygon.io | Parallel with each stock | Isolate stock vs market moves |
| Earnings calendar | External API | Weekly | Context for anomalous days |
| OPEX dates | Static calendar | Monthly | Options expiration context |

### Data Storage (Supabase PostgreSQL)

**Tables:**

`stocks` — registered stocks
- id, ticker, name, sector, added_at, active

`candles_15m` — 15-minute intraday candles
- id, stock_id, date, time, open, high, low, close, volume, pct_from_open, relative_move (vs SPY)

`candles_daily` — daily OHLCV
- id, stock_id, date, open, high, low, close, volume, gap_pct (vs prev close)

`day_profiles` — computed daily profile
- id, stock_id, date, open_price, day_change_pct, profile_vector (array of pct_from_open), volume_profile, pre_market_direction, pre_market_volume, is_earnings, is_opex, day_of_week

`market_context` — SPY/QQQ data for the same period
- id, date, time, spy_pct_from_open, qqq_pct_from_open, spy_volume

### Key Computation: Relative Move

For every 15-min candle, compute:
```
relative_move = stock_pct_from_open - spy_pct_from_open
```
This isolates the stock's own behavior from market-wide movement.

---

## Layer 2: Pattern Lifecycle

### Pattern Types

1. **Mean Reversion** — stock pumps X% from open → reverts Y% with Z% probability
2. **Momentum Continuation** — strong move in first hour continues through the day
3. **Gap Behavior** — gap up/down on open → gap fills or extends
4. **Time-of-Day** — morning pump, lunch dip, power hour tendencies
5. **Volume Anomaly** — abnormal volume in first hour predicts larger moves
6. **Pre-market Signal** — pre-market direction/volume predicts first 30 min
7. **Multi-timeframe Confluence** — pattern visible on 15m + 30m + 1h = stronger signal
8. **Cluster Patterns** — ML-driven grouping of similar days (not just threshold-based)

### Lifecycle Stages

```
DISCOVERED → BACKTESTED → VALIDATED → LIVE → MONITORED → DEGRADED → RETIRED
```

**Discovery:** Algorithms scan historical data for recurring conditional probabilities.

**Backtesting:**
- Walk-forward: train on 6 months, test on next 3 months
- Minimum 15 occurrences
- Statistical significance: p-value < 0.05
- Expected Value must be positive: (win_rate × avg_win) - (loss_rate × avg_loss) > 0
- If EV negative → pattern rejected

**Validation:** Pattern passed backtesting. Paper trading for 2 weeks — system tracks predictions but doesn't surface them as signals yet.

**Live:** Pattern is active, contributes to composite score and signals.

**Monitored:** Rolling 30-day accuracy tracked continuously.

**Degraded:** Accuracy drops below threshold → pattern weight reduced automatically.

**Retired:** Accuracy doesn't recover within 2 weeks → archived. Can be re-discovered if conditions change.

### Storage

`patterns` — all discovered patterns
- id, stock_id, type, description, parameters (JSON), lifecycle_stage, discovered_at, last_validated
- occurrences, win_rate, avg_win, avg_loss, expected_value, p_value
- accuracy_30d, accuracy_trend (improving/stable/degrading)

`pattern_events` — each time a pattern triggered
- id, pattern_id, date, trigger_value, predicted_outcome, actual_outcome, was_correct

---

## Layer 3: Scoring & Historical Analogs

### Historical Analogs (Core Feature)

When the user asks "look at ALAB right now", the system:

1. Takes current day's data (all 15-min candles so far)
2. Computes the current profile: pct_from_open at each candle, volume, speed of move, relative_move vs SPY
3. Searches ALL historical days for the closest matches
4. **Always returns results** — there is always a closest match, never "no data"

**Similarity factors and weights:**

| Factor | Weight | Description |
|--------|--------|-------------|
| % from open profile | High | Shape of the intraday curve so far |
| Volume vs average | Medium | Is today's volume similar? |
| Speed of move | Medium | Sharp drop vs gradual drift |
| Market direction (SPY) | Medium | Is the market doing the same thing? |
| Relative move | High | Stock's own move after removing market |
| Day of week | Low | Monday vs Friday characteristics |
| Pre-market behavior | Medium | Similar pre-market setup? |

**For each analog day, show:**
- Date and how similar it was (similarity score)
- What happened for the rest of the day (full profile)
- How much could have been earned (optimal long/short entry)
- Where the reversal happened (candle number and time)
- What the optimal stop-loss would have been

**Output example:**
```
📊 ALAB now: -2.3% from open, 45 min in, volume 2.1x avg

Similar days:
1. 2025-11-14 — opened -2.1%, vol 1.9x → reversed to -0.8% within 1h → closed +0.3%
2. 2025-09-22 — opened -2.5%, vol 2.3x → continued to -3.1% → closed -1.2%
3. 2026-01-08 — opened -2.0%, vol 1.7x → reversed to -1.1% → closed -0.5%

5 of 7 similar days reversed upward.
Avg reversal: +1.5% from current level.
Avg time to reversal: 35 min.
Suggested stop-loss: -3.5% from open.
```

### Composite Score

Combines all signals into one score:

```
Composite Score = Σ (signal_weight × signal_confidence × pattern_accuracy_30d)
```

**Signal sources:**
- Intraday pattern match (primary)
- Volume confirmation (+/- weight)
- Market correlation (SPY doing the same? reduce weight)
- Multi-timeframe confirmation (15m + 1h agree? boost)
- Pre-market context
- Calendar context (earnings? OPEX?)
- Historical pattern accuracy

**Output:**
- Score: -100 to +100 (strong sell ↔ strong buy)
- Confidence: low / medium / high
- Risk/reward ratio
- Recommended stop-loss
- Expected value in %

### Predictions Tracking

`predictions` — every prediction the system makes
- id, stock_id, timestamp, composite_score, predicted_direction, predicted_magnitude
- pattern_ids (which patterns contributed)
- analog_dates (which historical days matched)
- actual_outcome (filled after market close)
- was_correct, profit_if_followed

This creates a feedback loop: the system's own accuracy is continuously measured.

---

## Layer 4: Intelligence — 3 AI Agents

### Agent 1: Trader

**Role:** Interprets signals, answers real-time queries in Telegram, gives trading recommendations.

**System prompt framework:**
- "You are an experienced intraday trader. You trade probabilities, not certainties."
- "Always show historical analogs. Always give a risk/reward assessment."
- "Never say 'I don't know.' There is always a closest pattern."
- Has access to: current candles, patterns, composite score, historical analogs

**Triggers:** On-demand via Telegram messages

### Agent 2: Auditor

**Role:** Validates pattern quality, finds calculation errors, tracks degradation.

**System prompt framework:**
- "You are a statistics skeptic. Your job is to disprove every pattern."
- "Look for confounding variables, survivorship bias, overfitting."
- "Check if a pattern's edge is real or just noise."
- Has access to: all pattern data, prediction history, accuracy trends

**Triggers:** Daily after market close (automated)

**Outputs:**
- Pattern accuracy report
- Degradation warnings
- Recommendations to retire or re-validate patterns
- Error reports if calculations seem wrong

### Agent 3: Meta-Analyst

**Role:** Sees everything from above. Finds what the other two missed — new correlations, cross-stock patterns, systemic issues.

**System prompt framework:**
- "You are a market researcher. Look at the data without the bias of the previous agents."
- "Search for what wasn't searched for. Find cross-stock correlations, new pattern types, regime changes."
- Has access to: all data, all agent outputs, all pattern history

**Triggers:** Weekly (automated)

**Outputs:**
- New pattern hypotheses
- Cross-stock correlation discoveries
- Regime change detection (market behavior shifted)
- System-level recommendations

### Agent Communication

Agents write their findings to Supabase:

`agent_reports`
- id, agent_type, stock_id (nullable), report_date, report_type, content (JSON), actionable_items

Trader sees Auditor's latest reports. Meta-Analyst sees both. Chain of increasing context.

---

## Layer 5: Decision Interface

### Telegram Bot

**Commands:**
- `ALAB` or `ALAB MICRON` — current analysis with analogs and composite score
- `patterns ALAB` — list all active patterns with accuracy stats
- `report` — daily summary of what worked and what didn't
- `add NVDA` → directs to web dashboard

**Automatic alerts:**
- Pattern triggered with high confidence: "ALAB: pattern X triggered (78% accuracy), score +72, 5 similar days reversed here"
- Daily end-of-day report: predictions vs reality
- Weekly Auditor/Meta-Analyst insights

### Web Dashboard (Next.js on Vercel)

**Pages:**
- **Stock List** — all tracked stocks, quick stats, add/remove
- **Stock Detail** — all patterns for a stock: lifecycle stage, accuracy, EV, occurrence count
- **Pattern Detail** — deep dive into one pattern: every historical event, backtest results, accuracy over time
- **Predictions Log** — what was predicted vs what happened, running accuracy
- **Agent Reports** — latest findings from Auditor and Meta-Analyst
- **System Health** — overall accuracy, number of live patterns, degradation alerts

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Database | Supabase PostgreSQL |
| Data collection | Supabase Edge Functions (Deno/TypeScript) |
| Pattern analysis | Supabase Edge Functions |
| AI Agents | Claude API (claude-sonnet-4-6 for Trader, claude-opus-4-6 for Auditor/Meta-Analyst) |
| Telegram Bot | Supabase Edge Function + Telegram Bot API |
| Web Dashboard | Next.js 14 on Vercel |
| Market Data | Polygon.io REST API |
| Scheduling | Supabase pg_cron or GitHub Actions |
| Hosting | Vercel (web) + Supabase (everything else) |

---

## Constraints & Principles

1. **Always find analogs** — the system never returns "no data." There is always a closest match.
2. **Trade probabilities** — every output includes probability, not certainty.
3. **Self-correcting** — patterns that stop working are automatically demoted.
4. **Skepticism built in** — Auditor actively tries to disprove patterns.
5. **Relative moves** — always factor out market movement to see the stock's true behavior.
6. **No hallucination** — agents only reference real historical data, never fabricate analogs.
7. **Risk first** — every signal includes stop-loss and worst-case scenario from historical data.
