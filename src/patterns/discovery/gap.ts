import { DayData, DiscoveredPattern, PatternEvent } from '../types.js';

const GAP_THRESHOLDS = [0.5, 1.0, 2.0, 3.0];
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
 * Discover gap fill patterns:
 * "After gap up/down on open, does the gap fill within the day?"
 *
 * Gap fill definition:
 *   - Gap up: price falls back below prior close (pct_from_open goes negative enough)
 *   - Gap down: price rises back above prior close (pct_from_open goes positive enough)
 *
 * We detect gap fill by checking if pct_from_open crosses zero in the opposite
 * direction of the gap at any point during the day.
 */
export function discoverGapPatterns(days: DayData[]): DiscoveredPattern[] {
  const patterns: DiscoveredPattern[] = [];

  for (const threshold of GAP_THRESHOLDS) {
    for (const direction of DIRECTIONS) {
      const fillEvents: PatternEvent[] = [];
      const noFillEvents: PatternEvent[] = [];

      for (const day of days) {
        if (day.gap_pct === null || day.gap_pct === undefined) continue;
        const candles = day.candles;
        if (candles.length === 0) continue;

        const gap = day.gap_pct;
        const isGap =
          direction === 'up' ? gap >= threshold : gap <= -threshold;
        if (!isGap) continue;

        // Check if gap fills during the day
        // Gap fill: pct_from_open crosses in opposite direction to close gap
        let filled = false;
        let fillCandle = -1;

        for (let i = 0; i < candles.length; i++) {
          const pct = candles[i].pct_from_open;
          // For gap up: gap fills if price drops enough (pct_from_open goes <= -gap/2 as proxy)
          // Simpler: gap fills if move in opposite direction > half the gap size
          const fillCondition =
            direction === 'up' ? pct <= -(Math.abs(gap) * 0.5) : pct >= Math.abs(gap) * 0.5;
          if (fillCondition) {
            filled = true;
            fillCandle = i;
            break;
          }
        }

        const lastCandle = candles[candles.length - 1];
        const eod_pct = lastCandle.pct_from_open;

        // Predicted: gap fills (opposite direction)
        const predicted_direction: 'up' | 'down' =
          direction === 'up' ? 'down' : 'up';

        const profit_pct = filled
          ? Math.abs(gap) * 0.5  // simplified profit on fill
          : direction === 'up' ? eod_pct : -eod_pct;  // actual move

        const event: PatternEvent = {
          date: day.date,
          trigger_candle: 0,
          trigger_value: gap,
          predicted_direction,
          predicted_magnitude: Math.abs(gap),
          actual_outcome: eod_pct,
          was_correct: filled,
          profit_pct,
        };

        if (filled) {
          fillEvents.push(event);
        } else {
          noFillEvents.push(event);
        }
      }

      const allEvents = [...fillEvents, ...noFillEvents];
      if (allEvents.length < MIN_OCCURRENCES) continue;

      const stats = computeStats(allEvents);

      patterns.push({
        type: 'gap_fill',
        description:
          `Gap ${direction} >= ${threshold}% fills within the day`,
        parameters: {
          threshold,
          direction,
          fill_threshold_ratio: 0.5,
        },
        events: allEvents,
        occurrences: allEvents.length,
        ...stats,
      });
    }
  }

  return patterns;
}
