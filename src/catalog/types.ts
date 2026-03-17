export interface PatternPhase {
  time: string;
  name: string;
  name_ru: string;
  color: 'red' | 'green' | 'blue' | 'orange';
  description_ru: string;
  avg_move: number;
  example: string;
}

export interface PatternCondition {
  icon: string;
  text_ru: string;
}

export interface FailReason {
  pct: number;
  reason: string;
  description_ru: string;
}

export interface BreakdownEntry {
  win: number;
  n: number;
  avg_return?: number;
}

export interface CatalogEntry {
  stock_id: number;
  pattern_id?: number;
  name: string;
  name_ru: string;
  type: 'intraday' | 'multi_day';
  source: 'system' | 'user';
  timeframe: string;
  description_ru: string;
  phases: PatternPhase[];
  conditions: PatternCondition[];
  win_rate: number;
  avg_return: number;
  avg_loss: number;
  expected_value: number;
  risk_reward: number;
  sample_size: number;
  sharpe: number;
  confidence_grade: string;
  phase_breakdown: Record<string, BreakdownEntry>;
  quarter_breakdown: Record<string, BreakdownEntry>;
  weekday_breakdown: Record<string, BreakdownEntry>;
  fail_reasons: FailReason[];
  entry_rule: string;
  entry_time: string;
  stop_pct: number;
  tp1_pct: number;
  tp2_pct: number;
  avg_profile: number[];
}
