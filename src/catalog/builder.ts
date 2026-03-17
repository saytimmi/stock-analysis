import { supabase } from '../db/client.js';
import { PATTERN_TEMPLATES } from './templates.js';
import type { CatalogEntry, BreakdownEntry } from './types.js';

// --- Pure / testable helpers ---

export function confidenceGrade(winRate: number, n: number, sharpe: number): string {
  const score =
    (winRate >= 0.65 ? 2 : winRate >= 0.55 ? 1 : 0) +
    (n >= 100 ? 2 : n >= 50 ? 1 : 0) +
    (sharpe >= 1.5 ? 2 : sharpe >= 1.0 ? 1 : 0);

  if (score >= 6) return 'A+';
  if (score >= 5) return 'A';
  if (score >= 4) return 'B+';
  if (score >= 3) return 'B';
  return 'C';
}

/** Parse a YYYY-MM-DD string into year/month/day without timezone shift. */
function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function getQuarter(dateStr: string): string {
  const { year, month } = parseDateParts(dateStr);
  const q = Math.ceil(month / 3);
  return `Q${q}_${year}`;
}

export function getWeekday(dateStr: string): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  // Use UTC to avoid timezone shift
  const d = new Date(dateStr + 'T12:00:00');
  return days[d.getDay()];
}

interface EventRow {
  date: string;
  was_correct: boolean;
  profit_pct: number | null;
}

export function computeBreakdown(
  events: EventRow[],
  keyFn: (e: EventRow) => string,
): Record<string, BreakdownEntry> {
  const groups: Record<string, { wins: number; n: number; totalReturn: number }> = {};

  for (const ev of events) {
    const key = keyFn(ev);
    if (!groups[key]) groups[key] = { wins: 0, n: 0, totalReturn: 0 };
    groups[key].n++;
    if (ev.was_correct) groups[key].wins++;
    if (ev.profit_pct != null) groups[key].totalReturn += ev.profit_pct;
  }

  const result: Record<string, BreakdownEntry> = {};
  for (const [key, g] of Object.entries(groups)) {
    result[key] = {
      win: g.n > 0 ? Math.round((g.wins / g.n) * 100) / 100 : 0,
      n: g.n,
      avg_return: g.n > 0 ? Math.round((g.totalReturn / g.n) * 100) / 100 : 0,
    };
  }
  return result;
}

// --- Template matching ---

export function matchTemplate(patternType: string): string | null {
  if (PATTERN_TEMPLATES[patternType]) return patternType;

  // Try prefix matching (e.g. "mean_reversion:down:0.7" → "mean_reversion:down:0.5-1.5")
  for (const key of Object.keys(PATTERN_TEMPLATES)) {
    const base = key.split(':').slice(0, 2).join(':');
    const patBase = patternType.split(':').slice(0, 2).join(':');
    if (base === patBase) return key;
  }
  return null;
}

// --- DB-dependent functions ---

export async function buildAvgProfile(
  stockId: number,
  eventDates: string[],
): Promise<number[]> {
  if (eventDates.length === 0) return [];

  const { data, error } = await supabase
    .from('day_profiles')
    .select('profile_vector')
    .eq('stock_id', stockId)
    .in('date', eventDates);

  if (error || !data || data.length === 0) return [];

  const vectors = data
    .map((row) => {
      const raw = row.profile_vector as string;
      // Parse pgvector format "[0.1,0.2,...]"
      const cleaned = raw.replace(/[\[\]]/g, '');
      return cleaned.split(',').map(Number);
    })
    .filter((v) => v.length > 0 && !v.some(isNaN));

  if (vectors.length === 0) return [];

  const len = vectors[0].length;
  const avg = new Array(len).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < Math.min(len, v.length); i++) {
      avg[i] += v[i];
    }
  }
  return avg.map((val) => Math.round((val / vectors.length) * 1000) / 1000);
}

export async function getEarningsPhase(
  stockId: number,
  dateStr: string,
): Promise<'pre_earnings' | 'post_earnings' | 'mid_quarter'> {
  const { data } = await supabase
    .from('day_profiles')
    .select('days_since_earnings, days_until_earnings')
    .eq('stock_id', stockId)
    .eq('date', dateStr)
    .single();

  if (!data) return 'mid_quarter';

  const sincE = data.days_since_earnings as number | null;
  const untilE = data.days_until_earnings as number | null;

  if (sincE != null && sincE <= 5) return 'post_earnings';
  if (untilE != null && untilE <= 5) return 'pre_earnings';
  return 'mid_quarter';
}

