ALTER TABLE bills
  ADD COLUMN frequency varchar(20) NOT NULL DEFAULT 'monthly';

ALTER TABLE bills
  ADD CONSTRAINT bills_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'every_2_months', 'every_3_months', 'every_6_months', 'annually'));
