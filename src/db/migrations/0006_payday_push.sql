BEGIN;

CREATE TYPE paycheck_push_delivery_status AS ENUM (
  'pending',
  'retryable',
  'sent',
  'expired'
);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  owner_id integer NOT NULL REFERENCES owner_auth(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  endpoint_hash varchar(64) NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_hash_check
    CHECK (endpoint_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX uq_push_subscriptions_endpoint_hash
  ON push_subscriptions (endpoint_hash);
CREATE INDEX idx_push_subscriptions_owner_id
  ON push_subscriptions (owner_id);

CREATE TABLE paycheck_push_deliveries (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES paycheck_occurrences(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  endpoint_hash_snapshot varchar(64) NOT NULL,
  status paycheck_push_delivery_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paycheck_push_deliveries_endpoint_hash_check
    CHECK (endpoint_hash_snapshot ~ '^[0-9a-f]{64}$'),
  CONSTRAINT paycheck_push_deliveries_attempt_count_check
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX uq_paycheck_push_occurrence_endpoint
  ON paycheck_push_deliveries (occurrence_id, endpoint_hash_snapshot);
CREATE INDEX idx_paycheck_push_deliveries_retry
  ON paycheck_push_deliveries (status, next_attempt_at);

COMMIT;
