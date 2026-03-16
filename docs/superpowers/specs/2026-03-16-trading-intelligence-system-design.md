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
| Pre-market data (4:00-9:30 ET) | Polygon.io | Real-time during session | Predict open behavior |
| SPY/QQQ candles | Polygon.io | Parallel with each stock | Isolate stock vs market moves |
| Earnings calendar | Polygon.io reference data | Weekly | Context for anomalous days |
| OPEX dates | Static calendar (3rd Friday each month) | Monthly | Options expiration context |

### Polygon.io API Plan & Rate Limits

**Plan:** Stocks Starter ($29/mo) — unlimited historical data, 5 API calls/second.

**Rate limiting strategy:**
- Queue-based fetcher: all API calls go through a single queue with 200ms spacing
- Historical backfill: run overnight, one stock at a time
- Real-time queries: cached for 1 minute per stock (Telegram asks for ALAB twice in 30 seconds → second call uses cache)
- Estimated usage: 10 stocks × ~20 calls/day (daily update) = 200 calls. Well within limits.
- SPY/QQQ fetched once, shared across all stocks.

**Estimated stock universe:** Start with 5-10 stocks, scale to 30 max. System supports unlimited but API costs and compute scale linearly.

### Data Storage (Supabase PostgreSQL)

**Tables:**

`stocks` — registered stocks
- id, ticker, name, sector, added_at, active

`candles_15m` — 15-minute intraday candles
- id, stock_id, date, time, session (pre_market | regular | after_hours), open, high, low, close, volume, pct_from_open, relative_move (vs SPY)
- **Indexes:** (stock_id, date), (stock_id, date, session)

`candles_daily` — daily OHLCV
- id, stock_id, date, open, high, low, close, volume, gap_pct (vs prev close)
- **Index:** (stock_id, date)

`day_profiles` — computed daily profile
- id, stock_id, date, open_price, day_change_pct, profile_vector (float[] — used with pgvector for similarity search), volume_profile (float[]), pre_market_direction, pre_market_volume_ratio, is_earnings, is_opex, day_of_week, relative_profile_vector (float[] — after removing SPY)
- **Index:** (stock_id, date)
- **pgvector index:** ivfflat on profile_vector and relative_profile_vector for fast similarity search

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

### Pattern Sources

Patterns enter the system from two paths:

**A. Algorithmic Discovery** — system scans historical data automatically
**B. User-Submitted Hypotheses** — user describes a pattern via Telegram (e.g., "check if ALAB drops 2%+ in first 30min, does it bounce 1%+ within the next hour?"). The system:
1. Parses the hypothesis into testable parameters
2. Runs it through the same backtesting pipeline as algorithmic patterns
3. Reports results back to user in Telegram
4. If the pattern passes validation → automatically added to the pattern library and web dashboard
5. Tagged as `source: user` to distinguish from algorithmic discoveries

### Pattern Types

1. **Mean Reversion** — stock pumps X% from open → reverts Y% with Z% probability
2. **Momentum Continuation** — strong move in first hour continues through the day
3. **Gap Behavior** — gap up/down on open → gap fills or extends
4. **Time-of-Day** — morning pump, lunch dip, power hour tendencies
5. **Volume Anomaly** — abnormal volume in first hour predicts larger moves
6. **Pre-market Signal** — pre-market direction/volume predicts first 30 min
7. **Multi-timeframe Confluence** — pattern visible on 15m + 30m + 1h = stronger signal
8. **Cluster Patterns** — ML-driven grouping of similar days (not just threshold-based)
9. **User Hypotheses** — manually submitted patterns that passed backtesting

### Lifecycle Stages

```
DISCOVERED/SUBMITTED → BACKTESTED → VALIDATED → LIVE → MONITORED → DEGRADED → RETIRED
```

**Discovery/Submission:** Algorithms scan historical data, or user submits a hypothesis.

