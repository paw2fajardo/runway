BEGIN;

CREATE TYPE paycheck_occurrence_kind AS ENUM ('scheduled', 'retry');
CREATE TYPE paycheck_occurrence_status AS ENUM (
  'pending_confirmation',
  'confirmed',
  'reversed_awaiting_retry'
);

ALTER TABLE income_streams
  ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE paycheck_occurrences (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  income_stream_id uuid NOT NULL REFERENCES income_streams(id) ON DELETE RESTRICT,
  kind paycheck_occurrence_kind NOT NULL,
  due_date date NOT NULL,
  retry_date date,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  account_name_snapshot varchar(100),
  amount_snapshot bigint NOT NULL,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  status paycheck_occurrence_status NOT NULL DEFAULT 'pending_confirmation',
  parent_occurrence_id uuid REFERENCES paycheck_occurrences(id) ON DELETE RESTRICT,
  reversal_transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  confirmed_at timestamptz,
  CONSTRAINT paycheck_occurrences_amount_check
    CHECK (amount_snapshot > 0 AND amount_snapshot <= 9007199254740991),
  CONSTRAINT paycheck_occurrences_kind_fields_check CHECK (
    (kind = 'scheduled' AND parent_occurrence_id IS NULL AND retry_date IS NULL)
    OR (kind = 'retry' AND parent_occurrence_id IS NOT NULL AND retry_date IS NOT NULL AND retry_date = due_date)
  )
);

CREATE UNIQUE INDEX uq_paycheck_scheduled_stream_date
  ON paycheck_occurrences (income_stream_id, due_date)
  WHERE kind = 'scheduled';
CREATE UNIQUE INDEX uq_paycheck_retry_parent_date
  ON paycheck_occurrences (parent_occurrence_id, retry_date)
  WHERE kind = 'retry';
CREATE INDEX idx_paycheck_occurrences_due_status
  ON paycheck_occurrences (due_date, status);
CREATE INDEX idx_paycheck_occurrences_stream_date
  ON paycheck_occurrences (income_stream_id, due_date);
CREATE INDEX idx_paycheck_occurrences_parent
  ON paycheck_occurrences (parent_occurrence_id);
CREATE INDEX idx_paycheck_occurrences_transaction
  ON paycheck_occurrences (transaction_id);
CREATE INDEX idx_paycheck_occurrences_reversal
  ON paycheck_occurrences (reversal_transaction_id);

COMMIT;
