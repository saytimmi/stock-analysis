import { supabase } from '../db/client.js';

export interface Signal {
  source: string;           // 'pattern:gap_fill', 'analog_consensus', 'volume', etc.
  direction: 'up' | 'down';
  strength: number;         // 0-1
  weight: number;           // configured weight
  accuracy?: number;        // historical accuracy of this signal
}

export interface CompositeResult {
  score: number;            // -100 to +100
  confidence: 'low' | 'medium' | 'high';
  signals: Signal[];
  risk_reward: number;      // ratio
  suggested_stop_loss: number;  // % from current price
  expected_value: number;   // weighted EV in %
}

export const SIGNAL_WEIGHTS: Record<string, number> = {
  analog_consensus: 0.30,
  active_pattern: 0.25,
  volume: 0.15,
  market_correlation: 0.10,
  multi_timeframe: 0.10,
  pre_market: 0.05,
  calendar: 0.05,
};

// Check which live patterns are currently triggered for given candles
export async function getActivePatternSignals(
  stockId: number,
  currentCandles: { pct_from_open: number; volume: number }[],
): Promise<Signal[]> {
  // 1. Load live patterns for this stock from DB
  const { data: patterns, error } = await supabase
    .from('patterns')
    .select('id, type, description, parameters, lifecycle_stage, win_rate, expected_value, accuracy_30d')
    .eq('stock_id', stockId)
    .eq('lifecycle_stage', 'active');

  if (error || !patterns) {
    return [];
  }

  const signals: Signal[] = [];

  // 2. For each pattern, check if current candles trigger it
  for (const pattern of patterns) {
    const params = pattern.parameters as Record<string, any>;

    // Basic trigger check: if pattern has threshold-based parameters,
    // check if any current candle meets the condition
    let triggered = false;
    let triggerStrength = 0;

    if (params?.trigger_candle !== undefined && currentCandles.length > params.trigger_candle) {
      const candle = currentCandles[params.trigger_candle];

      if (params?.min_pct_from_open !== undefined) {
        triggered = candle.pct_from_open >= params.min_pct_from_open;
        if (triggered) {
          triggerStrength = Math.min(1, Math.abs(candle.pct_from_open) / Math.max(Math.abs(params.min_pct_from_open), 0.01));
        }
      } else if (params?.max_pct_from_open !== undefined) {
        triggered = candle.pct_from_open <= params.max_pct_from_open;
        if (triggered) {
          triggerStrength = Math.min(1, Math.abs(candle.pct_from_open) / Math.max(Math.abs(params.max_pct_from_open), 0.01));
        }
      } else {
        // No specific threshold — treat as triggered if we have candles
        triggered = currentCandles.length > 0;
        triggerStrength = 0.5;
      }
    } else if (currentCandles.length > 0) {
      triggered = true;
      triggerStrength = 0.5;
    }

    if (!triggered) continue;

    // 3. Return signals with direction, strength (based on win_rate), weight
    const winRate: number = pattern.win_rate ?? 0.5;
    const direction: 'up' | 'down' = winRate >= 0.5 ? 'up' : 'down';
    const strength = Math.abs(winRate - 0.5) * 2 * triggerStrength; // normalize win_rate distance from 0.5

    signals.push({
      source: `pattern:${pattern.type}`,
      direction,
      strength: Math.min(1, Math.max(0, strength)),
      weight: SIGNAL_WEIGHTS.active_pattern,
      accuracy: pattern.accuracy_30d ?? winRate,
    });
  }

  return signals;
}

// Compute composite score from all signals
export function computeComposite(signals: Signal[]): CompositeResult {
  if (signals.length === 0) {
    return {
      score: 0,
      confidence: 'low',
      signals: [],
      risk_reward: 1,
      suggested_stop_loss: 2,
      expected_value: 0,
    };
  }

  // Formula: raw_score = sum(direction_value * strength * weight * (accuracy ?? 0.5))
  // direction_value: up = +1, down = -1
  let rawScore = 0;
  let totalWeightedAccuracy = 0;

  for (const signal of signals) {
    const directionValue = signal.direction === 'up' ? 1 : -1;
    const accuracy = signal.accuracy ?? 0.5;
    rawScore += directionValue * signal.strength * signal.weight * accuracy;
    totalWeightedAccuracy += signal.strength * signal.weight * accuracy;
  }

  // Normalize to [-100, +100]
  // Max possible raw_score: all weights sum to 1.0, strength=1, accuracy=1 → raw_score max is ~1.0
  // We normalize by the theoretical max (sum of all weights * 1 * 1 = 1.0)
  const maxPossible = signals.reduce((sum, s) => sum + s.strength * s.weight * (s.accuracy ?? 0.5), 0);
  const normalizer = maxPossible > 0 ? maxPossible : 1;
  const score = Math.round(Math.max(-100, Math.min(100, (rawScore / normalizer) * 100)));

  // Confidence: high if 5+ signals agree, medium if 3+, low otherwise
  const dominantDirection = score >= 0 ? 'up' : 'down';
  const agreeingSignals = signals.filter(s => s.direction === dominantDirection).length;

  let confidence: 'low' | 'medium' | 'high';
  if (agreeingSignals >= 5) {
    confidence = 'high';
  } else if (agreeingSignals >= 3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // risk_reward: based on analog max_gain vs max_loss
  // Use score magnitude as a proxy: positive scores favor reward
  const absScore = Math.abs(score);
  const risk_reward = absScore > 0 ? Math.max(0.5, absScore / 50) : 1;

  // suggested_stop_loss: worst analog outcome * 1.2
  // Use a baseline of 2% adjusted by inverse confidence
  const confidenceMultiplier = confidence === 'high' ? 0.8 : confidence === 'medium' ? 1.0 : 1.2;
  const suggested_stop_loss = Math.round(2 * confidenceMultiplier * 100) / 100;

  // expected_value: weighted EV in %
  const expected_value = Math.round(score * 0.05 * 100) / 100; // ~5% max move scaled by score

  return {
    score,
    confidence,
    signals,
    risk_reward: Math.round(risk_reward * 100) / 100,
    suggested_stop_loss,
    expected_value,
  };
}
