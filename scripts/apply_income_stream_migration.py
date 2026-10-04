"""Apply only the prepared income-stream deposit migration to a local database."""

from __future__ import annotations

import ipaddress
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

from dotenv import load_dotenv
import psycopg


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = REPOSITORY_ROOT / "src" / "db" / "migrations" / "0003_income_stream_deposits.sql"
EXPECTED_DATABASE = "finance_platform"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _require_local_host(host: str) -> None:
    normalized = host.lower().strip("[]")
    if normalized in LOCAL_HOSTS:
        return
    try:
        if ipaddress.ip_address(normalized).is_loopback:
            return
    except ValueError:
        pass
    raise ValueError("Refusing non-local database targets.")


def _normalized_query(query_string: str) -> dict[str, list[str]]:
    options: dict[str, list[str]] = {}
    for raw_name, value in parse_qsl(query_string, keep_blank_values=True):
        name = raw_name.casefold()
        values = options.setdefault(name, [])
        if values and value not in values:
            raise ValueError("Conflicting duplicate DATABASE_URL options are not allowed.")
        if value not in values:
            values.append(value)
    return options


def _parse_target(database_url: str) -> tuple[list[str], list[str], str]:
    try:
        parsed = urlsplit(database_url)
        query = _normalized_query(parsed.query)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError

        path_database = unquote(parsed.path.lstrip("/"))
        database_overrides = query.get("dbname", []) + query.get("database", [])
        databases = [path_database, *database_overrides]
        if not path_database or any(database != EXPECTED_DATABASE for database in databases):
            raise ValueError

        url_host = parsed.hostname
        if not url_host:
            raise ValueError
        hosts = [host for value in query.get("host", []) for host in value.split(",")]
        effective_hosts = hosts or [url_host]
        if not effective_hosts:
            raise ValueError

        host_addresses: list[str] = []
        for value in query.get("hostaddr", []):
            host_addresses.extend(value.split(","))

        if query.get("service") or query.get("servicefile") or query.get("options"):
            raise ValueError("Service-based targets and connection options are not allowed.")

        port_values = query.get("port", [])
        port = int(port_values[-1]) if port_values else (parsed.port or 5432)
        if not 1 <= port <= 65535:
            raise ValueError
        target_host = ",".join(effective_hosts)
        target_address = f" hostaddr={','.join(host_addresses)}" if host_addresses else ""
        return [url_host, *effective_hosts], host_addresses, f"host={target_host}{target_address} port={port} database={EXPECTED_DATABASE}"
    except (ValueError, TypeError, IndexError) as error:
        if str(error) in {
            "Service-based targets and connection options are not allowed.",
            "Conflicting duplicate DATABASE_URL options are not allowed.",
        }:
            raise
        raise ValueError("DATABASE_URL must target the local finance_platform database.") from None


def main() -> int:
    load_dotenv(REPOSITORY_ROOT / ".env", override=False)
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is not set in the environment or repository .env file.", file=sys.stderr)
        return 2

    try:
        hosts, host_addresses, sanitized_target = _parse_target(database_url)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    print(f"Selected database target: {sanitized_target}")
    try:
        for host in hosts:
            _require_local_host(host)
        for address in host_addresses:
            if not ipaddress.ip_address(address).is_loopback:
                raise ValueError("Refusing non-local database targets.")
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    try:
        confirmation = input(f"Type {EXPECTED_DATABASE} to continue: ")
    except EOFError:
        print("No confirmation was provided; no migration was run.", file=sys.stderr)
        return 2
    if confirmation != EXPECTED_DATABASE:
        print("Confirmation did not match; no migration was run.", file=sys.stderr)
        return 2

    expected_migration_path = REPOSITORY_ROOT / "src" / "db" / "migrations" / "0003_income_stream_deposits.sql"
    if expected_migration_path.is_symlink() or MIGRATION_PATH.resolve() != expected_migration_path.absolute():
        print("Refusing to run an unexpected migration path.", file=sys.stderr)
        return 2
    migration_path = expected_migration_path
    migration_sql = migration_path.read_text(encoding="utf-8")

    try:
        with psycopg.connect(database_url, autocommit=True) as connection:
            connection.execute(migration_sql, prepare=False)
    except Exception as error:
        print(f"Migration failed ({type(error).__name__}); connection details were suppressed.", file=sys.stderr)
        return 1

    print("Income-stream migration applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
