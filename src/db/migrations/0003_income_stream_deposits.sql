BEGIN;

ALTER TABLE income_streams
  ADD COLUMN IF NOT EXISTS destination_account_id uuid
  REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_account_set_date date;

CREATE TABLE IF NOT EXISTS income_stream_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  income_stream_id uuid NOT NULL
    REFERENCES income_streams(id) ON DELETE RESTRICT,
  scheduled_date date NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  amount_cents bigint NOT NULL,
  deposited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_stream_deposits_amount_check
    CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991)
);

CREATE UNIQUE INDEX IF NOT EXISTS income_stream_deposits_stream_date_unique
  ON income_stream_deposits (income_stream_id, scheduled_date);

COMMIT;
