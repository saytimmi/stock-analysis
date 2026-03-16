-- Enable pgvector extension for similarity search
create extension if not exists vector;

-- Tracked stocks
create table stocks (
  id serial primary key,
  ticker text not null unique,
  name text,
  sector text,
  added_at timestamptz default now(),
  active boolean default true
);

-- 15-minute intraday candles
create table candles_15m (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  date date not null,
  time time not null,
  session text not null check (session in ('pre_market', 'regular', 'after_hours')),
  open numeric(12,4) not null,
  high numeric(12,4) not null,
  low numeric(12,4) not null,
  close numeric(12,4) not null,
  volume bigint not null,
  pct_from_open numeric(8,4),
  relative_move numeric(8,4),
  unique(stock_id, date, time)
);

create index idx_candles_15m_stock_date on candles_15m(stock_id, date);
create index idx_candles_15m_stock_date_session on candles_15m(stock_id, date, session);

-- Daily OHLCV candles
create table candles_daily (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  date date not null,
  open numeric(12,4) not null,
  high numeric(12,4) not null,
  low numeric(12,4) not null,
  close numeric(12,4) not null,
  volume bigint not null,
  gap_pct numeric(8,4),
  unique(stock_id, date)
);

create index idx_candles_daily_stock_date on candles_daily(stock_id, date);

-- Earnings dates per stock (for quarterly cycle tracking)
create table earnings_dates (
  id serial primary key,
  stock_id integer not null references stocks(id),
  date date not null,
  quarter text, -- e.g. 'Q1 2025', 'Q4 2024'
  unique(stock_id, date)
);

create index idx_earnings_stock_date on earnings_dates(stock_id, date);

-- Computed day profiles for similarity search
create table day_profiles (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  date date not null,
  open_price numeric(12,4) not null,
  day_change_pct numeric(8,4),
  profile_vector vector(26),
  relative_profile_vector vector(26),
  volume_profile real[],
  pre_market_direction text check (pre_market_direction in ('up', 'down', 'flat')),
  pre_market_volume_ratio numeric(8,4),
  is_earnings boolean default false,
  is_opex boolean default false,
  day_of_week smallint,
  candle_count smallint,
  -- Quarterly earnings cycle context
  days_since_earnings smallint,    -- how many trading days since last earnings
  days_until_earnings smallint,    -- how many trading days until next earnings
  earnings_quarter text,           -- which quarter we're in (e.g. 'Q1 2025')
  quarter_position numeric(5,4),   -- 0.0 = right after earnings, 1.0 = right before next
  unique(stock_id, date)
);

create index idx_day_profiles_stock_date on day_profiles(stock_id, date);

-- Market context (SPY/QQQ) for relative move computation
create table market_context (
  id bigserial primary key,
  date date not null,
  time time not null,
  spy_open numeric(12,4),
  spy_close numeric(12,4),
  spy_pct_from_open numeric(8,4),
  spy_volume bigint,
  qqq_open numeric(12,4),
  qqq_close numeric(12,4),
  qqq_pct_from_open numeric(8,4),
  qqq_volume bigint,
  unique(date, time)
);

create index idx_market_context_date on market_context(date);

-- Insert default stock
insert into stocks (ticker, name, sector) values ('ALAB', 'Astera Labs', 'Semiconductors');
