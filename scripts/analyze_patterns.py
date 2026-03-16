"""
Pattern analysis engine.
Finds similar historical days based on 15-min candle profiles.
"""

import json
import os
import numpy as np
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')


def load_profiles(ticker: str) -> dict:
    """Load day profiles from JSON."""
    path = os.path.join(DATA_DIR, ticker.upper(), 'profiles.json')
    with open(path) as f:
        return json.load(f)


def profile_to_vector(profile: dict) -> list[float]:
    """Convert a day profile to a vector of % changes from open."""
    return [c['pct_from_open'] for c in profile['candles']]


def find_similar_days(
    ticker: str,
    current_candles: list[float],
    top_n: int = 10,
    min_candles: int = 4,
) -> list[dict]:
    """
    Given the current day's 15-min % changes from open,
    find the most similar historical days.

    Args:
        ticker: Stock ticker
        current_candles: List of % change from open for each 15-min candle so far
        top_n: Number of similar days to return
        min_candles: Minimum candles needed to compare

    Returns:
        List of similar days with similarity score and full profile
    """
    if len(current_candles) < min_candles:
        return []

    profiles = load_profiles(ticker)
    n = len(current_candles)
    results = []

    for date, profile in profiles.items():
        historical = profile_to_vector(profile)

        if len(historical) < n:
            continue

        # Compare only the first n candles (what we have so far today)
        hist_slice = historical[:n]
        current = np.array(current_candles)
        hist = np.array(hist_slice)

        # Euclidean distance
        distance = np.sqrt(np.sum((current - hist) ** 2))

        # Cosine similarity
        norm_current = np.linalg.norm(current)
        norm_hist = np.linalg.norm(hist)
        if norm_current > 0 and norm_hist > 0:
            cosine_sim = np.dot(current, hist) / (norm_current * norm_hist)
        else:
            cosine_sim = 0

        results.append({
            'date': date,
            'distance': round(float(distance), 4),
            'cosine_similarity': round(float(cosine_sim), 4),
            'matched_candles': n,
            'total_candles': len(historical),
            'day_change_pct': profile['day_change_pct'],
            'full_profile': historical,
        })

    # Sort by distance (lower = more similar)
    results.sort(key=lambda x: x['distance'])
    return results[:top_n]


def predict_outcome(similar_days: list[dict]) -> dict:
    """
    Based on similar historical days, predict the likely outcome.
    """
    if not similar_days:
        return {'error': 'Not enough data'}

    changes = [d['day_change_pct'] for d in similar_days]
    positive = sum(1 for c in changes if c > 0)
    negative = sum(1 for c in changes if c < 0)

    # Weighted prediction (closer matches weigh more)
    weights = [1 / (d['distance'] + 0.001) for d in similar_days]
    total_weight = sum(weights)
    weighted_change = sum(w * c for w, c in zip(weights, changes)) / total_weight

    # Build prediction for remaining candles
    remaining_profiles = []
    for day in similar_days[:5]:  # Top 5 matches
        profile = day['full_profile']
        matched = day['matched_candles']
        if len(profile) > matched:
            remaining_profiles.append(profile[matched:])

    avg_remaining = None
    if remaining_profiles:
        max_len = max(len(p) for p in remaining_profiles)
        padded = [p + [p[-1]] * (max_len - len(p)) for p in remaining_profiles]
        avg_remaining = np.mean(padded, axis=0).tolist()
        avg_remaining = [round(v, 4) for v in avg_remaining]

    return {
        'predicted_day_change_pct': round(weighted_change, 4),
        'bullish_probability': round(positive / len(changes) * 100, 2),
        'bearish_probability': round(negative / len(changes) * 100, 2),
        'avg_change': round(np.mean(changes), 4),
        'median_change': round(float(np.median(changes)), 4),
        'min_change': round(min(changes), 4),
        'max_change': round(max(changes), 4),
        'sample_size': len(similar_days),
        'predicted_remaining_candles': avg_remaining,
    }


def generate_analysis(ticker: str) -> dict:
    """Generate full pattern analysis for a ticker."""
    profiles = load_profiles(ticker)

    all_changes = [p['day_change_pct'] for p in profiles.values()]
    all_vectors = {date: profile_to_vector(p) for date, p in profiles.items()}

    # Find most common patterns (cluster by first-hour behavior)
    first_hour = {}  # 4 candles = 1 hour
    for date, vec in all_vectors.items():
        if len(vec) >= 4:
            direction = 'up' if vec[3] > 0 else 'down'
            magnitude = 'strong' if abs(vec[3]) > 1 else 'weak'
            pattern = f"{direction}_{magnitude}"
            if pattern not in first_hour:
                first_hour[pattern] = []
            first_hour[pattern].append({
                'date': date,
                'first_hour_change': round(vec[3], 4),
                'day_change': profiles[date]['day_change_pct'],
            })

    pattern_stats = {}
    for pattern, days in first_hour.items():
        day_changes = [d['day_change'] for d in days]
        pattern_stats[pattern] = {
            'count': len(days),
            'avg_day_change': round(np.mean(day_changes), 4),
            'median_day_change': round(float(np.median(day_changes)), 4),
            'win_rate': round(sum(1 for c in day_changes if c > 0) / len(day_changes) * 100, 2),
        }

    analysis = {
        'ticker': ticker.upper(),
        'total_days': len(profiles),
        'avg_daily_change': round(np.mean(all_changes), 4),
        'volatility': round(float(np.std(all_changes)), 4),
        'pattern_stats': pattern_stats,
    }

    # Save analysis
    ticker_dir = os.path.join(DATA_DIR, ticker.upper())
    with open(os.path.join(ticker_dir, 'analysis.json'), 'w') as f:
        json.dump(analysis, f, indent=2)

    return analysis


if __name__ == '__main__':
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else 'ALAB'
    analysis = generate_analysis(ticker)
    print(json.dumps(analysis, indent=2))
