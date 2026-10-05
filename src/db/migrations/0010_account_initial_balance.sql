BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS initial_balance bigint;

UPDATE accounts AS account
SET initial_balance = account.current_balance
  - COALESCE((
      SELECT SUM(leg.amount)
      FROM transaction_legs AS leg
      WHERE leg.account_id = account.id
    ), 0)
  - COALESCE((
      SELECT SUM(deposit.amount_cents)
      FROM income_stream_deposits AS deposit
      WHERE deposit.account_id = account.id
    ), 0);

ALTER TABLE accounts
  ALTER COLUMN initial_balance SET NOT NULL,
  ALTER COLUMN initial_balance SET DEFAULT 0;

COMMIT;