**Backtesting:**
- Rolling walk-forward: train on 4 months, test on 1 month, roll forward by 1 month. This produces multiple test windows, not a single split.
- Minimum 30 occurrences (to ensure statistical power)
- Statistical test: binomial test for win rate, t-test on returns
- p-value < 0.05
- Expected Value must be positive: (win_rate × avg_win) - (loss_rate × avg_loss) > 0
- If EV negative → pattern rejected
- **Requires 2+ years of data per stock for robust backtesting.** For newly added stocks with <2 years, patterns are marked as `low_confidence` until enough data accumulates.

**Validation:** Pattern passed backtesting. Paper trading for 2 weeks — system tracks predictions but doesn't surface them as signals yet.

**Live:** Pattern is active, contributes to composite score and signals.

**Monitored:** Rolling 30-day accuracy tracked continuously.

**Degraded:** Accuracy drops below threshold → pattern weight reduced automatically.

**Retired:** Accuracy doesn't recover within 2 weeks → archived. **Re-discovery requires evidence on NEW post-retirement data only** — the system will not re-validate on the same historical data that originally produced the pattern.

### Storage

`patterns` — all discovered patterns
- id, stock_id, type, source (algorithmic | user), description, parameters (JSON), lifecycle_stage, discovered_at, last_validated, retired_at (nullable)
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

### Similarity Algorithm

**Distance metric:** Weighted combination of DTW (Dynamic Time Warping) and Euclidean distance.

- **Profile similarity (weight 0.35):** DTW distance between current partial profile vector and the first N candles of each historical day. DTW handles slight time shifts (pattern happened 1 candle earlier/later).
- **Relative profile similarity (weight 0.25):** Same DTW on relative_profile_vector (after removing SPY). This catches stock-specific patterns.
- **Volume similarity (weight 0.15):** Euclidean distance between volume_profile vectors (normalized to average volume).
- **Move speed (weight 0.10):** Compare max delta between consecutive candles — captures "sharp drop" vs "gradual drift".
- **Market context (weight 0.10):** Euclidean distance between SPY profiles on both days.
- **Calendar similarity (weight 0.05):** Same day of week = 0 distance, different = 1. OPEX/earnings match = 0 distance.

**Combined similarity score:**
```
similarity = 1 / (1 + weighted_distance)
```
Range: 0 to 1, where 1 = identical day.

**Partial-day matching:** Current day has N candles out of 26. Only compare the first N candles of historical days. After computing similarity on the matched portion, use the remaining candles (N+1 to 26) of historical days as the prediction.

**Implementation:** pgvector for fast approximate nearest neighbor search on profile vectors, with DTW refinement on the top 50 candidates.

**For each analog day, show:**
- Date and similarity score (0-1)
- What happened for the rest of the day (full profile)
- How much could have been earned (optimal long/short entry)
- Where the reversal happened (candle number and time)
- What the optimal stop-loss would have been

**Output example:**
```
ALAB now: -2.3% from open, 45 min in, volume 2.1x avg

Similar days (similarity score):
1. 2025-11-14 (0.91) — opened -2.1%, vol 1.9x → reversed to -0.8% in 1h → closed +0.3%
2. 2025-09-22 (0.85) — opened -2.5%, vol 2.3x → continued to -3.1% → closed -1.2%
3. 2026-01-08 (0.82) — opened -2.0%, vol 1.7x → reversed to -1.1% → closed -0.5%

5 of 7 similar days reversed upward.
Avg reversal: +1.5% from current level.
Avg time to reversal: 35 min.
Suggested stop-loss: -3.5% from open.
Risk/reward: 1:2.5
```

### Composite Score

Combines all signals into one score:

```
raw_score = Σ (signal_weight × signal_value × pattern_accuracy_30d)
Composite Score = clamp(raw_score / normalization_factor, -100, +100)
```

**Signal weights (default, tunable per stock):**

| Signal | Weight | Value calculation |
|--------|--------|-------------------|
| Historical analog consensus | 0.30 | (bullish_analogs - bearish_analogs) / total_analogs × 100 |
| Active pattern signals | 0.25 | Sum of pattern directions weighted by their individual accuracy |
| Volume confirmation | 0.15 | +1 if volume supports direction, -1 if contradicts |
| Market correlation | -0.10 | Reduce score if SPY is doing the same thing (not stock-specific) |
| Multi-timeframe confirmation | 0.10 | +1 if 15m and 1h agree, 0 if neutral |
| Pre-market context | 0.05 | Pre-market direction alignment |
| Calendar context | 0.05 | Earnings/OPEX adjustment |

