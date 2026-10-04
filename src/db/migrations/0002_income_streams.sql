BEGIN;

CREATE TABLE IF NOT EXISTS income_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_settings_id uuid NOT NULL REFERENCES projection_settings(id),
  name varchar(100) NOT NULL,
  net_pay_cents bigint NOT NULL,
  schedule_kind varchar(20),
  payday_anchor date,
  interval_days integer,
  salary_cycle_days varchar(50) NOT NULL DEFAULT '15,30',
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_streams_name_check CHECK (length(btrim(name)) > 0),
  CONSTRAINT income_streams_amount_check CHECK (net_pay_cents > 0 AND net_pay_cents <= 9007199254740991),
  CONSTRAINT income_streams_schedule_check CHECK (
    (schedule_kind IS NULL AND interval_days IS NULL)
    OR (schedule_kind IS NOT NULL AND schedule_kind IN ('weekly', 'biweekly', 'monthly', 'custom')
      AND payday_anchor IS NOT NULL
      AND ((schedule_kind = 'custom' AND interval_days IS NOT NULL AND interval_days BETWEEN 1 AND 366)
        OR (schedule_kind <> 'custom' AND interval_days IS NULL)))
  )
);

INSERT INTO income_streams (
  id, projection_settings_id, name, net_pay_cents,
  schedule_kind, payday_anchor, interval_days, salary_cycle_days
)
SELECT id, id, 'Primary income', expected_salary_amount,
       pay_schedule_kind, biweekly_payday_anchor, pay_interval_days, salary_cycle_days
FROM projection_settings
ON CONFLICT (id) DO NOTHING;

COMMIT;
