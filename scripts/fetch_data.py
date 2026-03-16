"""
Fetch historical OHLCV data for a stock.
- Daily candles (1 year)
- 15-minute intraday candles (max available from yfinance)
"""

import yfinance as yf
import pandas as pd
import json
import os
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')


def fetch_daily_data(ticker: str, period: str = '1y') -> pd.DataFrame:
    """Fetch daily OHLCV data."""
    stock = yf.Ticker(ticker)
    df = stock.history(period=period, interval='1d')
    df.index = df.index.strftime('%Y-%m-%d')
    return df[['Open', 'High', 'Low', 'Close', 'Volume']]


def fetch_intraday_data(ticker: str) -> pd.DataFrame:
    """
    Fetch 15-minute intraday data.
    yfinance allows max 60 days of intraday data at 15m interval.
    We fetch in chunks to get as much as possible.
    """
    stock = yf.Ticker(ticker)
    # yfinance: 15m data available for last 60 days
    df = stock.history(period='60d', interval='15m')
    return df[['Open', 'High', 'Low', 'Close', 'Volume']]


def build_day_profiles(df_intraday: pd.DataFrame) -> dict:
    """
    Convert intraday data into day profiles.
    Each day = list of % change from market open at each 15-min candle.
    """
    profiles = {}
    df = df_intraday.copy()
    df['date'] = df.index.date
    df['time'] = df.index.time

    for date, group in df.groupby('date'):
        group = group.sort_index()
        open_price = group.iloc[0]['Open']
        if open_price == 0:
            continue

        candles = []
        for _, row in group.iterrows():
            candles.append({
                'time': str(row['time']),
                'open': round(row['Open'], 4),
                'high': round(row['High'], 4),
                'low': round(row['Low'], 4),
                'close': round(row['Close'], 4),
                'volume': int(row['Volume']),
                'pct_from_open': round((row['Close'] - open_price) / open_price * 100, 4),
            })

        profiles[str(date)] = {
            'open_price': round(open_price, 4),
            'candles': candles,
            'day_change_pct': round((group.iloc[-1]['Close'] - open_price) / open_price * 100, 4),
        }

    return profiles


def save_data(ticker: str):
    """Fetch all data and save to JSON files."""
    ticker_dir = os.path.join(DATA_DIR, ticker.upper())
    os.makedirs(ticker_dir, exist_ok=True)

    # Daily data
    print(f"Fetching daily data for {ticker}...")
    daily = fetch_daily_data(ticker)
    daily_records = []
    for date, row in daily.iterrows():
        daily_records.append({
            'date': date,
            'open': round(row['Open'], 4),
            'high': round(row['High'], 4),
            'low': round(row['Low'], 4),
            'close': round(row['Close'], 4),
            'volume': int(row['Volume']),
        })

    with open(os.path.join(ticker_dir, 'daily.json'), 'w') as f:
        json.dump(daily_records, f, indent=2)
    print(f"  Saved {len(daily_records)} daily records")

    # Intraday data + profiles
    print(f"Fetching 15-min intraday data for {ticker}...")
    intraday = fetch_intraday_data(ticker)
    profiles = build_day_profiles(intraday)

    with open(os.path.join(ticker_dir, 'profiles.json'), 'w') as f:
        json.dump(profiles, f, indent=2)
    print(f"  Saved {len(profiles)} day profiles")

    # Summary
    summary = {
        'ticker': ticker.upper(),
        'last_updated': datetime.now().isoformat(),
        'daily_records': len(daily_records),
        'intraday_days': len(profiles),
        'date_range_daily': {
            'start': daily_records[0]['date'] if daily_records else None,
            'end': daily_records[-1]['date'] if daily_records else None,
        },
    }
    with open(os.path.join(ticker_dir, 'summary.json'), 'w') as f:
        json.dump(summary, f, indent=2)

    print(f"Done! Data saved to {ticker_dir}")


if __name__ == '__main__':
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else 'ALAB'
    save_data(ticker)
