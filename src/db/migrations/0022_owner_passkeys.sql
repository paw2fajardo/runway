BEGIN;

CREATE TABLE owner_passkeys (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  owner_id integer NOT NULL REFERENCES owner_auth(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text,
  device_name varchar(100) NOT NULL DEFAULT 'Device',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE UNIQUE INDEX uq_owner_passkeys_credential_id
  ON owner_passkeys (credential_id);
CREATE INDEX idx_owner_passkeys_owner_id
  ON owner_passkeys (owner_id);

COMMIT;
