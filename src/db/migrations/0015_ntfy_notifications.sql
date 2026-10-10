BEGIN;

CREATE TYPE ntfy_delivery_status AS ENUM ('pending', 'retryable', 'sent');

CREATE TABLE ntfy_deliveries (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  notification_key varchar(180) NOT NULL,
  title varchar(120) NOT NULL,
  message text NOT NULL,
  status ntfy_delivery_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ntfy_deliveries_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX uq_ntfy_deliveries_notification_key ON ntfy_deliveries (notification_key);
CREATE INDEX idx_ntfy_deliveries_retry ON ntfy_deliveries (status, next_attempt_at);

COMMIT;
