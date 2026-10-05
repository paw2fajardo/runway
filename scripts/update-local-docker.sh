#!/usr/bin/env bash
set -Eeuo pipefail

# Refresh the local Docker app after code or SQL migrations change.
# This script intentionally targets a local Docker engine and never runs db:push.

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Error: docker is not installed or not on PATH.\n' >&2
  exit 1
fi

if [[ -n "${DOCKER_HOST:-}" ]]; then
  printf 'Error: DOCKER_HOST is set; refusing to run against an unverified engine.\n' >&2
  exit 1
fi

if [[ -n "${DOCKER_CONTEXT:-}" ]]; then
  docker_context="$DOCKER_CONTEXT"
  docker_endpoint="$(docker context inspect "$docker_context" --format '{{.Endpoints.docker.Host}}')"
else
  docker_context="$(docker context show)"
  docker_endpoint="$(docker context inspect "$docker_context" --format '{{.Endpoints.docker.Host}}')"
fi

case "$docker_endpoint" in
  unix://*|npipe://*) ;;
  *)
    printf 'Error: Docker endpoint is not local (%s); refusing to continue.\n' "$docker_endpoint" >&2
    exit 1
    ;;
esac

compose=(docker compose)
for migration in \
  src/db/migrations/0009_bill_due_day_of_week.sql \
  src/db/migrations/0010_account_initial_balance.sql; do
  if [[ ! -f "$migration" ]]; then
    printf 'Error: required migration file is missing: %s\n' "$migration" >&2
    exit 1
  fi
done

printf 'Starting local database...\n'
"${compose[@]}" up -d db

printf 'Waiting for local database readiness...\n'
ready=false
for ((attempt = 1; attempt <= 30; attempt++)); do
  if "${compose[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  printf 'Error: local database did not become ready within 60 seconds.\n' >&2
  exit 1
fi

printf 'Checking migration prerequisites...\n'
"${compose[@]}" exec -T db sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(required.name, ', ' ORDER BY required.name)
  INTO missing
  FROM (VALUES
    ('bills.id'),
    ('bills.created_at'),
    ('bills.due_day_of_month'),
    ('bill_instances.bill_id'),
    ('bill_instances.due_date'),
    ('bill_instances.period_identifier'),
    ('accounts.id'),
    ('accounts.current_balance'),
    ('transaction_legs.account_id'),
    ('transaction_legs.amount'),
    ('income_stream_deposits.account_id'),
    ('income_stream_deposits.amount_cents')
  ) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = current_schema()
      AND column_info.table_name = split_part(required.name, '.', 1)
      AND column_info.column_name = split_part(required.name, '.', 2)
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot update local schema; required existing tables or columns are missing: %. Apply the earlier base migrations first, then rerun this script.', missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bill_instances
    WHERE length(period_identifier) > 10
  ) THEN
    RAISE EXCEPTION 'Cannot apply migration 0008: bill_instances.period_identifier contains values longer than 10 characters. Resolve those rows before rerunning this script.';
  END IF;
END;
$$;
SQL

backup_file="$(mktemp "${TMPDIR:-/tmp}/runway-local-before-update.XXXXXX.dump")"
printf 'Creating custom-format database backup at: %s\n' "$backup_file"
if ! "${compose[@]}" exec -T db sh -c \
  'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$backup_file"; then
  rm -f -- "$backup_file"
  printf 'Error: database backup failed.\n' >&2
  exit 1
fi

printf 'Applying missing prerequisites from migrations 0007 and 0008...\n'
"${compose[@]}" exec -T db sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS frequency varchar(20) NOT NULL DEFAULT 'monthly';

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS occurrence_limit smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bills_frequency_check'
      AND conrelid = 'bills'::regclass
  ) THEN
    ALTER TABLE bills
      ADD CONSTRAINT bills_frequency_check
      CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'every_2_months', 'every_3_months', 'every_6_months', 'annually'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bills_occurrence_limit_check'
      AND conrelid = 'bills'::regclass
  ) THEN
    ALTER TABLE bills
      ADD CONSTRAINT bills_occurrence_limit_check
      CHECK (occurrence_limit IS NULL OR occurrence_limit BETWEEN 1 AND 600);
  END IF;
END;
$$;

ALTER TABLE bill_instances
  ALTER COLUMN period_identifier TYPE varchar(10);

COMMIT;
SQL

for migration in \
  src/db/migrations/0009_bill_due_day_of_week.sql \
  src/db/migrations/0010_account_initial_balance.sql; do
  printf 'Applying %s...\n' "$migration"
  "${compose[@]}" exec -T db sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration"
done

printf 'Building and starting app and payday-worker...\n'
"${compose[@]}" up -d --build app payday-worker
"${compose[@]}" ps app payday-worker

printf 'Local Docker update finished. Database backup: %s\n' "$backup_file"
