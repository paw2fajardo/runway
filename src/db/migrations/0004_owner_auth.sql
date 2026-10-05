BEGIN;

CREATE TABLE owner_auth (
  id integer PRIMARY KEY NOT NULL DEFAULT 1,
  username varchar(80) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_auth_singleton_check CHECK (id = 1)
);

CREATE TABLE owner_sessions (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  owner_id integer NOT NULL REFERENCES owner_auth(id) ON DELETE CASCADE,
  token_digest varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT owner_sessions_token_digest_check
    CHECK (token_digest ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX uq_owner_sessions_token_digest
  ON owner_sessions (token_digest);
CREATE INDEX idx_owner_sessions_owner_id
  ON owner_sessions (owner_id);

COMMIT;
