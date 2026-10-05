import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { accounts, incomeStreams, projectionSettings } from "../src/db/schema";

const store = vi.hoisted(() => ({ settings: [] as Record<string, unknown>[], streams: [] as Record<string, unknown>[], accounts: [] as Record<string, unknown>[], writes: [] as unknown[], locked: false }));
const authMocks = vi.hoisted(() => ({
  requireOwner: vi.fn().mockResolvedValue({ id: 1, username: "owner", passwordHash: "hash" }),
  assertSameOrigin: vi.fn().mockReturnValue(null),
}));
vi.mock("drizzle-orm", async importOriginal => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const key = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return { ...actual,
    eq: (column: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[key(column.name)] === value,
    inArray: (column: { name: string }, values: unknown[]) => (row: Record<string, unknown>) => values.includes(row[key(column.name)]),
    and: (...conditions: ((row: Record<string, unknown>) => boolean)[]) => (row: Record<string, unknown>) => conditions.every(condition => condition(row)),
  };
});
vi.mock("../src/db", async () => {
  const schema = await import("../src/db/schema");
  const rows = (table: unknown) => table === schema.projectionSettings ? store.settings : table === schema.accounts ? store.accounts : store.streams;
  const tx = {
    execute: async () => { store.locked = true; },
    select: () => ({ from: (table: unknown) => {
      let condition = (_row: Record<string, unknown>) => true;
      const query = { where: (filter: typeof condition) => { condition = filter; return query; }, orderBy: () => query,
        limit: async (count: number) => rows(table).filter(condition).slice(0, count),
        then: (resolve: (value: Record<string, unknown>[]) => unknown) => Promise.resolve(rows(table).filter(condition)).then(resolve) };
      return query;
    } }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => ({ returning: async () => {
      store.writes.push(table);
      const row = { id: table === schema.projectionSettings ? primaryId : secondId, salaryCycleDays: "15,30", dailyDiscretionaryBurn: 0,
        scheduleKind: null, paydayAnchor: null, intervalDays: null, isEnabled: true, ...values };
      rows(table).push(row); return [row];
    } }) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (condition: (row: Record<string, unknown>) => boolean) => ({ returning: async () => {
      store.writes.push(table);
      const selected = rows(table).filter(condition); for (const row of selected) Object.assign(row, values); return selected;
    } }) }) }),
  };
  return { db: { ...tx, transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } };
});
vi.mock("../src/lib/auth/guard", () => authMocks);

import { GET, POST } from "../src/app/api/runway/income-streams/route";
import { PATCH } from "../src/app/api/runway/income-streams/[id]/route";
import { GET as settingsGET, PUT } from "../src/app/api/runway/settings/route";