export async function buildCatalog(stockId: number): Promise<CatalogEntry[]> {
  // Fetch all patterns for this stock
  const { data: patterns, error: pErr } = await supabase
    .from('patterns')
    .select('*')
    .eq('stock_id', stockId);

  if (pErr || !patterns) return [];

  const entries: CatalogEntry[] = [];

  for (const pat of patterns) {
    const templateKey = matchTemplate(pat.type);
    if (!templateKey) continue;

    const template = PATTERN_TEMPLATES[templateKey];

    // Fetch events for this pattern
    const { data: events } = await supabase
      .from('pattern_events')
      .select('date, was_correct, profit_pct')
      .eq('pattern_id', pat.id);

    const evts: EventRow[] = events ?? [];
    const eventDates = evts.map((e) => e.date);

    // Compute breakdowns
    const quarterBreakdown = computeBreakdown(evts, (e) => getQuarter(e.date));
    const weekdayBreakdown = computeBreakdown(evts, (e) => getWeekday(e.date));

    // Phase breakdown (earnings phase)
    const phaseLabels: string[] = [];
    for (const ev of evts) {
      const phase = await getEarningsPhase(stockId, ev.date);
      phaseLabels.push(phase);
    }
    const phaseBreakdown = computeBreakdown(
      evts.map((ev, i) => ({ ...ev, _phase: phaseLabels[i] })),
      (e) => (e as EventRow & { _phase: string })._phase,
    );

    // Average profile
    const avgProfile = await buildAvgProfile(stockId, eventDates);

    // Compute stats from pattern record
    const winRate = pat.win_rate ?? 0;
    const avgWin = pat.avg_win ?? 0;
    const avgLoss = pat.avg_loss ?? 0;
    const ev = pat.expected_value ?? (winRate * avgWin - (1 - winRate) * Math.abs(avgLoss));
    const riskReward = avgLoss !== 0 ? Math.round((avgWin / Math.abs(avgLoss)) * 100) / 100 : 0;
    const n = pat.occurrences ?? evts.length;

    // Sharpe approximation: EV / stddev of returns
    let sharpe = 0;
    if (evts.length > 1) {
      const returns = evts.map((e) => e.profit_pct ?? 0);
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
      const std = Math.sqrt(variance);
      sharpe = std > 0 ? Math.round((mean / std) * 100) / 100 : 0;
    }

    const grade = confidenceGrade(winRate, n, sharpe);

    entries.push({
      stock_id: stockId,
      pattern_id: pat.id,
      name: template.name,
      name_ru: template.name_ru,
      type: template.type,
      source: pat.source ?? 'system',
      timeframe: template.timeframe,
      description_ru: template.description_ru,
      phases: template.phases,
      conditions: template.conditions,
      win_rate: Math.round(winRate * 100) / 100,
      avg_return: Math.round(avgWin * 100) / 100,
      avg_loss: Math.round(avgLoss * 100) / 100,
      expected_value: Math.round(ev * 100) / 100,
      risk_reward: riskReward,
      sample_size: n,
      sharpe,
      confidence_grade: grade,
      phase_breakdown: phaseBreakdown,
      quarter_breakdown: quarterBreakdown,
      weekday_breakdown: weekdayBreakdown,
      fail_reasons: template.fail_reasons,
      entry_rule: template.entry_rule,
      entry_time: template.entry_time,
      stop_pct: template.stop_pct,
      tp1_pct: template.tp1_pct,
      tp2_pct: template.tp2_pct,
      avg_profile: avgProfile,
    });
  }

  return entries;
}

export async function storeCatalog(entries: CatalogEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const rows = entries.map((e) => ({
    stock_id: e.stock_id,
    pattern_id: e.pattern_id,
    name: e.name,
    name_ru: e.name_ru,
    type: e.type,
    source: e.source,
    timeframe: e.timeframe,
    description_ru: e.description_ru,
    phases: e.phases,
    conditions: e.conditions,
    win_rate: e.win_rate,
    avg_return: e.avg_return,
    avg_loss: e.avg_loss,
    expected_value: e.expected_value,
    risk_reward: e.risk_reward,
    sample_size: e.sample_size,
    sharpe: e.sharpe,
    confidence_grade: e.confidence_grade,
    phase_breakdown: e.phase_breakdown,
    quarter_breakdown: e.quarter_breakdown,
    weekday_breakdown: e.weekday_breakdown,
    fail_reasons: e.fail_reasons,
    entry_rule: e.entry_rule,
    entry_time: e.entry_time,
    stop_pct: e.stop_pct,
    tp1_pct: e.tp1_pct,
    tp2_pct: e.tp2_pct,
    avg_profile: e.avg_profile,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('pattern_catalog')
    .upsert(rows, { onConflict: 'stock_id,pattern_id' });

  if (error) throw new Error(`storeCatalog failed: ${error.message}`);
}
