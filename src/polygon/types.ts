export interface PolygonBar {
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
  t: number;  // timestamp (ms)
  n: number;  // number of trades
}

export interface PolygonAggResponse {
  ticker: string;
  status: string;
  resultsCount: number;
  results: PolygonBar[];
  next_url?: string;
}
