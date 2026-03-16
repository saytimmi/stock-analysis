import { DayData, DiscoveredPattern, PatternEvent } from '../types.js';

const TRIGGER_THRESHOLDS = [0.5, 1.0, 1.5, 2.0, 3.0];
const DIRECTIONS = ['up', 'down'] as const;
const OBSERVATION_WINDOWS = [2, 4, 8, 12];
const MIN_OCCURRENCES = 30;

function computeStats(events: PatternEvent[]): {
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  expected_value: number;
} {
  if (events.length === 0) {
    return { win_rate: 0, avg_win: 0, avg_loss: 0, expected_value: 0 };
  }

  const wins = events.filter((e) => e.was_correct);
  const losses = events.filter((e) => !e.was_correct);

  const win_rate = wins.length / events.length;
  const avg_win = wins.length > 0
    ? wins.reduce((sum, e) => sum + e.profit_pct, 0) / wins.length
    : 0;
  const avg_loss = losses.length > 0
    ? losses.reduce((sum, e) => sum + e.profit_pct, 0) / losses.length
    : 0;
  const expected_value = win_rate * avg_win + (1 - win_rate) * avg_loss;

  return { win_rate, avg_win, avg_loss, expected_value };
}

/**
 * Discover mean reversion patterns:
 * "If stock moves X% from open by candle N, does it revert Y% by candle M?"
 */
export function discoverMeanReversion(days: DayData[]): DiscoveredPattern[] {
  const patterns: DiscoveredPattern[] = [];

  for (const threshold of TRIGGER_THRESHOLDS) {
    for (const direction of DIRECTIONS) {
      for (const window of OBSERVATION_WINDOWS) {
        const events: PatternEvent[] = [];

        for (const day of days) {
          const candles = day.candles;
          if (candles.length < 2) continue;

          // Find first candle where pct_from_open crosses threshold in given direction
          let triggerIdx = -1;
          for (let i = 0; i < candles.length - 1; i++) {
            const pct = candles[i].pct_from_open;
            const crossed =
              direction === 'up' ? pct >= threshold : pct <= -threshold;
            if (crossed) {
              triggerIdx = i;
              break;
            }
          }

          if (triggerIdx === -1) continue;

          const triggerCandle = candles[triggerIdx];
          const triggerValue = triggerCandle.pct_from_open;

          // Observation window: candles after trigger (capped at end of day)
          const endIdx = Math.min(triggerIdx + window, candles.length - 1);
          const lastCandle = candles[endIdx];
          const actual_outcome = lastCandle.pct_from_open;

          // Mean reversion: predict move back toward 0
          const predicted_direction: 'up' | 'down' =
            direction === 'up' ? 'down' : 'up';

          // Reversion is partial if actual_outcome is closer to 0 than trigger
          const reverted =
            direction === 'up'
              ? actual_outcome < triggerValue
              : actual_outcome > triggerValue;

          const profit_pct = direction === 'up'
            ? triggerValue - actual_outcome
            : actual_outcome - triggerValue;

          events.push({
            date: day.date,
            trigger_candle: triggerIdx,
            trigger_value: triggerValue,
            predicted_direction,
            predicted_magnitude: Math.abs(triggerValue),
            actual_outcome,
            was_correct: reverted,
            profit_pct,
          });
        }

        if (events.length < MIN_OCCURRENCES) continue;

        const stats = computeStats(events);

        patterns.push({
          type: 'mean_reversion',
          description:
            `${direction === 'up' ? 'Up' : 'Down'} move >= ${threshold}% from open reverts within ${window} candles`,
          parameters: {
            threshold,
            direction,
            observation_window: window,
          },
          events,
          occurrences: events.length,
          ...stats,
        });
      }
    }
  }

  return patterns;
}
