BEGIN;

-- NULL preserves the existing single reminder time until schedules are saved.
ALTER TABLE projection_settings ADD COLUMN bill_notification_schedules jsonb;

COMMIT;
