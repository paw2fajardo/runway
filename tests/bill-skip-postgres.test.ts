import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../src/db", () => ({ get db() { return state.database; } }));
import { skipBillInstance, postBillInstance, processDueAutoPayBills, linkExistingBillPaymentInTransaction } from "../src/lib/bills/posting";
import { POST } from "../src/app/api/bills/[id]/skip/route";
import { POST as settle } from "../src/app/api/bills/[id]/settle/route";
import { GET } from "../src/app/api/bills/route";
import { createOwnerSession } from "../src/lib/auth/session";
import { POST as reschedule } from "../src/app/api/bills/[id]/reschedule/route";
import { rescheduleBillInstance } from "../src/lib/bills/reschedule";
import { calculateRunwayForecast } from "../src/lib/runway";
import { billDueState } from "../src/lib/bills/due-date";
import { POST as adjust } from "../src/app/api/bills/[id]/adjust/route";
import { POST as createBill } from "../src/app/api/bills/route";
import { PATCH as editBill } from "../src/app/api/bills/[id]/route";
import { POST as createCategory } from "../src/app/api/categories/route";
import { GET as getForecast } from "../src/app/api/runway/forecast/route";

const url = process.env.RUNWAY_POSTGRES_TEST_URL;
describe.skipIf(!url)("PostgreSQL skipped bills", () => {
  const namespace = `bill_skip_${randomUUID().replaceAll("-", "")}`;
  let client: ReturnType<typeof postgres>;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let token: string;

  beforeAll(async () => {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname)) throw new Error("Only disposable local PostgreSQL is allowed.");
    client = postgres(url!, { max: 1 });
    await client.unsafe(`CREATE SCHEMA "${namespace}"`);
    await client.unsafe(`SET search_path TO "${namespace}"`);
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api") as typeof import("drizzle-kit/api");
    const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
    for (const statement of statements) {
      // Start with the old enum so the real migration must enable skipping.
      await client.unsafe(statement.replaceAll('"public".', `"${namespace}".`).replace(", 'skipped'", "").replace('"original_due_date" date,', ""));
    }
    await client.unsafe(readFileSync("src/db/migrations/0019_skipped_bill_occurrences.sql", "utf8"));
    await client.unsafe(readFileSync("src/db/migrations/0020_bill_occurrence_rescheduling.sql", "utf8"));
    database = drizzle(client, { schema });
    state.database = database;
    await database.insert(schema.ownerAuth).values({ username: "test-owner", passwordHash: "unused" });
    token = await createOwnerSession(1);
  }, 30000);
  afterAll(async () => {
    if (client) {
      await client.unsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await client.end();
    }
  });
  const fixture = async (overrides: Partial<typeof schema.bills.$inferInsert> = {}, status: typeof schema.billInstances.$inferInsert.status = "upcoming") => {
    const [bill] = await database.insert(schema.bills).values({ name: "Lazada Pay", type: "variable_utility", amount: 50000,
      isVariableAmount: true, dueDayOfMonth: 17, ...overrides }).returning();
    const [instance] = await database.insert(schema.billInstances).values({ billId: bill.id, periodIdentifier: "2026-10-17",
      dueDate: "2026-10-17", targetSettlementDate: "2026-10-17", amountDue: bill.amount, status }).returning();
    return { bill, instance };
  };
  const request = (id: string, authenticated = true, origin = "http://localhost") => new NextRequest(`http://localhost/api/bills/${id}/skip`, {
    method: "POST", headers: { Origin: origin, ...(authenticated ? { Cookie: `runway_owner_session=${token}` } : {}) },
  });
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("persists a zero-due skip, preserves money and history, and retries without duplicate recurrence", async () => {
    const { bill, instance } = await fixture();
    const [account] = await database.insert(schema.accounts).values({ name: "Cash", type: "liquid", currentBalance: 100000 }).returning();
    expect((await POST(request(instance.id), context(instance.id))).status).toBe(200);
    expect((await POST(request(instance.id), context(instance.id))).status).toBe(200);
    const history = await (await GET(new Request("http://localhost/api/bills", { headers: { Cookie: `runway_owner_session=${token}` } }))).json();
    expect(history.find((row: { instanceId: string }) => row.instanceId === instance.id)).toMatchObject({ status: "skipped", amountDue: 0 });
    const instances = await database.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id));
    expect(instances).toHaveLength(2);
    expect(instances.find(row => row.dueDate === "2026-11-17")).toMatchObject({ amountDue: 50000, status: "upcoming" });
    expect((await database.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)))[0].currentBalance).toBe(100000);
    expect(await database.select().from(schema.transactions)).toEqual([]);
    expect(await database.select().from(schema.transactionLegs)).toEqual([]);
    expect(await database.select().from(schema.billPaymentEvents)).toEqual([]);
    await expect(postBillInstance(instance.id, { amount: 100, paymentMethod: "cash" })).rejects.toThrow("already been recorded");
    await expect(database.transaction(tx => linkExistingBillPaymentInTransaction(tx, instance.id, randomUUID()))).rejects.toThrow("already recorded");
  });

  it.each([false, true])("records a weekly allowance in untracked cash (variable: %s)", async isVariableAmount => {
    const [account] = await database.insert(schema.accounts).values({ name: "Allowance bank", type: "liquid", currentBalance: 100000 }).returning();
    const { bill, instance } = await fixture({ name: "Allowance", frequency: "weekly", dueDayOfWeek: 6,
      sourceAccountId: account.id, isVariableAmount });
    const response = await settle(new NextRequest(`http://localhost/api/bills/${instance.id}/settle`, {
      method: "POST", headers: { Origin: "http://localhost", Cookie: `runway_owner_session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payment_method: "cash", ...(isVariableAmount && { amount: 45000 }) }),
    }), context(instance.id));
    expect(response.status).toBe(200);
    expect((await response.json()).instance).toMatchObject({ status: "paid", cashPaidAt: expect.any(String),
      amountDue: isVariableAmount ? 45000 : 50000, linkedTransactionId: null });
    expect((await database.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)))[0].currentBalance).toBe(100000);
    expect(await database.select().from(schema.transactions)).toEqual([]);
    expect(await database.select().from(schema.billPaymentEvents)).toEqual([]);
    const instances = await database.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id));
    expect(instances).toHaveLength(2);
    expect(instances.find(row => row.dueDate === "2026-10-24")).toMatchObject({ status: "upcoming", amountDue: 50000, cashPaidAt: null });
    expect((await database.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0].sourceAccountId).toBe(account.id);
  });

  it("keeps skipped auto-pay out of posting", async () => {
    const { instance } = await fixture({ isAutoPay: true, autoPostFrom: "2026-10-01" });
    await skipBillInstance(instance.id);
    expect(await processDueAutoPayBills(new Date("2026-10-17T12:00:00Z"))).toBe(0);
    expect(await database.select().from(schema.transactions)).toEqual([]);
  });

  it.each(["paid", "auto_debited"] as const)("rejects skipping %s history", async status => {
    const { instance } = await fixture({}, status);
    expect((await POST(request(instance.id), context(instance.id))).status).toBe(409);
  });

  it("respects recurrence limits and inactive bills", async () => {
    const { bill, instance } = await fixture({ occurrenceLimit: 1 });
    await skipBillInstance(instance.id);
    expect(await database.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id))).toHaveLength(1);
    const inactive = await fixture({ isActive: false });
    expect((await POST(request(inactive.instance.id), context(inactive.instance.id))).status).toBe(404);
  });

  it("rolls back the skip when creating the next occurrence fails", async () => {
    const { bill, instance } = await fixture();
    await client.unsafe(`ALTER TABLE bill_instances ADD CONSTRAINT reject_next CHECK (bill_id <> '${bill.id}' OR due_date <> '2026-11-17')`);
    try {
      await expect(skipBillInstance(instance.id)).rejects.toThrow();
      expect((await database.select().from(schema.billInstances).where(eq(schema.billInstances.id, instance.id)))[0]).toMatchObject({ status: "upcoming", amountDue: 50000 });
    } finally { await client`ALTER TABLE bill_instances DROP CONSTRAINT reject_next`; }
  });

  it("requires authentication, same origin, and a valid occurrence identifier", async () => {
    const { instance } = await fixture();
    expect((await POST(request(instance.id, false), context(instance.id))).status).toBe(401);
    expect((await POST(request(instance.id, true, "https://foreign.example"), context(instance.id))).status).toBe(403);
    expect((await POST(request("bad"), context("bad"))).status).toBe(400);
    const missing = randomUUID();
    expect((await POST(request(missing), context(missing))).status).toBe(404);
  });

  const moveRequest = (id: string, body: unknown, authenticated = true, origin = "http://localhost") => new NextRequest(`http://localhost/api/bills/${id}/reschedule`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authenticated ? { Cookie: `runway_owner_session=${token}` } : {}) }, body: JSON.stringify(body),
  });

  it("moves one unpaid occurrence repeatedly, updates its forecast, and preserves siblings and money", async () => {
    const { bill, instance } = await fixture();
    await database.update(schema.billInstances).set({ status: "past_due" }).where(eq(schema.billInstances.id, instance.id));
    const siblings = await database.insert(schema.billInstances).values([
      { billId: bill.id, periodIdentifier: "2026-09-17", dueDate: "2026-09-17", targetSettlementDate: "2026-09-17", amountDue: 40000, status: "paid" },
      { billId: bill.id, periodIdentifier: "2026-11-17", dueDate: "2026-11-17", targetSettlementDate: "2026-11-17", amountDue: 50000 },
    ]).returning();
    const accounts = await database.select().from(schema.accounts);
    for (const due_date of ["2026-10-20", "2026-10-25"]) {
      const response = await reschedule(moveRequest(instance.id, { due_date }), context(instance.id));
      expect(response.status).toBe(200);
      expect((await response.json()).instance).toMatchObject({ dueDate: due_date, originalDueDate: instance.dueDate,
        periodIdentifier: instance.periodIdentifier, status: "upcoming", amountDue: 50000 });
    }
    const rows = await (await GET(new Request("http://localhost/api/bills", { headers: { Cookie: `runway_owner_session=${token}` } }))).json();
    const moved = rows.find((row: { instanceId: string }) => row.instanceId === instance.id);
    expect(moved).toMatchObject({ dueDate: "2026-10-25", targetSettlementDate: "2026-10-25", status: "upcoming" });
    expect(billDueState(moved, "2026-10-20")).toBe("upcoming");
    const forecast = calculateRunwayForecast({ currentLiquidCash: 100000, expectedSalaryAmount: 100000,
      dailyDiscretionaryBurn: 0, salaryCycleDays: "21", referenceDate: new Date("2026-10-18T12:00:00"), horizonDays: 14,
      bills: [{ ...moved, id: moved.instanceId }] });
    expect(forecast.scheduled_bills_total).toBe(0);
    expect(forecast.timeline.find(day => day.date === "2026-10-25")?.outflow).toBe(50000);
    for (const sibling of siblings) expect((await database.select().from(schema.billInstances).where(eq(schema.billInstances.id, sibling.id)))[0]).toEqual(sibling);
    expect((await database.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0]).toEqual(bill);
    expect(await database.select().from(schema.accounts)).toEqual(accounts);
    expect(await database.select().from(schema.transactions)).toEqual([]);
  });

  it.each([
    ["monthly", "2026-11-17"], ["weekly", "2026-10-24"], ["biweekly", "2026-10-31"],
  ] as const)("preserves the %s anchor after moving across months and skipping", async (frequency, nextDate) => {
    const { bill, instance } = await fixture({ frequency });
    await rescheduleBillInstance(instance.id, "2027-01-25");
    await rescheduleBillInstance(instance.id, "2027-02-25");
    await skipBillInstance(instance.id);
    const rows = await database.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id));
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id !== instance.id)).toMatchObject({ dueDate: nextDate, amountDue: 50000, originalDueDate: null });
  });

  it.each(["2026-02-30", "0000-01-01", "2026-13-01", "20/10/2026", "", null])("rejects invalid date %s without changing the occurrence", async due_date => {
    const { instance } = await fixture();
    expect((await reschedule(moveRequest(instance.id, { due_date }), context(instance.id))).status).toBe(400);
    expect((await database.select().from(schema.billInstances).where(eq(schema.billInstances.id, instance.id)))[0]).toEqual(instance);
  });

  it.each(["paid", "auto_debited", "skipped"] as const)("rejects moving %s history", async status => {
    const { instance } = await fixture({}, status);
    expect((await reschedule(moveRequest(instance.id, { due_date: "2026-10-25" }), context(instance.id))).status).toBe(409);
  });

  it("guards rescheduling and accepts real dates without a postponement limit", async () => {
    const { instance } = await fixture();
    const body = { due_date: "2030-02-28" };
    expect((await reschedule(moveRequest(instance.id, body, false), context(instance.id))).status).toBe(401);
    expect((await reschedule(moveRequest(instance.id, body, true, "https://foreign.example"), context(instance.id))).status).toBe(403);
    expect((await reschedule(moveRequest("bad", body), context("bad"))).status).toBe(400);
    expect((await reschedule(moveRequest(instance.id, { ...body, amount: 1 }), context(instance.id))).status).toBe(400);
    const missing = randomUUID();
    expect((await reschedule(moveRequest(missing, body), context(missing))).status).toBe(404);
    const inactive = await fixture({ isActive: false });
    expect((await reschedule(moveRequest(inactive.instance.id, body), context(inactive.instance.id))).status).toBe(404);
    expect((await reschedule(moveRequest(instance.id, body), context(instance.id))).status).toBe(200);
    const moved = await rescheduleBillInstance(instance.id, body.due_date);
    expect(await rescheduleBillInstance(instance.id, body.due_date)).toEqual(moved);
  });

  it("expires reminders queued for the old date and rolls back if that update fails", async () => {
    const { instance } = await fixture();
    const [delivery] = await database.insert(schema.billPushDeliveries).values({ billInstanceId: instance.id,
      endpointHashSnapshot: "d".repeat(64), reminderDate: "2026-10-17", status: "retryable" }).returning();
    await client`ALTER TABLE bill_push_deliveries ADD CONSTRAINT reject_expired CHECK (status <> 'expired')`;
    try {
      await expect(rescheduleBillInstance(instance.id, "2026-10-25")).rejects.toThrow();
      expect((await database.select().from(schema.billInstances).where(eq(schema.billInstances.id, instance.id)))[0]).toEqual(instance);
    } finally { await client`ALTER TABLE bill_push_deliveries DROP CONSTRAINT reject_expired`; }
    await rescheduleBillInstance(instance.id, "2026-10-25");
    expect((await database.select().from(schema.billPushDeliveries).where(eq(schema.billPushDeliveries.id, delivery.id)))[0]).toMatchObject({ status: "expired", nextAttemptAt: null });
  });

  it.each(["income", "system fee", "archived"])("rejects an unavailable %s bill category on create and edit", async kind => {
    const [category] = await database.insert(schema.categories).values({ name: `Invalid bill ${kind}`,
      isIncome: kind === "income", isSystemFee: kind === "system fee", isArchived: kind === "archived" }).returning();
    const { instance, bill } = await fixture();
    const body = { name: "School service", type: "variable_utility", amount: 50000, due_day_of_month: 15, category_id: category.id };
    expect((await createBill(moveRequest(instance.id, body))).status).toBe(400);
    expect((await editBill(moveRequest(bill.id, { category_id: category.id }), context(bill.id))).status).toBe(400);
    expect((await database.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0].categoryId).toBeNull();
  });

  it("creates a bill category, assigns it, changes it, and removes it without changing money", async () => {
    const response = await createCategory(moveRequest(randomUUID(), { name: "Education" }));
    expect(response.status).toBe(201);
    const category = await response.json();
    const created = await createBill(moveRequest(randomUUID(), { name: "School service", type: "variable_utility",
      amount: 50000, due_day_of_month: 15, category_id: category.id }));
    expect(created.status).toBe(201);
    const { bill } = await created.json();
    const readBill = async () => (await (await GET(new Request("http://localhost/api/bills", {
      headers: { Cookie: `runway_owner_session=${token}` },
    }))).json()).find((row: { billId: string }) => row.billId === bill.id);
    expect(await readBill()).toMatchObject({ categoryId: category.id, categoryName: "Education" });
    const [other] = await database.insert(schema.categories).values({ name: "Family" }).returning();
    expect((await editBill(moveRequest(bill.id, { category_id: other.id }), context(bill.id))).status).toBe(200);
    expect(await readBill()).toMatchObject({ categoryId: other.id, categoryName: "Family" });
    expect((await editBill(moveRequest(bill.id, { category_id: null }), context(bill.id))).status).toBe(200);
    expect(await readBill()).toMatchObject({ categoryId: null, categoryName: null });
    expect(await database.select().from(schema.transactions)).toEqual([]);
  });

  it("auto-pays on the moved date and preserves the original series when payment is reversed", async () => {
    const [account] = await database.insert(schema.accounts).values({ name: "Auto-pay cash", type: "liquid", currentBalance: 100000 }).returning();
    const { bill, instance } = await fixture({ isAutoPay: true, autoPostFrom: "2026-10-01", sourceAccountId: account.id });
    await rescheduleBillInstance(instance.id, "2026-12-25");
    expect(await processDueAutoPayBills(new Date("2026-10-20T01:00:00Z"))).toBe(0);
    await postBillInstance(instance.id, { automatic: true, now: new Date("2026-12-25T01:00:00Z") });
    const rows = await database.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id));
    expect(rows.find(row => row.id !== instance.id)).toMatchObject({ dueDate: "2026-11-17", status: "upcoming" });
    const response = await adjust(new NextRequest(`http://localhost/api/bills/${instance.id}/adjust`, {
      method: "POST", headers: { Origin: "http://localhost", Cookie: `runway_owner_session=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "undo" }),
    }), context(instance.id));
    expect(response.status).toBe(200);
    expect((await database.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0].autoPostFrom).toBe("2026-11-17");
    expect((await database.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)))[0].currentBalance).toBe(100000);
  });
  it("forecasts December recurrence from PostgreSQL without creating bill instances or payments", async () => {
    const [settings] = await database.insert(schema.projectionSettings).values({ expectedSalaryAmount: 100000 }).returning();
    await database.insert(schema.incomeStreams).values({ projectionSettingsId: settings.id, name: "Forecast salary",
      netPayCents: 100000, scheduleKind: "monthly", paydayAnchor: "2026-10-30" });
    const { bill, instance } = await fixture({ name: "Forecast monthly bill", dueDayOfMonth: 22 });
    await database.update(schema.billInstances).set({ dueDate: "2026-10-22", periodIdentifier: "2026-10-22" })
      .where(eq(schema.billInstances.id, instance.id));
    const beforeInstances = await database.select().from(schema.billInstances);
    const beforeAccounts = await database.select().from(schema.accounts);
    const beforeTransactions = await database.select().from(schema.transactions);
    const response = await getForecast(new NextRequest("http://localhost/api/runway/forecast?reference_date=2026-10-18&horizon_days=75", {
      headers: { Cookie: `runway_owner_session=${token}` },
    }));
    expect(response.status).toBe(200);
    const forecast = await response.json();
    for (const date of ["2026-10-22", "2026-11-22", "2026-12-22"]) {
      expect(forecast.timeline.find((day: { date: string }) => day.date === date).duesDescription).toContain(bill.name);
    }
    expect(await database.select().from(schema.billInstances)).toEqual(beforeInstances);
    expect(await database.select().from(schema.accounts)).toEqual(beforeAccounts);
    expect(await database.select().from(schema.transactions)).toEqual(beforeTransactions);
  });
});
