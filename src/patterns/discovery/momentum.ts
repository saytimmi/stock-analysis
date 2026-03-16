import { DayData, DiscoveredPattern, PatternEvent } from '../types.js';

const CHECK_PERIODS = [2, 4, 8];
const THRESHOLDS = [0.5, 1.0, 2.0];
const DIRECTIONS = ['up', 'down'] as const;
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
  const avg_win =
    wins.length > 0
      ? wins.reduce((sum, e) => sum + e.profit_pct, 0) / wins.length
      : 0;
  const avg_loss =
    losses.length > 0
      ? losses.reduce((sum, e) => sum + e.profit_pct, 0) / losses.length
      : 0;
  const expected_value = win_rate * avg_win + (1 - win_rate) * avg_loss;

  return { win_rate, avg_win, avg_loss, expected_value };
}

/**
 * Discover momentum patterns:
 * "If first N candles are strongly directional (>X%), does it continue or reverse by end of day?"
 */
export function discoverMomentum(days: DayData[]): DiscoveredPattern[] {
  const patterns: DiscoveredPattern[] = [];

  for (const period of CHECK_PERIODS) {
    for (const threshold of THRESHOLDS) {
      for (const direction of DIRECTIONS) {
        const continueEvents: PatternEvent[] = [];
        const reverseEvents: PatternEvent[] = [];

        for (const day of days) {
          const candles = day.candles;
          if (candles.length <= period) continue;

          // Check if the candle at index `period-1` is strongly directional
          const checkCandle = candles[period - 1];
          const pct = checkCandle.pct_from_open;

          const isDirectional =
            direction === 'up' ? pct >= threshold : pct <= -threshold;
          if (!isDirectional) continue;

          // End of day outcome
          const lastCandle = candles[candles.length - 1];
          const eod_pct = lastCandle.pct_from_open;

          // Continuation: same direction as initial move
          const continued =
            direction === 'up' ? eod_pct > pct : eod_pct < pct;

          const profit_pct =
            direction === 'up' ? eod_pct - pct : pct - eod_pct;

          const event: PatternEvent = {
            date: day.date,
            trigger_candle: period - 1,
            trigger_value: pct,
            predicted_direction: direction,
            predicted_magnitude: Math.abs(pct),
            actual_outcome: eod_pct,
            was_correct: continued,
            profit_pct,
          };

          continueEvents.push(event);
          reverseEvents.push({
            ...event,
            predicted_direction: direction === 'up' ? 'down' : 'up',
            was_correct: !continued,
            profit_pct: -profit_pct,
          });
        }

        // Momentum continuation pattern
        if (continueEvents.length >= MIN_OCCURRENCES) {
          const stats = computeStats(continueEvents);
          patterns.push({
            type: 'momentum_continuation',
            description:
              `${direction === 'up' ? 'Up' : 'Down'} move >= ${threshold}% in first ${period} candles continues to end of day`,
            parameters: {
              check_period: period,
              threshold,
              direction,
              prediction: 'continuation',
            },
            events: continueEvents,
            occurrences: continueEvents.length,
            ...stats,
          });
        }

        // Momentum reversal pattern
        if (reverseEvents.length >= MIN_OCCURRENCES) {
          const stats = computeStats(reverseEvents);
          patterns.push({
            type: 'momentum_reversal',
            description:
              `${direction === 'up' ? 'Up' : 'Down'} move >= ${threshold}% in first ${period} candles reverses by end of day`,
            parameters: {
              check_period: period,
              threshold,
              direction,
              prediction: 'reversal',
            },
            events: reverseEvents,
            occurrences: reverseEvents.length,
            ...stats,
          });
        }
      }
    }
  }

  return patterns;
}
