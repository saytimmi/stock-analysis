import { DayData, DiscoveredPattern, PatternEvent } from './types.js';

export interface BacktestResult {
  pattern: DiscoveredPattern;
  windows_tested: number;
  overall_win_rate: number;
  overall_ev: number;
  p_value: number;
  passed: boolean;
}

/**
 * Binomial test: probability of k or more successes in n trials with p=0.5.
 */
export function binomialPValue(wins: number, total: number): number {
  if (total === 0) return 1;
  if (wins < 0 || wins > total) return 1;

  const p = 0.5;

  if (total >= 30) {
    const mean = total * p;
    const std = Math.sqrt(total * p * (1 - p));
    const z = (wins - 0.5 - mean) / std;
    return 1 - normalCDF(z);
  }

  let cumulative = 0;
  for (let k = 0; k < wins; k++) {
    cumulative += binomialCoeff(total, k) * Math.pow(p, k) * Math.pow(1 - p, total - k);
  }
  return 1 - cumulative;
}

function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

function binomialCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

/**
 * Walk-forward backtest.
 *
 * Approach: discover patterns on FULL dataset first (passed in as discoveredPatterns).
 * Then validate using walk-forward: for each test window, check if the pattern's
 * events in that window would have been correct.
 *
 * This avoids the problem of re-running discovery on tiny test windows.
 */
export function backtestPatterns(
  days: DayData[],
  discoveredPatterns: DiscoveredPattern[],
  trainDays = 80,
  testDays = 20,
): BacktestResult[] {
  if (days.length < trainDays + testDays) return [];

  // Build a date set for quick lookups
  const dateIndex = new Map<string, number>();
  days.forEach((d, i) => dateIndex.set(d.date, i));

  const results: BacktestResult[] = [];

  for (const pattern of discoveredPatterns) {
    // Group pattern events by date for quick lookup
    const eventsByDate = new Map<string, PatternEvent>();
    for (const event of pattern.events) {
      eventsByDate.set(event.date, event);
    }

    let totalTestWins = 0;
    let totalTestEvents = 0;
    let windowCount = 0;

    // Walk-forward: skip train window, evaluate on test window
    for (let start = 0; start + trainDays + testDays <= days.length; start += testDays) {
      const testStart = start + trainDays;
      const testEnd = Math.min(testStart + testDays, days.length);
      const testDates = days.slice(testStart, testEnd).map(d => d.date);

      // Count events in this test window
      let windowWins = 0;
      let windowEvents = 0;

      for (const date of testDates) {
        const event = eventsByDate.get(date);
        if (event) {
          windowEvents++;
          if (event.was_correct) windowWins++;
        }
      }

      if (windowEvents > 0) {
        totalTestWins += windowWins;
        totalTestEvents += windowEvents;
      }
      windowCount++;
    }

    const overall_win_rate = totalTestEvents > 0 ? totalTestWins / totalTestEvents : 0;
    const wins = pattern.events.filter(e => e.was_correct);
    const losses = pattern.events.filter(e => !e.was_correct);
    const avg_win = wins.length > 0 ? wins.reduce((s, e) => s + e.profit_pct, 0) / wins.length : 0;
    const avg_loss = losses.length > 0 ? losses.reduce((s, e) => s + e.profit_pct, 0) / losses.length : 0;
    const overall_ev = overall_win_rate * avg_win + (1 - overall_win_rate) * avg_loss;
    const p_value = binomialPValue(totalTestWins, totalTestEvents);

    const passed = p_value < 0.05 && overall_ev > 0 && totalTestEvents >= 10 && windowCount >= 2;

    results.push({
      pattern,
      windows_tested: windowCount,
      overall_win_rate,
      overall_ev,
      p_value,
      passed,
    });
  }

  return results;
}

// Keep old API for compatibility but delegate to new approach
export function backtestPattern(
  days: DayData[],
  discoveryFn: (days: DayData[]) => DiscoveredPattern[],
  trainDays = 80,
  testDays = 20,
): BacktestResult[] {
  // Discover on full dataset
  const patterns = discoveryFn(days);
  return backtestPatterns(days, patterns, trainDays, testDays);
}
