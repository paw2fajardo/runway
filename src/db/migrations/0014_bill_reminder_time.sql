BEGIN;

ALTER TABLE projection_settings
  ADD COLUMN bill_reminder_time varchar(5) NOT NULL DEFAULT '09:00',
  ADD CONSTRAINT projection_settings_bill_reminder_time_check
    CHECK (bill_reminder_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');

COMMIT;
