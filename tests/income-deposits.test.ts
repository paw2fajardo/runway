import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  settings: [] as Record<string, unknown>[],
  streams: [] as Record<string, unknown>[],
  accounts: [] as Record<string, unknown>[],
  deposits: [] as Record<string, unknown>[],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const key = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const eq = (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[key(column.name)] === value;
  const and = (...conditions: ((row: Record<string, unknown>) => boolean)[]) => (row: Record<string, unknown>) => conditions.every(condition => condition(row));
  const sql = (strings: TemplateStringsArray, ...params: unknown[]) => Object.assign((row: Record<string, unknown>) => {
    if (strings[0].includes("<=") && typeof params[1] === "number") return Number(row.currentBalance) <= params[1];
    return true;
  }, { strings, params });
  return { ...actual, eq, and, sql };
});

vi.mock("../src/db", async () => {
  const schema = await import("../src/db/schema");
  const rows = (table: unknown) => table === schema.projectionSettings ? store.settings
    : table === schema.incomeStreams ? store.streams
    : table === schema.incomeStreamDeposits ? store.deposits : store.accounts;
  const tx: any = {
    execute: async () => undefined,
    select: () => ({ from: (table: unknown) => {
      let condition = (_row: Record<string, unknown>) => true;
      const query = {
        where: (filter: typeof condition) => { condition = filter; return query; },
        orderBy: () => query,
        limit: async (count: number) => rows(table).filter(condition).slice(0, count),
        then: (resolve: (value: Record<string, unknown>[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows(table).filter(condition)).then(resolve, reject),
      };
      return query;
    } }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (condition: (row: Record<string, unknown>) => boolean) => ({
      returning: async () => {
        const selected = rows(table).filter(condition);
        for (const row of selected) {
          const balanceExpression = values.currentBalance as { params?: unknown[] } | undefined;
          if (typeof balanceExpression?.params?.[1] === "number") row.currentBalance = Number(row.currentBalance) + Number(balanceExpression.params[1]);
          else Object.assign(row, values);
          if (values.updatedAt) row.updatedAt = values.updatedAt;
        }
        return selected;
      },
    }) }) }),
  };
  tx.insert = (table: unknown) => {
    let values: Record<string, unknown> = {};
    const builder = {
      values: (insertValues: Record<string, unknown>) => { values = insertValues; return builder; },
      onConflictDoNothing: () => builder,
      returning: async () => {
        if (table === schema.incomeStreamDeposits && store.deposits.some(row => row.incomeStreamId === values.incomeStreamId && row.scheduledDate === values.scheduledDate)) return [];
        const row = { id: `deposit-${store.deposits.length + 1}`, ...values };
        rows(table).push(row);
        return [row];
      },
    };
    return builder;
  };
  return { db: { transaction: async (callback: (transaction: any) => unknown) => callback(tx) } };
});

import { applyDueIncomeStreamDeposits } from "../src/lib/income-stream-deposits";

const settingsId = "00000000-0000-4000-8000-000000000001";
const streamId = "00000000-0000-4000-8000-000000000002";
const accountId = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  store.settings = [{ id: settingsId }];
  store.streams = [{ id: streamId, projectionSettingsId: settingsId, destinationAccountId: accountId,
    destinationAccountSetDate: "2026-10-02", name: "Salary", netPayCents: 500000, scheduleKind: "weekly", paydayAnchor: "2026-10-02",
    intervalDays: null, salaryCycleDays: "15,30", isEnabled: true }];
  store.accounts = [{ id: accountId, type: "liquid", isActive: true, currentBalance: 1000000 }];
  store.deposits = [];
});

describe("Scheduled income deposits", () => {
  it("credits the destination account once on its payday", async () => {
    expect(await applyDueIncomeStreamDeposits(new Date(2026, 9, 2))).toBe(1);
    expect(store.accounts[0].currentBalance).toBe(1500000);
    expect(store.deposits).toHaveLength(1);
    expect(await applyDueIncomeStreamDeposits(new Date(2026, 9, 2))).toBe(0);
    expect(store.accounts[0].currentBalance).toBe(1500000);
  });

  it("catches up all missed paydays after the server was offline without double-crediting", async () => {
    expect(await applyDueIncomeStreamDeposits(new Date(2026, 9, 18))).toBe(3);
    expect(store.accounts[0].currentBalance).toBe(2500000);
    expect(store.deposits.map(row => row.scheduledDate)).toEqual(["2026-10-02", "2026-10-09", "2026-10-16"]);
    expect(await applyDueIncomeStreamDeposits(new Date(2026, 9, 18))).toBe(0);
    expect(store.accounts[0].currentBalance).toBe(2500000);
  });

  it("never credits paydays before the destination was assigned or after a resume baseline", async () => {
    store.streams[0].destinationAccountSetDate = "2026-10-10";
    expect(await applyDueIncomeStreamDeposits(new Date(2026, 9, 18))).toBe(1);
    expect(store.accounts[0].currentBalance).toBe(1500000);
    expect(store.deposits.map(row => row.scheduledDate)).toEqual(["2026-10-16"]);
  });

  it("does not deposit when the destination is no longer an active liquid account", async () => {
    store.accounts[0].type = "revolving_credit";
    expect(await applyDueIncomeStreamDeposits(new Date(2026, 9, 2))).toBe(0);
    expect(store.accounts[0].currentBalance).toBe(1000000);
    expect(store.deposits).toHaveLength(0);
  });
});
