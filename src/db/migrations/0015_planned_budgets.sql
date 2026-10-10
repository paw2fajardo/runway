BEGIN;

CREATE TABLE planned_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991),
  start_date date NOT NULL,
  cadence varchar(20) NOT NULL CHECK (cadence IN ('once', 'weekly', 'biweekly', 'monthly')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
