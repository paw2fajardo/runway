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

  it("creates, validates and revokes an owner session", async () => {
    const { createOwnerSession, getOwnerFromRequest, revokeSession } = await import("../src/lib/auth/session");
    const token = await createOwnerSession(1);
    const request = new Request("http://localhost", { headers: { Cookie: `runway_owner_session=${token}` } });
    expect((await getOwnerFromRequest(request))?.username).toBe("owner");
    await revokeSession(token);
    expect(await getOwnerFromRequest(request)).toBeNull();
  });
});
