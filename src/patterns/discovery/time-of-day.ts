import { DayData, DiscoveredPattern, PatternEvent } from '../types.js';

const MIN_OCCURRENCES = 30;

interface Segment {
  name: string;
  start: number;  // inclusive candle index
  end: number;    // inclusive candle index
}

// 26 candles per day (09:30–16:00, 15-min intervals)
const SEGMENTS: Segment[] = [
  { name: 'first_30min', start: 0, end: 1 },
  { name: 'first_hour', start: 0, end: 3 },
  { name: 'morning', start: 0, end: 7 },
  { name: 'lunch', start: 8, end: 13 },
  { name: 'afternoon', start: 14, end: 21 },
  { name: 'power_hour', start: 22, end: 25 },
];

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
 * Discover time-of-day patterns.
 *
 * For each segment:
 *   - Compute segment move (pct_from_open at segment end)
 *   - If segment ends up (positive move), predict continuation or reversal for remainder
 *   - If segment ends down (negative move), predict continuation or reversal for remainder
 *
 * Returns patterns for both "up segment → what happens after" and "down segment → what happens after".
 */
export function discoverTimeOfDay(days: DayData[]): DiscoveredPattern[] {
  const patterns: DiscoveredPattern[] = [];

  for (const segment of SEGMENTS) {
    const upEvents: PatternEvent[] = [];
    const downEvents: PatternEvent[] = [];

    for (const day of days) {
      const candles = day.candles;
      if (candles.length <= segment.end) continue;

      const segEndIdx = Math.min(segment.end, candles.length - 1);
      const segEndCandle = candles[segEndIdx];
      const segMove = segEndCandle.pct_from_open;

      // Last candle of day for outcome
      const lastCandle = candles[candles.length - 1];
      const eod_pct = lastCandle.pct_from_open;

      // After-segment move
      const afterMove = eod_pct - segMove;

      if (segMove > 0) {
        // Segment went up — does it continue up after?
        const continued = afterMove > 0;
        upEvents.push({
          date: day.date,
          trigger_candle: segEndIdx,
          trigger_value: segMove,
          predicted_direction: 'up',
          predicted_magnitude: Math.abs(segMove),
          actual_outcome: eod_pct,
          was_correct: continued,
          profit_pct: afterMove,
        });
      } else if (segMove < 0) {
        // Segment went down — does it continue down after?
        const continued = afterMove < 0;
        downEvents.push({
          date: day.date,
          trigger_candle: segEndIdx,
          trigger_value: segMove,
          predicted_direction: 'down',
          predicted_magnitude: Math.abs(segMove),
          actual_outcome: eod_pct,
          was_correct: continued,
          profit_pct: -afterMove,
        });
      }
    }

    if (upEvents.length >= MIN_OCCURRENCES) {
      const stats = computeStats(upEvents);
      const upRate = upEvents.filter((e) => e.was_correct).length / upEvents.length;
      const avgSegMove =
        upEvents.reduce((sum, e) => sum + e.trigger_value, 0) / upEvents.length;

      patterns.push({
        type: 'time_of_day',
        description: `${segment.name} up move (avg ${avgSegMove.toFixed(2)}%) — ${(upRate * 100).toFixed(0)}% continue higher after`,
        parameters: {
          segment: segment.name,
          segment_start: segment.start,
          segment_end: segment.end,
          direction: 'up',
        },
        events: upEvents,
        occurrences: upEvents.length,
        ...stats,
      });
    }

    if (downEvents.length >= MIN_OCCURRENCES) {
      const stats = computeStats(downEvents);
      const downRate = downEvents.filter((e) => e.was_correct).length / downEvents.length;
      const avgSegMove =
        downEvents.reduce((sum, e) => sum + e.trigger_value, 0) / downEvents.length;

      patterns.push({
        type: 'time_of_day',
        description: `${segment.name} down move (avg ${avgSegMove.toFixed(2)}%) — ${(downRate * 100).toFixed(0)}% continue lower after`,
        parameters: {
          segment: segment.name,
          segment_start: segment.start,
          segment_end: segment.end,
          direction: 'down',
        },
        events: downEvents,
        occurrences: downEvents.length,
        ...stats,
      });
    }
  }

  return patterns;
}