**Normalization factor:** Sum of absolute weights × 100 = maximum possible raw score. This ensures the output is always in [-100, +100].

**Confidence level:**
- High: 5+ analog days with similarity > 0.80, 3+ patterns agree
- Medium: 3+ analog days with similarity > 0.70, 1+ patterns agree
- Low: fewer than above

**Output:**
- Score: -100 to +100 (strong sell <-> strong buy)
- Confidence: low / medium / high
- Risk/reward ratio
- Recommended stop-loss (based on worst analog outcome)
- Expected value in %

### Predictions Tracking

`predictions` — every prediction the system makes
- id, stock_id, timestamp, composite_score, confidence, predicted_direction, predicted_magnitude
- pattern_ids (which patterns contributed)
- analog_dates (which historical days matched)
- actual_outcome (filled automatically after market close)
- was_correct, profit_if_followed

This creates a feedback loop: the system's own accuracy is continuously measured.

---

## Layer 4: Intelligence — 3 AI Agents

### Token Budget & Cost Management

**Estimated cost per agent call:**
- Trader: ~4K input tokens (current data + top analogs + patterns) + ~1K output = ~$0.02/call (Sonnet)
- Auditor: ~8K input tokens (full pattern set + accuracy data) + ~2K output = ~$0.15/call (Opus)
- Meta-Analyst: ~12K input tokens (cross-stock data + agent reports) + ~3K output = ~$0.25/call (Opus)

**Monthly cost estimate (10 stocks):**
- Trader: ~20 queries/day × 22 trading days = 440 calls × $0.02 = ~$9
- Auditor: 1/day × 22 = 22 calls × $0.15 = ~$3.30
- Meta-Analyst: 4/month × $0.25 = ~$1
- **Total AI: ~$13/month** (scales linearly with usage)

