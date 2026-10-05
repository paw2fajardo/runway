BEGIN;

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS due_day_of_week smallint;

WITH weekly_days AS (
  SELECT b.id,
         COALESCE(EXTRACT(DOW FROM MIN(bi.due_date)), EXTRACT(DOW FROM b.created_at))::smallint AS due_day
  FROM bills AS b
  LEFT JOIN bill_instances AS bi ON bi.bill_id = b.id
  WHERE b.frequency IN ('weekly', 'biweekly')
  GROUP BY b.id, b.created_at
)
UPDATE bills AS b
SET due_day_of_week = weekly_days.due_day
FROM weekly_days
WHERE weekly_days.id = b.id
  AND b.due_day_of_week IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bills_due_day_by_frequency_check'
      AND conrelid = 'bills'::regclass
  ) THEN
    ALTER TABLE bills
      ADD CONSTRAINT bills_due_day_by_frequency_check
        CHECK (
          (frequency IN ('weekly', 'biweekly') AND due_day_of_week BETWEEN 0 AND 6 AND due_day_of_month BETWEEN 1 AND 31)
          OR
          (frequency NOT IN ('weekly', 'biweekly') AND due_day_of_month BETWEEN 1 AND 31 AND due_day_of_week IS NULL)
        );
  END IF;
END;
$$;

COMMIT;
