"""
Advanced pattern discovery engine.
Finds statistically significant repeating patterns in intraday data.
Approach: scan for conditional probabilities — "if X happens, then Y follows with Z% probability"
"""

import json
import os
import numpy as np
from collections import defaultdict
from itertools import product

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')


def load_profiles(ticker: str) -> dict:
    path = os.path.join(DATA_DIR, ticker.upper(), 'profiles.json')
    with open(path) as f:
        return json.load(f)


def candle_pct_changes(candles: list[dict]) -> list[float]:
    """Get % change from open for each candle."""
    return [c['pct_from_open'] for c in candles]


def candle_volumes(candles: list[dict]) -> list[int]:
    return [c['volume'] for c in candles]


def classify_move(pct: float, thresholds: list[float] = [0.25, 0.5, 1.0, 2.0]) -> str:
    """Classify a % move into a category."""
    abs_pct = abs(pct)
    if abs_pct < thresholds[0]:
        magnitude = 'flat'
    elif abs_pct < thresholds[1]:
        magnitude = 'small'
    elif abs_pct < thresholds[2]:
        magnitude = 'medium'
    elif abs_pct < thresholds[3]:
        magnitude = 'large'
    else:
        magnitude = 'extreme'

    if pct > thresholds[0]:
        return f"up_{magnitude}"
    elif pct < -thresholds[0]:
        return f"down_{magnitude}"
    return 'flat'


