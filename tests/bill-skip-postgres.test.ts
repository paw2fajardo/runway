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
      await client.unsafe(statement.replaceAll('"public".', `"${namespace}".`).replace(", 'skipped'", ""));
    }
    await client.unsafe(readFileSync("src/db/migrations/0019_skipped_bill_occurrences.sql", "utf8"));
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
});