**Caching:** Trader responses cached per stock for 5 minutes. If same stock queried within 5 min, return cached result (candle data doesn't change within one 15-min window).

### Agent 1: Trader

**Role:** Interprets signals, answers real-time queries in Telegram, gives trading recommendations.

**System prompt framework:**
- "You are an experienced intraday trader. You trade probabilities, not certainties."
- "Always show historical analogs. Always give a risk/reward assessment."
- "Never say 'I don't know.' There is always a closest pattern."
- Has access to: current candles, patterns, composite score, historical analogs

**Output verification:** Agent returns structured JSON with analog date references. Before sending to user, the system verifies that every cited date and percentage exists in the database. Any unverified claim is stripped. This prevents hallucination.

**Triggers:** On-demand via Telegram messages

### Agent 2: Auditor

**Role:** Validates pattern quality, finds calculation errors, tracks degradation.

**System prompt framework:**
- "You are a statistics skeptic. Your job is to disprove every pattern."
- "Look for confounding variables, survivorship bias, overfitting."
- "Check if a pattern's edge is real or just noise."
- Has access to: all pattern data, prediction history, accuracy trends

**Triggers:** Daily after market close (automated via GitHub Actions)

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

**Triggers:** Weekly (automated via GitHub Actions)

**Outputs:**
- New pattern hypotheses (fed back into Layer 2 as DISCOVERED)
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
- `ALAB` or `ALAB MU` — current analysis with analogs and composite score for one or multiple stocks
- `patterns ALAB` — list all active patterns with accuracy stats
- `test: if ALAB drops 2% in 30min, does it bounce 1%?` — submit a hypothesis, system backtests and reports results
- `report` — daily summary of what worked and what didn't
- `health` — system status, data freshness, failing jobs

**Automatic alerts:**
- Pattern triggered with high confidence: "ALAB: pattern X triggered (78% accuracy), score +72, 5 similar days reversed here"
- Daily end-of-day report: predictions vs reality
- Weekly Auditor/Meta-Analyst insights
- **System failure alerts:** data collection failed, agent job timed out, stale data warning

**Security:** Bot responds only to whitelisted Telegram chat IDs (configured in Supabase environment variables).

### Web Dashboard (Next.js on Vercel)

**Auth:** Supabase Auth (email/password or magic link). Single user for now, but built with auth from the start.

**Pages:**
- **Stock List** — all tracked stocks, quick stats, add/remove stocks (triggers historical data backfill)
- **Stock Detail** — all patterns for a stock: lifecycle stage, accuracy, EV, occurrence count, source (algorithmic vs user)
- **Pattern Detail** — deep dive into one pattern: every historical event, backtest results, accuracy over time chart
- **Predictions Log** — what was predicted vs what happened, running accuracy
- **Agent Reports** — latest findings from Auditor and Meta-Analyst
- **System Health** — overall accuracy, number of live patterns, degradation alerts, data freshness, API usage

---

## Compute Architecture

Heavy computation (pattern discovery, backtesting, agent jobs) does NOT run in Supabase Edge Functions (150s timeout too short). Instead:

| Task | Where | Trigger |
|------|-------|---------|
| Daily data fetch (candles) | GitHub Actions | Cron: 9:30 PM UTC weekdays |
| Pattern discovery & backtesting | GitHub Actions | After data fetch completes |
| Auditor agent | GitHub Actions | After pattern analysis completes |
| Meta-Analyst agent | GitHub Actions | Weekly Sunday |
| Telegram bot (real-time queries) | Supabase Edge Function | On message (lightweight: fetch from DB + call Claude) |
| Web Dashboard | Vercel | Always on |
| Prediction tracking (fill actuals) | GitHub Actions | Cron: 9:30 PM UTC weekdays |

GitHub Actions: free tier = 2,000 min/month. Estimated usage: ~30 min/day × 22 days = 660 min. Well within limits.

---

## Monitoring & Alerting

The system sends Telegram alerts when:
- Data collection job fails or returns stale data
- Any agent job times out or errors
- A pattern degrades below threshold
- System accuracy drops below 60% over rolling 7 days
- Polygon.io API quota approaching limit

Health check: a daily "heartbeat" message in Telegram confirming all systems operational.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Database | Supabase PostgreSQL + pgvector extension |
| Data collection | GitHub Actions (TypeScript scripts) |
| Pattern analysis | GitHub Actions (TypeScript) |
| Similarity search | pgvector (approximate nearest neighbor) + DTW refinement |
| AI Agents | Claude API (Sonnet 4.6 for Trader, Opus 4.6 for Auditor/Meta-Analyst) |
| Telegram Bot | Supabase Edge Function + Telegram Bot API |
| Web Dashboard | Next.js 14 on Vercel |
| Market Data | Polygon.io REST API ($29/mo Stocks Starter) |
| Scheduling | GitHub Actions cron |
| Auth | Supabase Auth |
| Hosting | Vercel (web) + Supabase (DB, edge functions) + GitHub Actions (compute) |

---

## Constraints & Principles

1. **Always find analogs** — the system never returns "no data." There is always a closest match.
2. **Trade probabilities** — every output includes probability, not certainty.
3. **Self-correcting** — patterns that stop working are automatically demoted.
4. **Skepticism built in** — Auditor actively tries to disprove patterns.
5. **Relative moves** — always factor out market movement to see the stock's true behavior.
6. **No hallucination** — agents return structured JSON with date references; all claims verified against DB before showing to user.
7. **Risk first** — every signal includes stop-loss and worst-case scenario from historical data.
8. **User as pattern source** — user can submit hypotheses that get backtested and promoted to live patterns if validated.
9. **Fail loud** — system failures trigger Telegram alerts, never fail silently.
10. **Data freshness** — stale data (>24h old on a trading day) triggers warnings and disables predictions for affected stocks.

---

## Cost Summary

| Item | Monthly Cost |
|------|-------------|
| Polygon.io Stocks Starter | $29 |
| Claude API (agents) | ~$13 |
| Supabase (free tier) | $0 |
| Vercel (free tier) | $0 |
| GitHub Actions (free tier) | $0 |
| **Total** | **~$42/month** |
