BEGIN;

CREATE TABLE bill_push_deliveries (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  bill_instance_id uuid NOT NULL REFERENCES bill_instances(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  endpoint_hash_snapshot varchar(64) NOT NULL,
  reminder_date date NOT NULL,
  status paycheck_push_delivery_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_push_deliveries_endpoint_hash_check
    CHECK (endpoint_hash_snapshot ~ '^[0-9a-f]{64}$'),
  CONSTRAINT bill_push_deliveries_attempt_count_check
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX uq_bill_push_instance_endpoint_reminder
  ON bill_push_deliveries (bill_instance_id, endpoint_hash_snapshot, reminder_date);
CREATE INDEX idx_bill_push_deliveries_retry
  ON bill_push_deliveries (status, next_attempt_at);

COMMIT;
