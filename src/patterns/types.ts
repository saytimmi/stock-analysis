export interface PatternCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  pct_from_open: number;
  relative_move: number;
}

export interface DayData {
  date: string;
  candles: PatternCandle[];  // regular session 15-min candles
  day_change_pct: number;
  gap_pct: number | null;
  day_of_week: number;
}

export interface PatternEvent {
  date: string;
  trigger_candle: number;
  trigger_value: number;
  predicted_direction: 'up' | 'down';
  predicted_magnitude: number;
  actual_outcome: number;
  was_correct: boolean;
  profit_pct: number;
}

export interface DiscoveredPattern {
  type: string;
  description: string;
  parameters: Record<string, any>;
  events: PatternEvent[];
  occurrences: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  expected_value: number;
}
