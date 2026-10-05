BEGIN;

ALTER TABLE categories
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false;

COMMIT;
