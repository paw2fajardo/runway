ALTER TABLE bills
  ADD COLUMN occurrence_limit smallint,
  ADD CONSTRAINT bills_occurrence_limit_check
    CHECK (occurrence_limit IS NULL OR occurrence_limit BETWEEN 1 AND 600);

ALTER TABLE bill_instances
  ALTER COLUMN period_identifier TYPE varchar(10);