const primaryId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const foreignId = "00000000-0000-4000-8000-000000000003";
const accountId = "00000000-0000-4000-8000-000000000004";
const request = (body: unknown, method = "POST") => new NextRequest("http://localhost/api/runway/income-streams", {
  method,
  headers: { "Content-Type": "application/json" },
  ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
const patch = (body: unknown, id = primaryId) => PATCH(request(body, "PATCH"), { params: Promise.resolve({ id }) });
const valid = { name: "Freelance", account_id: accountId, net_pay_cents: 123456, next_pay_date: "2028-01-31", schedule_kind: "monthly" };

beforeEach(() => {
  store.settings = [{ id: primaryId, expectedSalaryAmount: 999999, salaryCycleDays: "15,30", dailyDiscretionaryBurn: 85000 }];
  store.accounts = [{ id: accountId, name: "Main account", type: "liquid", currency: "PHP", isActive: true }];
  store.streams = [{ id: primaryId, projectionSettingsId: primaryId, accountId, name: "Primary income", netPayCents: 10000,
    scheduleKind: null, paydayAnchor: null, intervalDays: null, salaryCycleDays: "15,30", isEnabled: true }];
  store.writes = []; store.locked = false;
});

describe("Income stream API", () => {
  it("lists paused streams and preserves legacy calendar schedules", async () => {
    store.streams[0].isEnabled = false;
    expect(await (await GET(request(undefined, "GET"))).json()).toMatchObject({ streams: [{ id: primaryId, is_enabled: false, schedule_kind: "calendar" }] });
    expect(store.writes).toEqual([]);
  });
  it("returns an empty list without a settings profile", async () => {
    store.settings = [];
    expect(await (await GET(request(undefined, "GET"))).json()).toEqual({ streams: [] });
  });
  it.each(["weekly", "biweekly", "monthly", "custom"])("creates and reads %s streams", async kind => {
    const response = await POST(request({ ...valid, schedule_kind: kind, ...(kind === "custom" ? { interval_days: 10 } : {}) }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "Freelance", account_id: accountId,
      account_summary: { id: accountId, name: "Main account", type: "liquid", currency: "PHP" },
      schedule_kind: kind, interval_days: kind === "custom" ? 10 : null });
    expect((await (await GET(request(undefined, "GET"))).json()).streams).toHaveLength(2);
    expect(store.locked).toBe(true);
    expect(store.writes).toEqual([incomeStreams]);
    expect(store.settings[0].dailyDiscretionaryBurn).toBe(85000);
  });
  it("initializes global settings only on first creation", async () => {
    store.settings = []; store.streams = [];
    expect((await POST(request(valid))).status).toBe(201);
    expect(store.settings).toHaveLength(1);
    expect(store.writes).toEqual([projectionSettings, incomeStreams]);
  });
  it("requires an active liquid account before creating a stream", async () => {
    const { account_id: _accountId, ...withoutAccount } = valid;
    expect((await POST(request(withoutAccount))).status).toBe(400);
    expect(store.writes).toEqual([]);
    store.accounts[0].isActive = false;
    expect((await POST(request(valid))).status).toBe(400);
    expect(store.writes).toEqual([]);
  });
  it.each([{ ...valid, name: "  " }, { ...valid, name: "x".repeat(101) }, { ...valid, net_pay_cents: 0 },
    { ...valid, net_pay_cents: 1.5 }, { ...valid, net_pay_cents: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, next_pay_date: "2027-02-29" }, { ...valid, schedule_kind: "other" },
    { ...valid, schedule_kind: "custom" }, { ...valid, schedule_kind: "custom", interval_days: 367 },
    { ...valid, interval_days: 30 }])("rejects invalid creation before writes", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(store.writes).toEqual([]);
  });
  it("rejects malformed JSON and malformed paths", async () => {
    expect((await POST(new NextRequest("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await patch({ name: "Changed" }, "bad-id")).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect(store.writes).toEqual([]);
  });
  it("rejects missing and out-of-profile streams", async () => {
    expect((await patch({ name: "Changed" }, secondId)).status).toBe(404);
    store.streams.push({ ...store.streams[0], id: secondId, projectionSettingsId: foreignId });
    expect((await patch({ name: "Changed" }, secondId)).status).toBe(404);
    expect(store.writes).toEqual([]);
  });
  it("edits legacy name/amount without converting its schedule", async () => {
    expect((await patch({ name: "Main job", net_pay_cents: 23456 })).status).toBe(200);
    expect(store.streams[0]).toMatchObject({ name: "Main job", netPayCents: 23456, scheduleKind: null, paydayAnchor: null });
    expect(store.settings[0].expectedSalaryAmount).toBe(999999);
  });
  it("pauses and resumes reversibly without changing amount or anchor", async () => {
    expect((await patch({ is_enabled: false })).status).toBe(200);
    expect(store.streams[0].isEnabled).toBe(false);
    expect((await patch({ is_enabled: true })).status).toBe(200);
    expect(store.streams[0]).toMatchObject({ isEnabled: true, netPayCents: 10000, paydayAnchor: null });
  });
  it("retains monthly original anchor during amount edits", async () => {
    Object.assign(store.streams[0], { scheduleKind: "monthly", paydayAnchor: "2027-01-31" });
    expect((await patch({ net_pay_cents: 30000 })).status).toBe(200);
    expect(store.streams[0].paydayAnchor).toBe("2027-01-31");
  });
  it("validates merged custom intervals and schedule changes", async () => {
    expect((await patch({ schedule_kind: "custom", next_pay_date: "2027-01-01" })).status).toBe(400);
    expect((await patch({ interval_days: 3 })).status).toBe(400);
    expect((await patch({ schedule_kind: "custom", next_pay_date: "2027-01-01", interval_days: 3 })).status).toBe(200);
    expect((await patch({ name: "Short cycle" })).status).toBe(200);
    expect(store.streams[0].intervalDays).toBe(3);
    expect((await patch({ schedule_kind: "weekly" })).status).toBe(200);
    expect(store.streams[0].intervalDays).toBeNull();
  });
});

describe("Primary pay compatibility adapter", () => {
  it("reads the migrated stream rather than obsolete settings amounts", async () => {
    expect(await (await settingsGET(request(undefined, "GET"))).json()).toMatchObject({ configured: true, net_pay_cents: 10000, schedule_kind: "calendar" });
  });
  it("does not resurrect an absent primary stream from old salary fields", async () => {
    store.streams = [];
    expect(await (await settingsGET(request(undefined, "GET"))).json()).toEqual({ configured: false });
  });
  it("preserves a paused primary while an old request defaults to biweekly", async () => {
    store.streams[0].isEnabled = false;
    const response = await PUT(request({ net_pay_cents: 34567, next_pay_date: "2027-01-31" }, "PUT"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ net_pay_cents: 34567, schedule_kind: "biweekly", is_enabled: false });
    expect(store.streams).toHaveLength(1);
    expect(store.settings[0]).toMatchObject({ expectedSalaryAmount: 999999, dailyDiscretionaryBurn: 85000 });
    expect(store.writes).toEqual([incomeStreams]);
  });
  it("creates a deterministic primary for old first-time clients", async () => {
    store.settings = []; store.streams = [];
    expect((await PUT(request({ net_pay_cents: 123456, next_pay_date: "2027-01-31" }, "PUT"))).status).toBe(200);
    expect(store.streams[0]).toMatchObject({ id: primaryId, projectionSettingsId: primaryId });
    expect(store.writes).toEqual([projectionSettings, incomeStreams]);
  });
});
