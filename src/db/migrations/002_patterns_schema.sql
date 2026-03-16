-- Discovered patterns
create table patterns (
  id serial primary key,
  stock_id integer not null references stocks(id),
  type text not null,
  source text not null default 'algorithmic' check (source in ('algorithmic', 'user')),
  description text not null,
  parameters jsonb not null,
  lifecycle_stage text not null default 'discovered'
    check (lifecycle_stage in ('discovered', 'backtested', 'validated', 'live', 'monitored', 'degraded', 'retired')),
  discovered_at timestamptz default now(),
  last_validated timestamptz,
  retired_at timestamptz,
  occurrences integer default 0,
  win_rate numeric(5,2),
  avg_win numeric(8,4),
  avg_loss numeric(8,4),
  expected_value numeric(8,4),
  p_value numeric(8,6),
  accuracy_30d numeric(5,2),
  accuracy_trend text check (accuracy_trend in ('improving', 'stable', 'degrading'))
);

create index idx_patterns_stock on patterns(stock_id);
create index idx_patterns_stage on patterns(lifecycle_stage);

-- Each time a pattern triggered historically or in live
create table pattern_events (
  id bigserial primary key,
  pattern_id integer not null references patterns(id),
  date date not null,
  trigger_candle smallint,
  trigger_value numeric(8,4),
  predicted_direction text check (predicted_direction in ('up', 'down')),
  predicted_magnitude numeric(8,4),
  actual_outcome numeric(8,4),
  was_correct boolean,
  profit_pct numeric(8,4)
);

create index idx_pattern_events_pattern on pattern_events(pattern_id);
create index idx_pattern_events_date on pattern_events(date);
