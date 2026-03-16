# Stock Pattern Analyzer

Intraday pattern-matching system for predicting stock behavior based on historical 15-minute candle patterns.

## How it works

1. **Data Collection**: Pulls 1 year of 15-minute OHLCV data for a stock (starting with ALAB)
2. **Pattern Profiling**: Each trading day is converted to a "profile" — percentage change from open at each 15-min interval
3. **Pattern Clustering**: Similar days are grouped together to identify recurring behaviors
4. **Real-time Calculator**: As the current trading day progresses, the system matches the developing pattern against historical data and predicts likely outcomes

## Architecture

- `scripts/` — Python data collection & analysis
- `data/` — Historical OHLCV and intraday data (JSON/CSV)
- `docs/` — GitHub Pages calculator UI
- `.github/workflows/` — Automated data updates

## Stack

- Python (yfinance, pandas, numpy, scikit-learn)
- GitHub Actions (scheduled data fetching)
- GitHub Pages (real-time calculator UI)
