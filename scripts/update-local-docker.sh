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

backup_file="$(mktemp "${TMPDIR:-/tmp}/runway-local-before-update.XXXXXX.dump")"
printf 'Creating custom-format database backup at: %s\n' "$backup_file"
if ! "${compose[@]}" exec -T db sh -c \
  'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$backup_file"; then
  rm -f -- "$backup_file"
  printf 'Error: database backup failed.\n' >&2
  exit 1
fi

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
