import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { accounts, incomeStreams, projectionSettings } from "../src/db/schema";
import { MAX_DAILY_DISCRETIONARY_BURN_CENTS } from "../src/lib/types";

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
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (condition: (row: Record<string, unknown>) => boolean) => {
      store.writes.push(table);
      const selected = rows(table).filter(condition); for (const row of selected) Object.assign(row, values);
      return { returning: async () => selected };
    } }) }),
  };
  return { db: { ...tx, transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } };
});
vi.mock("../src/lib/auth/guard", () => authMocks);

import { GET, POST } from "../src/app/api/runway/income-streams/route";
import { PATCH } from "../src/app/api/runway/income-streams/[id]/route";
import { GET as settingsGET, PATCH as settingsPATCH, PUT } from "../src/app/api/runway/settings/route";

const primaryId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const foreignId = "00000000-0000-4000-8000-000000000003";
const accountId = "00000000-0000-4000-8000-000000000004";
const request = (body: unknown, method = "POST", path = "/api/runway/income-streams") => new NextRequest(`http://localhost${path}`, {
  method, headers: { "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
const patch = (body: unknown, id = primaryId) => PATCH(request(body, "PATCH"), { params: Promise.resolve({ id }) });
const settingsPatch = (body: unknown) => settingsPATCH(request(body, "PATCH", "/api/runway/settings"));
const valid = { name: "Freelance", destination_account_id: accountId, net_pay_cents: 123456, next_pay_date: "2028-01-31", schedule_kind: "monthly" };

beforeEach(() => {
  store.settings = [{ id: primaryId, expectedSalaryAmount: 999999, salaryCycleDays: "15,30", dailyDiscretionaryBurn: 85000 }];
  store.accounts = [
    { id: accountId, name: "Main account", type: "liquid", currency: "PHP", isActive: true },
    { id: secondId, name: "BPI", type: "liquid", currency: "PHP", isActive: true },
  ];
  store.streams = [{ id: primaryId, projectionSettingsId: primaryId, destinationAccountId: accountId, destinationAccountSetDate: "2026-10-02", name: "Primary income", netPayCents: 10000,
    scheduleKind: null, paydayAnchor: null, intervalDays: null, salaryCycleDays: "15,30", isEnabled: true }];
  store.writes = []; store.locked = false;
});
afterEach(() => vi.useRealTimers());

describe("Income stream API", () => {
  it("lists paused streams and preserves legacy calendar schedules", async () => {
    store.streams[0].isEnabled = false;
    expect(await (await GET(request(undefined, "GET"))).json()).toMatchObject({ streams: [{ id: primaryId, is_enabled: false, schedule_kind: "calendar", destination_account_id: accountId }] });
    expect(store.writes).toEqual([]);
  });
  it("returns an empty list without a settings profile", async () => {
    store.settings = [];
    expect(await (await GET(request(undefined, "GET"))).json()).toEqual({ streams: [] });
  });
  it.each(["weekly", "biweekly", "monthly", "custom"])("creates and reads %s streams", async kind => {
    const response = await POST(request({ ...valid, schedule_kind: kind, ...(kind === "custom" ? { interval_days: 10 } : {}) }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "Freelance", destination_account_id: accountId,
      schedule_kind: kind, interval_days: kind === "custom" ? 10 : null });
    expect(store.streams[1]).toMatchObject({ destinationAccountId: accountId });
    expect(store.streams[1].destinationAccountSetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await (await GET(request(undefined, "GET"))).json()).streams).toHaveLength(2);
    expect(store.locked).toBe(true);
    expect(store.writes).toEqual([incomeStreams]);
    expect(store.settings[0].dailyDiscretionaryBurn).toBe(85000);
  });
  it("requires an active liquid destination account before creating a stream", async () => {
    const { destination_account_id: _omitted, ...withoutAccount } = valid;
    expect((await POST(request(withoutAccount))).status).toBe(400);
    expect(store.writes).toEqual([]);
    store.accounts[0].isActive = false;
    expect((await POST(request(valid))).status).toBe(400);
    expect(store.writes).toEqual([]);
  });
  it("initializes global settings only on first creation", async () => {
    store.settings = []; store.streams = [];
    expect((await POST(request(valid))).status).toBe(201);
    expect(store.settings).toHaveLength(1);
    expect(store.writes).toEqual([projectionSettings, incomeStreams]);
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
  it("resets destination eligibility when resuming a stream", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2027, 0, 5, 12));
    expect((await patch({ is_enabled: false })).status).toBe(200);
    expect(store.streams[0].isEnabled).toBe(false);
    expect(store.streams[0].destinationAccountSetDate).toBe("2026-10-02");
    expect((await patch({ is_enabled: true })).status).toBe(200);
    expect(store.streams[0]).toMatchObject({ isEnabled: true, netPayCents: 10000, paydayAnchor: null, destinationAccountSetDate: "2027-01-05" });
  });
  it("updates or clears the destination account", async () => {
    expect((await patch({ destination_account_id: secondId })).status).toBe(200);
    expect(store.streams[0].destinationAccountId).toBe(secondId);
    const assignmentDate = store.streams[0].destinationAccountSetDate;
    expect((await patch({ name: "Renamed salary" })).status).toBe(200);
    expect(store.streams[0].destinationAccountSetDate).toBe(assignmentDate);
    expect((await patch({ destination_account_id: null })).status).toBe(200);
    expect(store.streams[0].destinationAccountId).toBeNull();
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
    expect(await (await settingsGET(request(undefined, "GET", "/api/runway/settings"))).json()).toMatchObject({ configured: true, net_pay_cents: 10000, schedule_kind: "calendar", daily_discretionary_burn_cents: 85000 });
  });
  it("does not resurrect an absent primary stream from old salary fields", async () => {
    store.streams = [];
    expect(await (await settingsGET(request(undefined, "GET", "/api/runway/settings"))).json()).toEqual({ configured: false, daily_discretionary_burn_cents: 85000, bill_reminder_time: "09:00" });
  });
  it("supports the settings page daily allowance field query", async () => {
    expect(await (await settingsGET(request(undefined, "GET", "/api/runway/settings?field=daily_discretionary_burn_cents"))).json()).toEqual({ daily_discretionary_burn_cents: 85000 });
  });
  it("loads and saves the bill reminder time without changing pay settings", async () => {
    expect(await (await settingsGET(request(undefined, "GET", "/api/runway/settings?field=bill_reminder_time"))).json()).toEqual({ bill_reminder_time: "09:00" });
    const response = await settingsPatch({ bill_reminder_time: "18:45" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bill_reminder_time: "18:45" });
    expect(store.settings[0].billReminderTime).toBe("18:45");
    expect(store.streams[0].netPayCents).toBe(10000);
  });
  it.each(["24:00", "9:00", "12:60", "noon"])("rejects invalid bill reminder time %s before writes", async time => {
    const response = await settingsPatch({ bill_reminder_time: time });
    expect(response.status).toBe(400);
    expect(store.writes).toEqual([]);
  });
  it("updates planned spending without changing pay settings", async () => {
    const response = await settingsPatch({ daily_discretionary_burn_cents: 12345 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ daily_discretionary_burn_cents: 12345 });
    expect(store.settings[0].dailyDiscretionaryBurn).toBe(12345);
    expect(store.streams[0].netPayCents).toBe(10000);
    expect(store.writes).toEqual([projectionSettings]);
  });
  it("accepts the safe maximum planned spending value", async () => {
    const response = await settingsPatch({ daily_discretionary_burn_cents: MAX_DAILY_DISCRETIONARY_BURN_CENTS });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ daily_discretionary_burn_cents: MAX_DAILY_DISCRETIONARY_BURN_CENTS });
  });
  it.each([-1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1, {}, null])("rejects invalid planned spending %j before writes", async value => {
    const response = await settingsPatch({ daily_discretionary_burn_cents: value });
    expect(response.status).toBe(400);
    expect(store.writes).toEqual([]);
  });
  it("creates the settings profile when first saving planned spending", async () => {
    store.settings = []; store.streams = [];
    const response = await settingsPatch({ daily_discretionary_burn_cents: 0 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ daily_discretionary_burn_cents: 0 });
    expect(store.settings[0].dailyDiscretionaryBurn).toBe(0);
    expect(store.writes).toEqual([projectionSettings, projectionSettings]);
  });
  it("preserves a paused primary while an old request defaults to biweekly", async () => {
    store.streams[0].isEnabled = false;
    const response = await PUT(request({ net_pay_cents: 34567, next_pay_date: "2027-01-31" }, "PUT", "/api/runway/settings"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ net_pay_cents: 34567, schedule_kind: "biweekly", is_enabled: false });
    expect(store.streams).toHaveLength(1);
    expect(store.settings[0]).toMatchObject({ expectedSalaryAmount: 999999, dailyDiscretionaryBurn: 85000 });
    expect(store.writes).toEqual([incomeStreams]);
  });
  it("creates a deterministic primary for old first-time clients", async () => {
    store.settings = []; store.streams = [];
    expect((await PUT(request({ net_pay_cents: 123456, next_pay_date: "2027-01-31" }, "PUT", "/api/runway/settings"))).status).toBe(200);
    expect(store.streams[0]).toMatchObject({ id: primaryId, projectionSettingsId: primaryId });
    expect(store.writes).toEqual([projectionSettings, incomeStreams]);
  });
});
