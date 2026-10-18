CREATE TABLE forecast_baselines (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  forecast jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
