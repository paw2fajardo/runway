import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  incomeStreams,
  paycheckOccurrences,
  paycheckOccurrenceKindEnum,
  paycheckOccurrenceStatusEnum,
} from "../../src/db/schema";

describe("payday persistence schema", () => {
  it("keeps existing income streams valid without an account link", () => {
    const config = getTableConfig(incomeStreams);
    const accountId = config.columns.find((column) => column.name === "account_id");

    expect(accountId).toBeDefined();
    expect(accountId?.notNull).toBe(false);
    expect(
      config.foreignKeys.some(
        (foreignKey) => foreignKey.onDelete === "set null"
      )
    ).toBe(true);
  });

  it("defines durable scheduled and retry records with partial idempotency keys", () => {
    const config = getTableConfig(paycheckOccurrences);

    expect(config.name).toBe("paycheck_occurrences");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "income_stream_id",
      "kind",
      "due_date",
      "retry_date",
      "account_id",
      "account_name_snapshot",
      "amount_snapshot",
      "transaction_id",
      "status",
      "parent_occurrence_id",
      "reversal_transaction_id",
      "created_at",
      "posted_at",
      "confirmed_at",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "uq_paycheck_scheduled_stream_date",
        "uq_paycheck_retry_parent_date",
        "idx_paycheck_occurrences_due_status",
        "idx_paycheck_occurrences_stream_date",
        "idx_paycheck_occurrences_parent",
        "idx_paycheck_occurrences_transaction",
        "idx_paycheck_occurrences_reversal",
      ])
    );
    expect(paycheckOccurrenceKindEnum.enumValues).toEqual(["scheduled", "retry"]);
    expect(paycheckOccurrenceStatusEnum.enumValues).toEqual([
      "pending_confirmation",
      "confirmed",
      "reversed_awaiting_retry",
    ]);
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "paycheck_occurrences_amount_check",
        "paycheck_occurrences_kind_fields_check",
      ])
    );
    const kindFieldsCheck = config.checks.find(
      (check) => check.name === "paycheck_occurrences_kind_fields_check"
    );
    expect(kindFieldsCheck?.value.queryChunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: [" IS NOT NULL AND "] })])
    );
  });

  it("preserves occurrence rows when referenced financial records are removed", () => {
    const config = getTableConfig(paycheckOccurrences);
    const deleteActions = config.foreignKeys.map(
      (foreignKey) => foreignKey.onDelete
    );

    expect(deleteActions).toContain("set null");
    expect(deleteActions).toContain("restrict");
    expect(deleteActions).not.toContain("cascade");
  });

  it("has a forward-only SQL migration matching the Drizzle schema", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "src/db/migrations/0005_income_stream_payouts.sql"),
      "utf8"
    ).toLowerCase();

    for (const fragment of [
      "create type paycheck_occurrence_kind as enum ('scheduled', 'retry')",
      "create type paycheck_occurrence_status",
      "add column account_id uuid references accounts(id) on delete set null",
      "create table paycheck_occurrences",
      "income_stream_id uuid not null references income_streams(id) on delete restrict",
      "account_id uuid references accounts(id) on delete set null",
      "transaction_id uuid references transactions(id) on delete set null",
      "parent_occurrence_id uuid references paycheck_occurrences(id) on delete restrict",
      "reversal_transaction_id uuid references transactions(id) on delete set null",
      "where kind = 'scheduled'",
      "where kind = 'retry'",
      "retry_date = due_date",
      "retry_date is not null and retry_date = due_date",
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).not.toMatch(/update\s+income_streams\s+set\s+account_id/i);
    expect(migration).not.toContain("on delete cascade");
  });
});
