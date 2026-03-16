import { supabase } from '../db/client.js';
import { BacktestResult } from './backtest.js';

/**
 * Store discovered + backtested patterns to DB.
 * Returns count of patterns stored.
 */
export async function storePatterns(
  stockId: number,
  results: BacktestResult[],
): Promise<number> {
  const passing = results.filter((r) => r.passed);
  if (passing.length === 0) return 0;

  let stored = 0;

  for (const result of passing) {
    const { pattern } = result;

    // Upsert pattern record
    const { data: patternRow, error: patternError } = await supabase
      .from('patterns')
      .insert({
        stock_id: stockId,
        type: pattern.type,
        source: 'algorithmic',
        description: pattern.description,
        parameters: pattern.parameters,
        lifecycle_stage: 'validated',
        occurrences: pattern.occurrences,
        win_rate: result.overall_win_rate,
        avg_win: pattern.avg_win,
        avg_loss: pattern.avg_loss,
        expected_value: result.overall_ev,
        p_value: result.p_value,
        discovered_at: new Date().toISOString(),
        last_validated: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (patternError || !patternRow) {
      console.error('Failed to store pattern:', patternError?.message);
      continue;
    }

    const patternId = patternRow.id;

    // Store pattern events in batches of 1000
    if (pattern.events.length > 0) {
      const eventRows = pattern.events.map((e) => ({
        pattern_id: patternId,
        date: e.date,
        trigger_candle: e.trigger_candle,
        trigger_value: e.trigger_value,
        predicted_direction: e.predicted_direction,
        predicted_magnitude: e.predicted_magnitude,
        actual_outcome: e.actual_outcome,
        was_correct: e.was_correct,
        profit_pct: e.profit_pct,
      }));

      for (let offset = 0; offset < eventRows.length; offset += 1000) {
        const batch = eventRows.slice(offset, offset + 1000);
        const { error: eventsError } = await supabase
          .from('pattern_events')
          .insert(batch);

        if (eventsError) {
          console.error('Failed to store pattern events:', eventsError.message);
        }
      }
    }

    stored++;
  }

  return stored;
}

/**
 * Update accuracy for live patterns based on recent events.
 * Calculates 30-day accuracy and updates accuracy_trend.
 */
export async function updateAccuracy(stockId: number): Promise<void> {
  // Load live patterns for this stock
  const { data: patterns, error } = await supabase
    .from('patterns')
    .select('id, win_rate, accuracy_30d')
    .eq('stock_id', stockId)
    .eq('lifecycle_stage', 'live');

  if (error || !patterns) return;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  for (const pattern of patterns) {
    // Load recent events
    const { data: events, error: eventsError } = await supabase
      .from('pattern_events')
      .select('was_correct')
      .eq('pattern_id', pattern.id)
      .gte('date', cutoff);

    if (eventsError || !events || events.length === 0) continue;

    const wins = events.filter((e) => e.was_correct).length;
    const accuracy_30d = wins / events.length;

    // Trend: compare to previous win_rate
    let accuracy_trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (pattern.accuracy_30d !== null && pattern.accuracy_30d !== undefined) {
      const diff = accuracy_30d - pattern.accuracy_30d;
      if (diff > 0.05) accuracy_trend = 'improving';
      else if (diff < -0.05) accuracy_trend = 'declining';
    }

    await supabase
      .from('patterns')
      .update({
        accuracy_30d,
        accuracy_trend,
        last_validated: new Date().toISOString(),
      })
      .eq('id', pattern.id);
  }
}

/**
 * Auto-retire degraded patterns (accuracy_30d < 45% for 2+ weeks).
 * Returns count retired.
 */
export async function retireDegraduated(): Promise<number> {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // Patterns that have been last_validated more than 2 weeks ago with low accuracy
  const { data: degraded, error } = await supabase
    .from('patterns')
    .select('id')
    .eq('lifecycle_stage', 'live')
    .lt('accuracy_30d', 0.45)
    .lte('last_validated', twoWeeksAgo.toISOString());

  if (error || !degraded || degraded.length === 0) return 0;

  const ids = degraded.map((p) => p.id);
  const { error: updateError } = await supabase
    .from('patterns')
    .update({
      lifecycle_stage: 'retired',
      retired_at: new Date().toISOString(),
    })
    .in('id', ids);

  if (updateError) {
    console.error('Failed to retire patterns:', updateError.message);
    return 0;
  }

  return ids.length;
}

// Export with the name used in tests (retireDegraduated is internal, export both)
export { retireDegraduated as retireDegraded };

/**
 * Promote validated patterns to live (after 2 weeks in validated stage).
 * Returns count promoted.
 */
export async function promoteValidated(): Promise<number> {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const { data: ready, error } = await supabase
    .from('patterns')
    .select('id')
    .eq('lifecycle_stage', 'validated')
    .lte('discovered_at', twoWeeksAgo.toISOString());

  if (error || !ready || ready.length === 0) return 0;

  const ids = ready.map((p) => p.id);
  const { error: updateError } = await supabase
    .from('patterns')
    .update({ lifecycle_stage: 'live' })
    .in('id', ids);

  if (updateError) {
    console.error('Failed to promote patterns:', updateError.message);
    return 0;
  }

  return ids.length;
}
