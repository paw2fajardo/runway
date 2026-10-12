BEGIN;

ALTER TABLE bill_instances ADD COLUMN cash_paid_at timestamptz;

COMMIT;
