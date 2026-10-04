ALTER TABLE projection_settings
  ADD COLUMN IF NOT EXISTS pay_schedule_kind varchar(20),
  ADD COLUMN IF NOT EXISTS pay_interval_days integer;
