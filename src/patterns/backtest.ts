import { DayData, DiscoveredPattern } from './types.js';

export interface BacktestResult {
  pattern: DiscoveredPattern;
  windows_tested: number;
  overall_win_rate: number;
  overall_ev: number;
  p_value: number;
  passed: boolean; // p_value < 0.05 && ev > 0 && occurrences >= 30
}

/**
 * Binomial test: probability of k or more successes in n trials with p=0.5.
 * Uses exact computation for small n, normal approximation for large n.
 */
export function binomialPValue(wins: number, total: number): number {
  if (total === 0) return 1;
  if (wins < 0 || wins > total) return 1;

  const p = 0.5;

  // Normal approximation for large n (n >= 30)
  if (total >= 30) {
    const mean = total * p;
    const std = Math.sqrt(total * p * (1 - p));
    // z-score with continuity correction
    const z = (wins - 0.5 - mean) / std;
    // Two-sided? The task says "probability of observed win_rate given null of 50%"
    // We want P(X >= wins) = upper tail
    return 1 - normalCDF(z);
  }

  // Exact binomial CDF for small n: P(X >= wins) = 1 - P(X <= wins-1)
  let cumulative = 0;
  for (let k = 0; k < wins; k++) {
    cumulative += binomialCoeff(total, k) * Math.pow(p, k) * Math.pow(1 - p, total - k);
  }
  return 1 - cumulative;
}

function normalCDF(z: number): number {
  // Approximation of standard normal CDF
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
 * Run walk-forward backtest on a single discovery function.
 * Split data into windows: train on trainDays, test on testDays, roll by testDays.
 */
export function backtestPattern(
  days: DayData[],
  discoveryFn: (days: DayData[]) => DiscoveredPattern[],
  trainDays = 80,
  testDays = 20,
): BacktestResult[] {
  if (days.length < trainDays + testDays) return [];

  // Aggregate results per pattern key across all windows
  const patternAggregates = new Map<string, {
    pattern: DiscoveredPattern;
    totalWins: number;
    totalEvents: number;
    totalEV: number;
    windowCount: number;
  }>();

  // Roll forward by testDays each time
  for (let start = 0; start + trainDays + testDays <= days.length; start += testDays) {
    const trainSet = days.slice(start, start + trainDays);
    const testSet = days.slice(start + trainDays, start + trainDays + testDays);

    if (testSet.length < testDays) break;

    // Discover patterns on train set
    const trainPatterns = discoveryFn(trainSet);

    // For each discovered pattern, evaluate on test set
    for (const trainPattern of trainPatterns) {
      // Re-run on test set with same discovery fn, find matching pattern
      const testPatterns = discoveryFn(testSet);
      const matchingTest = testPatterns.find(
        (tp) =>
          tp.type === trainPattern.type &&
          JSON.stringify(tp.parameters) === JSON.stringify(trainPattern.parameters),
      );

      const key = `${trainPattern.type}::${JSON.stringify(trainPattern.parameters)}`;

      if (!patternAggregates.has(key)) {
        patternAggregates.set(key, {
          pattern: trainPattern,
          totalWins: 0,
          totalEvents: 0,
          totalEV: 0,
          windowCount: 0,
        });
      }

      const agg = patternAggregates.get(key)!;
      agg.windowCount++;

      if (matchingTest && matchingTest.events.length > 0) {
        const wins = matchingTest.events.filter((e) => e.was_correct).length;
        agg.totalWins += wins;
        agg.totalEvents += matchingTest.events.length;
        agg.totalEV += matchingTest.expected_value;
      }
    }
  }

  const results: BacktestResult[] = [];

  for (const [, agg] of patternAggregates) {
    const overall_win_rate = agg.totalEvents > 0 ? agg.totalWins / agg.totalEvents : 0;
    const overall_ev = agg.windowCount > 0 ? agg.totalEV / agg.windowCount : 0;
    const p_value = binomialPValue(agg.totalWins, agg.totalEvents);

    const passed =
      p_value < 0.05 && overall_ev > 0 && agg.totalEvents >= 30;

    results.push({
      pattern: agg.pattern,
      windows_tested: agg.windowCount,
      overall_win_rate,
      overall_ev,
      p_value,
      passed,
    });
  }

  return results;
}
