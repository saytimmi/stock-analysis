const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:54321/functions/v1';

async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

export interface PatternCatalogItem {
  id: string;
  ticker: string;
  pattern_name: string;
  description_ru: string;
  source: 'system' | 'user';
  timeframe: string;
  win_rate: number;
  avg_return: number;
  avg_rr: number;
  sample_size: number;
  tags: string[];
  phases: string[];
  sparkline_path?: string;
  grade?: string;
  confidence_pct?: number;
  timeline_steps?: TimelineStep[];
  conditions?: ConditionItem[];
  fail_reasons?: FailReason[];
  breakdown_by_quarter?: BreakdownRow[];
  breakdown_by_weekday?: BreakdownRow[];
  breakdown_by_earnings_phase?: BreakdownRow[];
  example_days?: ExampleDay[];
  trade_levels?: TradeLevels;
  stats_extra?: Record<string, string | number>;
}

export interface TimelineStep {
  time: string;
  color: 'red' | 'green' | 'blue' | 'orange';
  description: string;
  detail?: string;
}

export interface ConditionItem {
  icon: string;
  bg: string;
  text: string;
}

export interface FailReason {
  pct: string;
  text: string;
}

export interface BreakdownRow {
  name: string;
  pct: number;
  count: number;
  level: 'high' | 'mid' | 'low';
}

export interface ExampleDay {
  date: string;
  label: string;
  result: string;
  resultClass: 'win' | 'loss';
  ohlc: string;
  tags: string[];
  sparklinePath?: string;
}

export interface TradeLevels {
  tp2: { price: string; pct: string };
  tp1: { price: string; pct: string };
  entry: { price: string };
  stop: { price: string; pct: string };
  rr: string;
  timing?: { label: string; value: string }[];
  expectancy?: string;
}

export interface SignalData {
  id: string;
  ticker: string;
  pattern_id: string;
  pattern_name: string;
  match_pct: number;
  signal_type: string;
  narrative_ru: string;
  phase_current: string;
  phases: { name: string; done: boolean; active: boolean }[];
  trade_levels: TradeLevels;
  tags: { label: string; type: 'bullish' | 'bearish' | 'neutral' | 'info' }[];
  created_at: string;
}

export interface PriceData {
  ticker: string;
  price: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  gap_pct: number;
  market_status: string;
}

export interface MarketContext {
  ticker: string;
  change_pct: number;
}

export interface HistoryDay {
  date: string;
  day_label: string;
  result_pct: number;
  ohlc: { o: number; h: number; l: number; c: number };
  pattern_name: string;
  prediction: string;
  correct: boolean;
}

export const api = {
  getCatalog: (ticker: string) =>
    fetchApi<PatternCatalogItem[]>('/catalog', { ticker }),

  getSignals: (ticker: string) =>
    fetchApi<SignalData[]>('/signals', { ticker }),

  getPrice: (ticker: string) =>
    fetchApi<PriceData>('/price', { ticker }),

  getHistory: (ticker: string, from?: string, to?: string) =>
    fetchApi<HistoryDay[]>('/history', { ticker, ...(from && { from }), ...(to && { to }) }),

  getStocks: () =>
    fetchApi<{ ticker: string; name: string }[]>('/stocks'),
};
