ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS auto_post_from date;

CREATE TABLE IF NOT EXISTS bill_payment_events (
  transaction_id uuid PRIMARY KEY REFERENCES transactions(id),
  bill_instance_id uuid NOT NULL REFERENCES bill_instances(id),
  kind varchar(20) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bill_payment_events_instance
  ON bill_payment_events (bill_instance_id);
