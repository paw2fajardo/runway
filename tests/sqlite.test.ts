import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/libsql";
import { eq, sql } from "drizzle-orm";
import { resolveDatabaseConfig } from "../src/db/config";

describe("database selection", () => {
  it("defaults local development to SQLite and keeps production on PostgreSQL", () => {
    expect(resolveDatabaseConfig({ NODE_ENV: "development" })).toEqual({ url: "file:runway.sqlite", sqlite: true });
    expect(resolveDatabaseConfig({ NODE_ENV: "production" }).sqlite).toBe(false);
    expect(resolveDatabaseConfig({ NODE_ENV: "development", DATABASE_URL: "postgres://localhost/runway" }).sqlite).toBe(false);
    expect(() => resolveDatabaseConfig({ NODE_ENV: "production", DATABASE_URL: "file:runway.sqlite" })).toThrow("Production requires PostgreSQL");
    expect(() => resolveDatabaseConfig({ NODE_ENV: "development", DATABASE_URL: "https://example.com" })).toThrow("DATABASE_URL");
  });
});

describe("local SQLite persistence", () => {
  let schema: typeof import("../src/db/schema");
  let database: typeof import("../src/db");
  let accountId: string;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "file::memory:");
    vi.resetModules();
    schema = await import("../src/db/schema");
    database = await import("../src/db");
    // Use the application's connection so schema setup and queries share the
    // same in-memory database, including the production-shaped type boundary.
    const { generateSQLiteDrizzleJson, generateSQLiteMigration } = createRequire(import.meta.url)("drizzle-kit/api") as typeof import("drizzle-kit/api");
    const empty = await generateSQLiteDrizzleJson({});
    const snapshot = await generateSQLiteDrizzleJson(schema);
    const statements = await generateSQLiteMigration(empty, snapshot);
    // SQLite's public run() API is present on the local adapter at runtime.
    const localDb = database.db as unknown as ReturnType<typeof drizzle>;
    for (const statement of statements) await localDb.run(sql.raw(statement));
    const [{ id }] = await database.db.insert(schema.accounts).values({ name: "Local checking", type: "liquid", currentBalance: 10000 }).returning();
    accountId = id;
  }, 30000);

  afterAll(async () => {
    await database?.client.end();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("round-trips UUIDs, dates, booleans, money and JSON", async () => {
    const [account] = await database.db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
    expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(account.createdAt).toBeInstanceOf(Date);
    expect(account.isActive).toBe(true);
    expect(account.currentBalance).toBe(10000);
    const [item] = await database.db.insert(schema.inboxItems).values({ rawPayload: "local", parsedJson: { amount: 125, tags: ["expense"] } }).returning();
    expect(item.parsedJson).toEqual({ amount: 125, tags: ["expense"] });
    expect((await database.db.query.accounts.findFirst({ where: eq(schema.accounts.id, accountId), with: { transactionLegs: true } }))?.transactionLegs).toEqual([]);
  });

  it("enforces enum, singleton, digest, reminder time and foreign key constraints", async () => {
    await expect(database.db.insert(schema.accounts).values({ name: "Invalid", type: "invalid" as "liquid" })).rejects.toThrow();
    await expect(database.db.insert(schema.ownerAuth).values({ id: 2, username: "owner", passwordHash: "hash" })).rejects.toThrow();
    await database.db.insert(schema.ownerAuth).values({ username: "owner", passwordHash: "hash" });
    await expect(database.db.insert(schema.ownerSessions).values({ ownerId: 1, tokenDigest: "bad" })).rejects.toThrow();
    await expect(database.db.insert(schema.ownerSessions).values({ ownerId: 99, tokenDigest: "a".repeat(64) })).rejects.toThrow();
    await expect(database.db.transaction(async tx => {
      await tx.insert(schema.ownerSessions).values({ ownerId: 99, tokenDigest: "b".repeat(64) });
    })).rejects.toThrow();
    await expect(database.db.insert(schema.projectionSettings).values({ expectedSalaryAmount: 100, billReminderTime: "24:00" })).rejects.toThrow();
  });

  it("commits and rolls back atomic money changes", async () => {
    await expect(database.db.transaction(async tx => {
      await tx.update(schema.accounts).set({ currentBalance: sql`${schema.accounts.currentBalance} - 500` }).where(eq(schema.accounts.id, accountId));
      throw new Error("abort");
    })).rejects.toThrow("abort");
    const [account] = await database.db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
    expect(account.currentBalance).toBe(10000);
  });

  it("posts a bill atomically, creates its next occurrence, and rejects a duplicate", async () => {
    const [bill] = await database.db.insert(schema.bills).values({ name: "Local bill", type: "fixed_subscription", sourceAccountId: accountId, amount: 500, dueDayOfMonth: 11 }).returning();
    const [instance] = await database.db.insert(schema.billInstances).values({ billId: bill.id, periodIdentifier: "2026-10-11", dueDate: "2026-10-11", targetSettlementDate: "2026-10-11", amountDue: 500 }).returning();
    const { postBillInstance } = await import("../src/lib/bills/posting");
    const result = await postBillInstance(instance.id);
    expect(result.instance.status).toBe("paid");
    const [account] = await database.db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
    expect(account.currentBalance).toBe(9500);
    const instances = await database.db.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id));
    expect(instances.map(row => row.dueDate)).toContain("2026-11-11");
    await expect(postBillInstance(instance.id)).rejects.toThrow("already been recorded");
  });

  it.each([null, "liquid", "revolving_credit"] as const)("records cash payment with configured account type %s without changing money", async type => {
    const sourceId = type === "liquid" ? accountId : type === "revolving_credit"
      ? (await database.db.insert(schema.accounts).values({ name: "Cash payment credit", type,
        currentBalance: 3000, creditLimit: 20000 }).returning())[0].id : null;
    const [bill] = await database.db.insert(schema.bills).values({ name: "Untracked cash bill", type: "fixed_subscription",
      sourceAccountId: sourceId, amount: 500, dueDayOfMonth: 11 }).returning();
    const [instance] = await database.db.insert(schema.billInstances).values({ billId: bill.id, periodIdentifier: "2026-10-11",
      dueDate: "2026-10-11", targetSettlementDate: "2026-10-11", amountDue: 500 }).returning();
    const balances = await database.db.select({ id: schema.accounts.id, balance: schema.accounts.currentBalance }).from(schema.accounts);
    const transactions = await database.db.select().from(schema.transactions);
    const legs = await database.db.select().from(schema.transactionLegs);
    const events = await database.db.select().from(schema.billPaymentEvents);
    const now = new Date("2026-10-12T01:00:00Z");
    const { postBillInstance } = await import("../src/lib/bills/posting");
    const result = await postBillInstance(instance.id, { paymentMethod: "cash", now });
    expect(result.instance.status).toBe("paid");
    expect(result.instance.cashPaidAt).toEqual(now);
    expect(result.instance.amountDue).toBe(500);
    expect(result.instance.linkedTransactionId).toBeNull();
    expect(result.transaction).toBeNull();
    expect(await database.db.select({ id: schema.accounts.id, balance: schema.accounts.currentBalance }).from(schema.accounts)).toEqual(balances);
    expect(await database.db.select().from(schema.transactions)).toEqual(transactions);
    expect(await database.db.select().from(schema.transactionLegs)).toEqual(legs);
    expect(await database.db.select().from(schema.billPaymentEvents)).toEqual(events);
    expect((await database.db.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0].sourceAccountId).toBe(sourceId);
    const instances = await database.db.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id));
    expect(instances).toHaveLength(2);
    expect(instances.find(row => row.dueDate === "2026-11-11")?.cashPaidAt).toBeNull();
    await expect(postBillInstance(instance.id, { paymentMethod: "cash" })).rejects.toThrow("already been recorded");
    expect(await database.db.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id))).toHaveLength(2);
  });

  it("requires an actual cash amount for variable bills and respects the recurrence limit", async () => {
    const [bill] = await database.db.insert(schema.bills).values({ name: "Variable cash bill", type: "fixed_subscription",
      amount: 500, isVariableAmount: true, dueDayOfMonth: 11, occurrenceLimit: 1 }).returning();
    const [instance] = await database.db.insert(schema.billInstances).values({ billId: bill.id, periodIdentifier: "2026-10-11",
      dueDate: "2026-10-11", targetSettlementDate: "2026-10-11", amountDue: 500 }).returning();
    const { postBillInstance } = await import("../src/lib/bills/posting");
    await expect(postBillInstance(instance.id, { paymentMethod: "cash" })).rejects.toThrow("Enter the amount");
    await expect(postBillInstance(instance.id, { paymentMethod: "cash", amount: 0 })).rejects.toThrow("greater than zero");
    await expect(postBillInstance(instance.id, { paymentMethod: "cash", amount: 1234, automatic: true })).rejects.toThrow();
    await expect(postBillInstance(instance.id, { paymentMethod: "cash", amount: 1234, sourceAccountId: accountId })).rejects.toThrow();
    const result = await postBillInstance(instance.id, { paymentMethod: "cash", amount: 1234 });
    expect(result.instance.amountDue).toBe(1234);
    expect(await database.db.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id))).toHaveLength(1);
  });

  it("rolls back cash history when the next occurrence cannot be created", async () => {
    const [bill] = await database.db.insert(schema.bills).values({ name: "Failed recurrence", type: "fixed_subscription",
      amount: 500, dueDayOfMonth: 11 }).returning();
    const [instance] = await database.db.insert(schema.billInstances).values({ billId: bill.id, periodIdentifier: "2026-10-11",
      dueDate: "2026-10-11", targetSettlementDate: "2026-10-11", amountDue: 500 }).returning();
    const { postBillInstance } = await import("../src/lib/bills/posting");
    const localDb = database.db as unknown as ReturnType<typeof drizzle>;
    await localDb.run(sql.raw("CREATE TEMP TRIGGER reject_cash_recurrence BEFORE INSERT ON bill_instances BEGIN SELECT RAISE(ABORT, 'test recurrence failure'); END"));
    try {
      await expect(postBillInstance(instance.id, { paymentMethod: "cash" })).rejects.toThrow();
    } finally { await localDb.run(sql.raw("DROP TRIGGER reject_cash_recurrence")); }
    const [saved] = await database.db.select().from(schema.billInstances).where(eq(schema.billInstances.id, instance.id));
    expect(saved.status).toBe("upcoming");
    expect(saved.cashPaidAt).toBeNull();
  });

  it("validates cash settlement through the authenticated API and exposes its history", async () => {
    const { NextRequest } = await import("next/server");
    const { createOwnerSession } = await import("../src/lib/auth/session");
    const { POST } = await import("../src/app/api/bills/[id]/settle/route");
    const { GET } = await import("../src/app/api/bills/route");
    const [bill] = await database.db.insert(schema.bills).values({ name: "API cash bill", type: "fixed_subscription", amount: 500, dueDayOfMonth: 11 }).returning();
    const [instance] = await database.db.insert(schema.billInstances).values({ billId: bill.id, periodIdentifier: "2026-10-11",
      dueDate: "2026-10-11", targetSettlementDate: "2026-10-11", amountDue: 500 }).returning();
    const token = await createOwnerSession(1);
    const request = (body: unknown, cookie = true, origin = "http://localhost") => new NextRequest(`http://localhost/api/bills/${instance.id}/settle`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin,
        ...(cookie ? { Cookie: `runway_owner_session=${token}` } : {}) }, body: JSON.stringify(body),
    });
    const context = { params: Promise.resolve({ id: instance.id }) };
    expect((await POST(request({ payment_method: "cash" }, false), context)).status).toBe(401);
    expect((await POST(request({ payment_method: "cash" }, true, "https://foreign.example"), context)).status).toBe(403);
    expect((await POST(request({ payment_method: "unknown" }), context)).status).toBe(400);
    expect((await POST(request({ payment_method: "cash", source_account_id: accountId }), context)).status).toBe(400);
    expect((await POST(request({ payment_method: "cash" }), context)).status).toBe(200);
    const rows = await (await GET(new Request("http://localhost/api/bills", { headers: { Cookie: `runway_owner_session=${token}` } }))).json();
    expect(rows.find((row: { instanceId: string }) => row.instanceId === instance.id)).toMatchObject({ status: "paid", amountDue: 500, cashPaidAt: expect.any(String) });
    expect((await POST(request({ payment_method: "cash" }), context)).status).toBe(409);
  });

  it("reduces available credit on spending and restores it on edits, deletion and repayment", async () => {
    const { NextRequest } = await import("next/server");
    const { createOwnerSession } = await import("../src/lib/auth/session");
    const { POST } = await import("../src/app/api/transactions/compound/route");
    const { PATCH, DELETE } = await import("../src/app/api/transactions/[id]/route");
    const token = await createOwnerSession(1);
    const [credit] = await database.db.insert(schema.accounts).values({ name: "Credit test", type: "revolving_credit", currentBalance: 10000, creditLimit: 50000 }).returning();
    const [cash] = await database.db.insert(schema.accounts).values({ name: "Cash test", type: "liquid", currentBalance: 10000 }).returning();
    const request = (method: string, body?: unknown) => new NextRequest("http://localhost/api/transactions", {
      method, headers: { Cookie: `runway_owner_session=${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const balance = async (id: string) => (await database.db.select().from(schema.accounts).where(eq(schema.accounts.id, id)))[0].currentBalance;
    const post = async (body: object) => {
      const response = await POST(request("POST", { description: "Credit test", ...body }));
      expect(response.status).toBe(201);
      return (await response.json()).transaction.id as string;
    };
    const remove = async (id: string) => {
      expect((await DELETE(request("DELETE"), { params: Promise.resolve({ id }) })).status).toBe(200);
    };

    const expenseId = await post({ type: "expense", source_account_id: credit.id, gross_outflow: 1100, fee_amount: 100, category_name: "Credit test expense" });
    expect(await balance(credit.id)).toBe(11100);
    expect(credit.creditLimit! - await balance(credit.id)).toBe(38900);
    expect((await PATCH(request("PATCH", { gross_outflow: 1600 }), { params: Promise.resolve({ id: expenseId }) })).status).toBe(200);
    expect(await balance(credit.id)).toBe(11600);
    expect((await PATCH(request("PATCH", { source_account_id: cash.id }), { params: Promise.resolve({ id: expenseId }) })).status).toBe(200);
    expect(await balance(credit.id)).toBe(10000);
    expect(await balance(cash.id)).toBe(8400);
    await remove(expenseId);
    expect(await balance(cash.id)).toBe(10000);

    const repaymentId = await post({ type: "transfer", source_account_id: cash.id, destination_account_id: credit.id, gross_outflow: 1500, net_inflow: 1500 });
    expect(await balance(cash.id)).toBe(8500);
    expect(await balance(credit.id)).toBe(8500);
    expect(credit.creditLimit! - await balance(credit.id)).toBe(41500);
    await remove(repaymentId);
    expect(await balance(cash.id)).toBe(10000);
    expect(await balance(credit.id)).toBe(10000);

    const advanceId = await post({ type: "transfer", source_account_id: credit.id, destination_account_id: cash.id, gross_outflow: 700, net_inflow: 600, fee_amount: 100 });
    expect(await balance(credit.id)).toBe(10700);
    expect(await balance(cash.id)).toBe(10600);
    await remove(advanceId);
    expect(await balance(credit.id)).toBe(10000);
    expect(await balance(cash.id)).toBe(10000);

    const refundId = await post({ type: "income", destination_account_id: credit.id, net_inflow: 200 });
    expect(await balance(credit.id)).toBe(9800);
    expect((await PATCH(request("PATCH", { net_inflow: 300 }), { params: Promise.resolve({ id: refundId }) })).status).toBe(200);
    expect(await balance(credit.id)).toBe(9700);
    await remove(refundId);
    expect(await balance(credit.id)).toBe(10000);
  });

  it("reduces available credit when a bill is paid with credit", async () => {
    const [credit] = await database.db.insert(schema.accounts).values({ name: "Bill credit test", type: "revolving_credit", currentBalance: 10000, creditLimit: 50000 }).returning();
    const [bill] = await database.db.insert(schema.bills).values({ name: "Credit bill", type: "fixed_subscription", sourceAccountId: credit.id, amount: 500, dueDayOfMonth: 11 }).returning();
    const [instance] = await database.db.insert(schema.billInstances).values({ billId: bill.id, periodIdentifier: "2026-10-11", dueDate: "2026-10-11", targetSettlementDate: "2026-10-11", amountDue: 500 }).returning();
    const { postBillInstance } = await import("../src/lib/bills/posting");
    await postBillInstance(instance.id);
    const [account] = await database.db.select().from(schema.accounts).where(eq(schema.accounts.id, credit.id));
    expect(account.currentBalance).toBe(10500);
    expect(account.creditLimit! - account.currentBalance).toBe(39500);
    await expect(postBillInstance(instance.id)).rejects.toThrow("already been recorded");
    expect((await database.db.select().from(schema.accounts).where(eq(schema.accounts.id, credit.id)))[0].currentBalance).toBe(10500);
  });

  it("creates, validates and revokes an owner session", async () => {
    const { createOwnerSession, getOwnerFromRequest, revokeSession } = await import("../src/lib/auth/session");
    const token = await createOwnerSession(1);
    const request = new Request("http://localhost", { headers: { Cookie: `runway_owner_session=${token}` } });
    expect((await getOwnerFromRequest(request))?.username).toBe("owner");
    await revokeSession(token);
    expect(await getOwnerFromRequest(request)).toBeNull();
  });
});