class PatternDiscovery:
    def __init__(self, ticker: str):
        self.ticker = ticker
        self.profiles = load_profiles(ticker)
        self.results = {}

    def run_all(self) -> dict:
        """Run all pattern discovery methods."""
        self.results = {
            'ticker': self.ticker.upper(),
            'total_days_analyzed': len(self.profiles),
            'patterns': {}
        }

        self.results['patterns']['mean_reversion'] = self.find_mean_reversion_patterns()
        self.results['patterns']['gap_behavior'] = self.find_gap_patterns()
        self.results['patterns']['momentum_continuation'] = self.find_momentum_patterns()
        self.results['patterns']['time_of_day'] = self.find_time_patterns()
        self.results['patterns']['volume_signals'] = self.find_volume_patterns()
        self.results['patterns']['conditional_moves'] = self.find_conditional_patterns()
        self.results['patterns']['reversal_after_pump'] = self.find_pump_reversal_patterns()

        # Save
        ticker_dir = os.path.join(DATA_DIR, self.ticker.upper())
        os.makedirs(ticker_dir, exist_ok=True)
        with open(os.path.join(ticker_dir, 'patterns.json'), 'w') as f:
            json.dump(self.results, f, indent=2)

        return self.results

    def find_mean_reversion_patterns(self) -> list[dict]:
        """
        Core pattern: "If stock moves X% from open, what happens next?"
        E.g., if +1% in first hour → does it revert -0.5%?
        """
        patterns = []
        trigger_thresholds = [0.5, 1.0, 1.5, 2.0, 3.0]
        check_windows = [2, 4, 8]  # candles after trigger (30min, 1h, 2h)

        for threshold in trigger_thresholds:
            for direction in ['up', 'down']:
                for window in check_windows:
                    events = []

                    for date, profile in self.profiles.items():
                        changes = candle_pct_changes(profile['candles'])
                        for i, pct in enumerate(changes):
                            triggered = (
                                (direction == 'up' and pct >= threshold) or
                                (direction == 'down' and pct <= -threshold)
                            )
                            if triggered and i + window < len(changes):
                                # What happened in the next `window` candles?
                                future = changes[i + 1: i + 1 + window]
                                if future:
                                    reversion = changes[i] - future[-1]  # how much it reverted
                                    max_extension = max(future) - changes[i] if direction == 'up' else changes[i] - min(future)
                                    events.append({
                                        'trigger_pct': round(pct, 4),
                                        'reversion': round(reversion, 4),
                                        'max_extension': round(max_extension, 4),
                                        'end_pct': round(future[-1], 4),
                                        'reverted': (direction == 'up' and future[-1] < pct) or
                                                    (direction == 'down' and future[-1] > pct),
                                    })
                                break  # Only first trigger per day

                    if len(events) >= 5:
                        reversions = [e['reversion'] for e in events]
                        revert_count = sum(1 for e in events if e['reverted'])
                        patterns.append({
                            'description': f"After {direction} {threshold}% from open",
                            'window_candles': window,
                            'window_minutes': window * 15,
                            'occurrences': len(events),
                            'reversion_rate': round(revert_count / len(events) * 100, 2),
                            'avg_reversion': round(np.mean(reversions), 4),
                            'median_reversion': round(float(np.median(reversions)), 4),
                            'tradeable': revert_count / len(events) > 0.6,  # >60% = tradeable
                        })

        # Sort by reversion rate
        patterns.sort(key=lambda x: x['reversion_rate'], reverse=True)
        return patterns

    def find_gap_patterns(self) -> dict:
        """How does the stock behave after gap up/down on open vs previous close?"""
        daily_path = os.path.join(DATA_DIR, self.ticker.upper(), 'daily.json')
        if not os.path.exists(daily_path):
            return {}

        with open(daily_path) as f:
            daily = json.load(f)

        gaps = {'gap_up': [], 'gap_down': []}
        for i in range(1, len(daily)):
            prev_close = daily[i - 1]['close']
            today_open = daily[i]['open']
            gap_pct = (today_open - prev_close) / prev_close * 100

            if abs(gap_pct) < 0.5:
                continue

            day_change = (daily[i]['close'] - daily[i]['open']) / daily[i]['open'] * 100
            gap_filled = (
                (gap_pct > 0 and daily[i]['low'] <= prev_close) or
                (gap_pct < 0 and daily[i]['high'] >= prev_close)
            )

            entry = {
                'date': daily[i]['date'],
                'gap_pct': round(gap_pct, 4),
                'day_change': round(day_change, 4),
                'gap_filled': gap_filled,
            }

            if gap_pct > 0:
                gaps['gap_up'].append(entry)
            else:
                gaps['gap_down'].append(entry)

        result = {}
        for gap_type, events in gaps.items():
            if events:
                fill_rate = sum(1 for e in events if e['gap_filled']) / len(events)
                changes = [e['day_change'] for e in events]
                result[gap_type] = {
                    'occurrences': len(events),
                    'gap_fill_rate': round(fill_rate * 100, 2),
                    'avg_day_change': round(np.mean(changes), 4),
                    'avg_gap_size': round(np.mean([abs(e['gap_pct']) for e in events]), 4),
                }

        return result

    def find_momentum_patterns(self) -> list[dict]:
        """
        If the first N candles are strongly directional, does it continue?
        """
        patterns = []
        check_periods = [2, 4, 8]  # first 30min, 1h, 2h
        thresholds = [0.5, 1.0, 2.0]

        for period in check_periods:
            for threshold in thresholds:
                for direction in ['up', 'down']:
                    continuations = []

                    for date, profile in self.profiles.items():
                        changes = candle_pct_changes(profile['candles'])
                        if len(changes) < period + 4:
                            continue

                        initial_move = changes[period - 1]  # % from open at candle N
                        triggered = (
                            (direction == 'up' and initial_move >= threshold) or
                            (direction == 'down' and initial_move <= -threshold)
                        )

                        if triggered:
                            final_change = profile['day_change_pct']
                            continued = (
                                (direction == 'up' and final_change > initial_move) or
                                (direction == 'down' and final_change < initial_move)
                            )
                            continuations.append({
                                'initial': round(initial_move, 4),
                                'final': round(final_change, 4),
                                'continued': continued,
                            })

                    if len(continuations) >= 3:
                        cont_rate = sum(1 for c in continuations if c['continued']) / len(continuations)
                        patterns.append({
                            'description': f"First {period * 15}min {direction} {threshold}%+",
                            'occurrences': len(continuations),
                            'continuation_rate': round(cont_rate * 100, 2),
                            'avg_initial': round(np.mean([c['initial'] for c in continuations]), 4),
                            'avg_final': round(np.mean([c['final'] for c in continuations]), 4),
                            'tradeable_momentum': cont_rate > 0.6,
                            'tradeable_reversal': cont_rate < 0.4,
                        })

        patterns.sort(key=lambda x: abs(x['continuation_rate'] - 50), reverse=True)
        return patterns

    def find_time_patterns(self) -> dict:
        """
        How does the stock behave at different times of day?
        Morning pump, lunch dip, power hour.
        """
        # Market hours: 9:30 - 16:00 ET = 26 x 15min candles
        time_segments = {
            'first_30min': (0, 2),      # 9:30-10:00
            'first_hour': (0, 4),       # 9:30-10:30
            'morning': (0, 8),          # 9:30-11:30
            'lunch': (8, 14),           # 11:30-13:00
            'afternoon': (14, 22),      # 13:00-15:00
            'power_hour': (22, 26),     # 15:00-16:00
        }

        segment_stats = {}
        for segment_name, (start, end) in time_segments.items():
            moves = []
            for date, profile in self.profiles.items():
                changes = candle_pct_changes(profile['candles'])
                if len(changes) > end:
                    start_pct = changes[start] if start > 0 else 0
                    end_pct = changes[end - 1]
                    segment_move = end_pct - start_pct
                    moves.append(round(segment_move, 4))

            if moves:
                segment_stats[segment_name] = {
                    'avg_move': round(np.mean(moves), 4),
                    'median_move': round(float(np.median(moves)), 4),
                    'std_dev': round(float(np.std(moves)), 4),
                    'up_pct': round(sum(1 for m in moves if m > 0) / len(moves) * 100, 2),
                    'avg_up_move': round(np.mean([m for m in moves if m > 0]) if any(m > 0 for m in moves) else 0, 4),
                    'avg_down_move': round(np.mean([m for m in moves if m < 0]) if any(m < 0 for m in moves) else 0, 4),
                    'sample_size': len(moves),
                }

        return segment_stats

    def find_volume_patterns(self) -> dict:
        """Does abnormal volume predict direction?"""
        results = {}

        for date, profile in self.profiles.items():
            volumes = candle_volumes(profile['candles'])
            if len(volumes) < 4:
                continue

        # Compare first-hour volume to rest
        vol_signals = []
        for date, profile in self.profiles.items():
            vols = candle_volumes(profile['candles'])
            changes = candle_pct_changes(profile['candles'])
            if len(vols) < 8:
                continue

            first_hour_vol = sum(vols[:4])
            rest_avg_hourly = sum(vols[4:]) / max(1, (len(vols) - 4) / 4)

            if rest_avg_hourly > 0:
                vol_ratio = first_hour_vol / (rest_avg_hourly * 1)  # compare to 1 hour avg
            else:
                continue

            vol_signals.append({
                'date': date,
                'vol_ratio': round(vol_ratio, 2),
                'first_hour_direction': 'up' if changes[3] > 0 else 'down',
                'day_change': profile['day_change_pct'],
                'high_volume': vol_ratio > 1.5,
            })

        if vol_signals:
            high_vol = [s for s in vol_signals if s['high_volume']]
            normal_vol = [s for s in vol_signals if not s['high_volume']]

            results['high_volume_first_hour'] = {
                'occurrences': len(high_vol),
                'avg_day_change': round(np.mean([s['day_change'] for s in high_vol]), 4) if high_vol else 0,
                'volatility': round(float(np.std([s['day_change'] for s in high_vol])), 4) if high_vol else 0,
            }
            results['normal_volume_first_hour'] = {
                'occurrences': len(normal_vol),
                'avg_day_change': round(np.mean([s['day_change'] for s in normal_vol]), 4) if normal_vol else 0,
                'volatility': round(float(np.std([s['day_change'] for s in normal_vol])), 4) if normal_vol else 0,
            }

        return results

    def find_conditional_patterns(self) -> list[dict]:
        """
        Systematic scan: "Given candle N is X, what is candle N+M?"
        This finds ALL conditional relationships.
        """
        patterns = []
        max_candle = 20  # first ~5 hours

        for trigger_candle in range(1, min(8, max_candle)):
            for target_candle in range(trigger_candle + 1, min(trigger_candle + 8, max_candle)):
                for trigger_dir in ['up', 'down']:
                    for trigger_thresh in [0.5, 1.0, 2.0]:
                        events = []

                        for date, profile in self.profiles.items():
                            changes = candle_pct_changes(profile['candles'])
                            if len(changes) <= target_candle:
                                continue

                            trigger_val = changes[trigger_candle]
                            triggered = (
                                (trigger_dir == 'up' and trigger_val >= trigger_thresh) or
                                (trigger_dir == 'down' and trigger_val <= -trigger_thresh)
                            )

                            if triggered:
                                target_val = changes[target_candle]
                                move_after = target_val - trigger_val
                                events.append({
                                    'trigger': round(trigger_val, 4),
                                    'target': round(target_val, 4),
                                    'move': round(move_after, 4),
                                })

                        if len(events) >= 5:
                            moves = [e['move'] for e in events]
                            up_moves = sum(1 for m in moves if m > 0)
                            down_moves = sum(1 for m in moves if m < 0)
                            directional_bias = max(up_moves, down_moves) / len(moves)

                            if directional_bias >= 0.65:  # At least 65% directional
                                dominant = 'up' if up_moves > down_moves else 'down'
                                patterns.append({
                                    'trigger': f"Candle {trigger_candle} ({trigger_candle * 15}min) {trigger_dir} {trigger_thresh}%+",
                                    'target': f"Candle {target_candle} ({target_candle * 15}min)",
                                    'dominant_direction': dominant,
                                    'bias_pct': round(directional_bias * 100, 2),
                                    'avg_move': round(np.mean(moves), 4),
                                    'occurrences': len(events),
                                })

        patterns.sort(key=lambda x: x['bias_pct'], reverse=True)
        return patterns[:30]  # Top 30 strongest patterns

    def find_pump_reversal_patterns(self) -> list[dict]:
        """
        Specifically what the user described:
        "If stock pumps X% from open, it then drops Y% — you capture X+Y%"
        Scans for the most reliable pump-and-dump / dump-and-pump patterns.
        """
        patterns = []
        pump_thresholds = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]

        for pump_thresh in pump_thresholds:
            for direction in ['pump', 'dump']:
                events = []

                for date, profile in self.profiles.items():
                    changes = candle_pct_changes(profile['candles'])
                    if len(changes) < 10:
                        continue

                    # Find the peak/trough in first 2 hours
                    first_2h = changes[:8]
                    if direction == 'pump':
                        peak_val = max(first_2h)
                        peak_idx = first_2h.index(peak_val)
                        if peak_val < pump_thresh:
                            continue
                    else:
                        peak_val = min(first_2h)
                        peak_idx = first_2h.index(peak_val)
                        if peak_val > -pump_thresh:
                            continue

                    # What happened after the peak?
                    remaining = changes[peak_idx + 1:]
                    if not remaining:
                        continue

                    if direction == 'pump':
                        min_after = min(remaining)
                        reversal = peak_val - min_after
                        day_end = changes[-1]
                        reverted_from_peak = peak_val - day_end
                    else:
                        max_after = max(remaining)
                        reversal = max_after - peak_val
                        day_end = changes[-1]
                        reverted_from_peak = day_end - peak_val

                    events.append({
                        'date': date,
                        'peak_pct': round(peak_val, 4),
                        'peak_candle': peak_idx,
                        'max_reversal': round(reversal, 4),
                        'close_vs_peak': round(reverted_from_peak, 4),
                        'day_close': round(day_end, 4),
                        'capturable': round(reversal, 4),
                    })

                if len(events) >= 3:
                    reversals = [e['max_reversal'] for e in events]
                    capturables = [e['capturable'] for e in events]
                    patterns.append({
                        'description': f"After {direction} of {pump_thresh}%+ in first 2h",
                        'occurrences': len(events),
                        'avg_max_reversal': round(np.mean(reversals), 4),
                        'median_max_reversal': round(float(np.median(reversals)), 4),
                        'avg_capturable': round(np.mean(capturables), 4),
                        'min_capturable': round(min(capturables), 4),
                        'avg_peak_candle': round(np.mean([e['peak_candle'] for e in events]), 1),
                        'events': events[:5],  # Sample events
                    })

        patterns.sort(key=lambda x: x['avg_capturable'], reverse=True)
        return patterns


if __name__ == '__main__':
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else 'ALAB'
    pd = PatternDiscovery(ticker)
    results = pd.run_all()
    print(json.dumps(results, indent=2))
