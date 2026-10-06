ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS is_variable_amount boolean NOT NULL DEFAULT false;
