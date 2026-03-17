-- Pattern catalog: enriched patterns for Mini App display
create table pattern_catalog (
  id serial primary key,
  stock_id integer not null references stocks(id),
  pattern_id integer references patterns(id),
  name text not null,
  name_ru text not null,
  type text not null check (type in ('intraday', 'multi_day')),
  source text not null check (source in ('system', 'user')),
  timeframe text not null,
  description_ru text not null,
  phases jsonb not null default '[]',
  conditions jsonb not null default '[]',
  win_rate numeric(5,4) not null,
  avg_return numeric(8,4) not null,
  avg_loss numeric(8,4),
  expected_value numeric(8,4),
  risk_reward numeric(5,2),
  sample_size integer not null,
  sharpe numeric(5,2),
  confidence_grade text,
  phase_breakdown jsonb default '{}',
  quarter_breakdown jsonb default '{}',
  weekday_breakdown jsonb default '{}',
  fail_reasons jsonb default '[]',
  entry_rule text,
  entry_time text,
  stop_pct numeric(5,2),
  tp1_pct numeric(5,2),
  tp2_pct numeric(5,2),
  avg_profile real[] not null default '{}',
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(stock_id, name)
);

create index idx_pattern_catalog_stock on pattern_catalog(stock_id);
create index idx_pattern_catalog_active on pattern_catalog(stock_id, active);
