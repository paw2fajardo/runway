BEGIN;

CREATE TABLE owner_challenges (
  key varchar(255) PRIMARY KEY NOT NULL,
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_owner_challenges_expires_at
  ON owner_challenges (expires_at);

COMMIT;
