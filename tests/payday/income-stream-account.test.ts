import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ids = {
  settings: "00000000-0000-4000-8000-000000000001",
  stream: "00000000-0000-4000-8000-000000000002",
  liquid: "00000000-0000-4000-8000-000000000003",
  invalid: "00000000-0000-4000-8000-000000000004",
};
const store = vi.hoisted(() => ({ settings: [] as Record<string, any>[], streams: [] as Record<string, any>[], accounts: [] as Record<string, any>[], writes: [] as string[] }));
const authMocks = vi.hoisted(() => ({ requireOwner: vi.fn().mockResolvedValue({ id: 1 }), assertSameOrigin: vi.fn().mockReturnValue(null) }));

vi.mock("drizzle-orm", async importOriginal => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const key = (name: string) => name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  const eq = (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[key(column.name)] === value;
  return { ...actual, eq, and: (...conditions: ((row: Record<string, unknown>) => boolean)[]) => (row: Record<string, unknown>) => conditions.every(condition => condition(row)),
    inArray: (column: { name: string }, values: unknown[]) => (row: Record<string, unknown>) => values.includes(row[key(column.name)]) };
});
vi.mock("../../src/db", async () => {
  const schema = await import("../../src/db/schema");
  const rows = (table: unknown) => table === schema.projectionSettings ? store.settings : table === schema.incomeStreams ? store.streams : store.accounts;
  const tx = {
    execute: async () => undefined,
    select: () => ({ from: (table: unknown) => {
      let filter = (_row: Record<string, unknown>) => true;
      const query: any = { where: (condition: typeof filter) => { filter = condition; return query; }, orderBy: () => query,
        limit: async (count: number) => rows(table).filter(filter).slice(0, count),
        then: (resolve: (result: Record<string, unknown>[]) => unknown) => Promise.resolve(rows(table).filter(filter)).then(resolve) };
      return query;
    } }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => ({ returning: async () => {
      store.writes.push("insert"); const schemaTable = table === schema.projectionSettings ? store.settings : store.streams;
      const row = { id: table === schema.projectionSettings ? ids.settings : ids.stream, salaryCycleDays: "15,30", dailyDiscretionaryBurn: 0,
        scheduleKind: null, paydayAnchor: null, intervalDays: null, isEnabled: true, ...values };
      schemaTable.push(row); return [row];
    } }) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (filter: (row: Record<string, unknown>) => boolean) => ({ returning: async () => {
      store.writes.push("update"); const selected = rows(table).filter(filter); selected.forEach(row => Object.assign(row, values)); return selected;
    } }) }) }),
  };
  return { db: { ...tx, transaction: async (callback: (db: typeof tx) => unknown) => callback(tx) } };
});
vi.mock("../../src/lib/auth/guard", () => authMocks);

import { GET, POST } from "../../src/app/api/runway/income-streams/route";
import { PATCH } from "../../src/app/api/runway/income-streams/[id]/route";

const activeAccount = { id: ids.liquid, name: "Salary account", type: "liquid", currency: "PHP", isActive: true };
const legacyStream = { id: ids.stream, projectionSettingsId: ids.settings, destinationAccountId: null, destinationAccountSetDate: null, name: "Legacy job", netPayCents: 500000,
  scheduleKind: null, paydayAnchor: null, intervalDays: null, salaryCycleDays: "15,30", isEnabled: true };
const bodyBase = { name: "New job", destination_account_id: ids.liquid, net_pay_cents: 500000, next_pay_date: "2026-10-15", schedule_kind: "biweekly" };
const request = (url: string, method: string, body?: unknown) => new NextRequest(url, { method, headers: { "Content-Type": "application/json", Origin: "http://localhost" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const patch = (body: unknown) => PATCH(request(`http://localhost/api/runway/income-streams/${ids.stream}`, "PATCH", body), { params: Promise.resolve({ id: ids.stream }) });

beforeEach(() => {
  store.settings = [{ id: ids.settings, expectedSalaryAmount: 500000 }]; store.streams = [{ ...legacyStream }];
  store.accounts = [{ ...activeAccount }]; store.writes = [];
});

describe("income stream account links", () => {
  it("requires a destination account on create and writes nothing when it is missing", async () => {
    const { destination_account_id: _omitted, ...invalid } = bodyBase;
    const response = await POST(request("http://localhost/api/runway/income-streams", "POST", invalid));
    expect(response.status).toBe(400);
    expect(store.writes).toEqual([]);
  });

  it.each([
    { ...activeAccount, id: ids.invalid, isActive: false },
    { ...activeAccount, id: ids.invalid, type: "revolving_credit" },
  ])("rejects inactive or non-liquid account before creating any records", async account => {
    store.accounts = [account]; store.settings = []; store.streams = [];
    const response = await POST(request("http://localhost/api/runway/income-streams", "POST", { ...bodyBase, destination_account_id: ids.invalid }));
    expect(response.status).toBe(400);
    expect(store.settings).toHaveLength(0);
    expect(store.streams).toHaveLength(0);
    expect(store.writes).toEqual([]);
  });

  it("creates a linked stream using the canonical destination account field", async () => {
    const response = await POST(request("http://localhost/api/runway/income-streams", "POST", bodyBase));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ destination_account_id: ids.liquid });
    expect(store.streams.find(stream => stream.name === "New job")?.destinationAccountId).toBe(ids.liquid);
  });

  it("rejects invalid account changes without updating a legacy stream", async () => {
    store.accounts = [{ ...activeAccount, id: ids.invalid, type: "installment_loan" }];
    const response = await patch({ destination_account_id: ids.invalid });
    expect(response.status).toBe(400);
    expect(store.streams[0].destinationAccountId).toBeNull();
    expect(store.writes).toEqual([]);
  });

  it("keeps legacy unlinked streams editable and visible", async () => {
    const response = await patch({ name: "Renamed legacy income" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Renamed legacy income", destination_account_id: null });
    const listing = await GET(request("http://localhost/api/runway/income-streams", "GET"));
    expect(await listing.json()).toMatchObject({ streams: [{ destination_account_id: null }] });
  });
});
