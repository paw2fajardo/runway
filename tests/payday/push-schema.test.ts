import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  paycheckPushDeliveries,
  paycheckPushDeliveryStatusEnum,
  pushSubscriptions,
} from "../../src/db/schema";

describe("payday push persistence schema", () => {
  it("associates endpoint and encryption material with the owner", () => {
    const config = getTableConfig(pushSubscriptions);

    expect(config.name).toBe("push_subscriptions");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "owner_id",
      "endpoint",
      "endpoint_hash",
      "p256dh",
      "auth",
      "created_at",
      "updated_at",
    ]);
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0].onDelete).toBe("cascade");
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "uq_push_subscriptions_endpoint_hash"
    );
    expect(config.checks.map((check) => check.name)).toContain(
      "push_subscriptions_endpoint_hash_check"
    );
  });

  it("tracks retry state once per occurrence and endpoint while preserving history on endpoint deletion", () => {
    const config = getTableConfig(paycheckPushDeliveries);

    expect(config.name).toBe("paycheck_push_deliveries");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "occurrence_id",
      "subscription_id",
      "endpoint_hash_snapshot",
      "status",
      "attempt_count",
      "next_attempt_at",
      "last_attempt_at",
      "delivered_at",
      "last_error",
      "created_at",
      "updated_at",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "uq_paycheck_push_occurrence_endpoint"
    );
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "idx_paycheck_push_deliveries_retry"
    );
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual(
      ["restrict", "set null"]
    );
    expect(paycheckPushDeliveryStatusEnum.enumValues).toEqual([
      "pending",
      "retryable",
      "sent",
      "expired",
    ]);
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "paycheck_push_deliveries_endpoint_hash_check",
        "paycheck_push_deliveries_attempt_count_check",
      ])
    );
  });

  it("has a forward-only SQL migration matching the Drizzle schema", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "src/db/migrations/0006_payday_push.sql"),
      "utf8"
    ).toLowerCase();

    for (const fragment of [
      "create type paycheck_push_delivery_status",
      "create table push_subscriptions",
      "owner_id integer not null references owner_auth(id) on delete cascade",
      "endpoint text not null",
      "endpoint_hash varchar(64) not null",
      "p256dh text not null",
      "auth text not null",
      "create table paycheck_push_deliveries",
      "occurrence_id uuid not null references paycheck_occurrences(id) on delete restrict",
      "subscription_id uuid references push_subscriptions(id) on delete set null",
      "endpoint_hash_snapshot varchar(64) not null",
      "attempt_count integer not null default 0",
      "unique index uq_paycheck_push_occurrence_endpoint",
      "on paycheck_push_deliveries (occurrence_id, endpoint_hash_snapshot)",
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).not.toContain("drop table");
    expect(migration).not.toContain("delete from");
  });
});
