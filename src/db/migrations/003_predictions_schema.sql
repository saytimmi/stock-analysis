-- Predictions tracking (feedback loop)
create table predictions (
  id bigserial primary key,
  stock_id integer not null references stocks(id),
  created_at timestamptz default now(),
  composite_score numeric(6,2),
  confidence text check (confidence in ('low', 'medium', 'high')),
  predicted_direction text check (predicted_direction in ('up', 'down')),
  predicted_magnitude numeric(8,4),
  pattern_ids integer[],
  analog_dates text[],
  analog_scores numeric(8,4)[],
  candles_matched smallint,
  actual_outcome numeric(8,4),
  was_correct boolean,
  profit_if_followed numeric(8,4),
  filled_at timestamptz
);

create index idx_predictions_stock on predictions(stock_id);
create index idx_predictions_date on predictions(created_at);
