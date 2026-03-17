-- Daily signals: which patterns matched today, at what confidence
create table pattern_signals (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  catalog_id integer not null references pattern_catalog(id),
  date date not null,
  match_pct numeric(5,2) not null,
  current_phase text,
  phase_progress jsonb,
  open_price numeric(12,4),
  entry_price numeric(12,4),
  stop_price numeric(12,4),
  tp1_price numeric(12,4),
  tp2_price numeric(12,4),
  current_price numeric(12,4),
  market_context jsonb,
  tags text[],
  analysis_text text,
  actual_close numeric(12,4),
  actual_return numeric(8,4),
  was_correct boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(stock_id, catalog_id, date)
);

create index idx_signals_stock_date on pattern_signals(stock_id, date);
create index idx_signals_date on pattern_signals(date desc);
