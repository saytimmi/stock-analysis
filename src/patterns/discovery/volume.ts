import { DayData, DiscoveredPattern, PatternEvent } from '../types.js';

const VOLUME_RATIO_THRESHOLD = 1.5;
const MIN_OCCURRENCES = 30;

// First hour = candles 0-3 (4 candles × 15min = 1 hour)
const FIRST_HOUR_END = 3;

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
 * Discover volume-based patterns.
 *
 * Compare first-hour volume to rest-of-day average candle volume.
 * If first-hour average volume is > 1.5x the rest-of-day average, what happens?
 *
 * Returns two pattern sets:
 *   1. High first-hour volume + up move → continuation
 *   2. High first-hour volume + down move → continuation
 */
export function discoverVolumePatterns(days: DayData[]): DiscoveredPattern[] {
  const upContinueEvents: PatternEvent[] = [];
  const downContinueEvents: PatternEvent[] = [];

  for (const day of days) {
    const candles = day.candles;
    if (candles.length <= FIRST_HOUR_END + 1) continue;

    // First-hour candles
    const firstHour = candles.slice(0, FIRST_HOUR_END + 1);
    // Rest-of-day candles
    const rest = candles.slice(FIRST_HOUR_END + 1);

    if (rest.length === 0) continue;

    const firstHourAvgVol =
      firstHour.reduce((sum, c) => sum + c.volume, 0) / firstHour.length;
    const restAvgVol =
      rest.reduce((sum, c) => sum + c.volume, 0) / rest.length;

    if (restAvgVol === 0) continue;

    const volumeRatio = firstHourAvgVol / restAvgVol;
    if (volumeRatio < VOLUME_RATIO_THRESHOLD) continue;

    // Direction at end of first hour
    const firstHourEndCandle = candles[FIRST_HOUR_END];
    const firstHourMove = firstHourEndCandle.pct_from_open;

    // End-of-day outcome
    const lastCandle = candles[candles.length - 1];
    const eod_pct = lastCandle.pct_from_open;

    const afterMove = eod_pct - firstHourMove;

    if (firstHourMove > 0) {
      const continued = afterMove > 0;
      upContinueEvents.push({
        date: day.date,
        trigger_candle: FIRST_HOUR_END,
        trigger_value: volumeRatio,
        predicted_direction: 'up',
        predicted_magnitude: Math.abs(firstHourMove),
        actual_outcome: eod_pct,
        was_correct: continued,
        profit_pct: afterMove,
      });
    } else if (firstHourMove < 0) {
      const continued = afterMove < 0;
      downContinueEvents.push({
        date: day.date,
        trigger_candle: FIRST_HOUR_END,
        trigger_value: volumeRatio,
        predicted_direction: 'down',
        predicted_magnitude: Math.abs(firstHourMove),
        actual_outcome: eod_pct,
        was_correct: continued,
        profit_pct: -afterMove,
      });
    }
  }

  const patterns: DiscoveredPattern[] = [];

  if (upContinueEvents.length >= MIN_OCCURRENCES) {
    const stats = computeStats(upContinueEvents);
    patterns.push({
      type: 'volume_surge',
      description: `High first-hour volume (>${VOLUME_RATIO_THRESHOLD}x) with up move continues higher`,
      parameters: {
        volume_ratio_threshold: VOLUME_RATIO_THRESHOLD,
        direction: 'up',
        first_hour_end_candle: FIRST_HOUR_END,
      },
      events: upContinueEvents,
      occurrences: upContinueEvents.length,
      ...stats,
    });
  }

  if (downContinueEvents.length >= MIN_OCCURRENCES) {
    const stats = computeStats(downContinueEvents);
    patterns.push({
      type: 'volume_surge',
      description: `High first-hour volume (>${VOLUME_RATIO_THRESHOLD}x) with down move continues lower`,
      parameters: {
        volume_ratio_threshold: VOLUME_RATIO_THRESHOLD,
        direction: 'down',
        first_hour_end_candle: FIRST_HOUR_END,
      },
      events: downContinueEvents,
      occurrences: downContinueEvents.length,
      ...stats,
    });
  }

  return patterns;
}
