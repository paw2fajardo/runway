import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ownerAuth, ownerSessions } from "../../src/db/schema";

describe("owner authentication schema", () => {
  it("allows at most one owner row", () => {
    const config = getTableConfig(ownerAuth);

    expect(config.name).toBe("owner_auth");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "username",
      "password_hash",
      "created_at",
      "updated_at",
    ]);
    expect(config.checks.map((constraint) => constraint.name)).toContain(
      "owner_auth_singleton_check"
    );
  });

  it("stores revocable sessions by unique token digest without expiry", () => {
    const config = getTableConfig(ownerSessions);

    expect(config.name).toBe("owner_sessions");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "owner_id",
      "token_digest",
      "created_at",
      "revoked_at",
    ]);
    expect(config.indexes.some((index) => index.config.unique)).toBe(true);
    expect(config.checks.map((constraint) => constraint.name)).toContain(
      "owner_sessions_token_digest_check"
    );
  });

  it("has a matching unapplied SQL migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "src/db/migrations/0004_owner_auth.sql"),
      "utf8"
    );

    for (const column of [
      "owner_auth",
      "owner_sessions",
      "username varchar(80)",
      "password_hash text",
      "token_digest varchar(64)",
      "revoked_at timestamptz",
      "CHECK (id = 1)",
      "UNIQUE INDEX uq_owner_sessions_token_digest",
    ]) {
      expect(migration.toLowerCase()).toContain(column.toLowerCase());
    }
    expect(migration.toLowerCase()).not.toContain("expires_at");
  });
});
