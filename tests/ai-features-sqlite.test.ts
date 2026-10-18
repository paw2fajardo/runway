import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { drizzle } from "drizzle-orm/libsql";
import { eq, sql } from "drizzle-orm";

describe("AI feature persistence on local SQLite", () => {
  let database: typeof import("../src/db");
  let schema: typeof import("../src/db/schema");
  let cookie: string;
  let accountId: string;
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "file::memory:"); vi.resetModules();
    schema = await import("../src/db/schema"); database = await import("../src/db");
    const { generateSQLiteDrizzleJson, generateSQLiteMigration } = createRequire(import.meta.url)("drizzle-kit/api") as typeof import("drizzle-kit/api");
    const statements = await generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(schema));
    for (const statement of statements) await (database.db as unknown as ReturnType<typeof drizzle>).run(sql.raw(statement));
    await database.db.insert(schema.ownerAuth).values({ username: "sqlite-ai-owner", passwordHash: "unused" });
    const { createOwnerSession } = await import("../src/lib/auth/session"); cookie = `runway_owner_session=${await createOwnerSession(1)}`;
    const [account] = await database.db.insert(schema.accounts).values({ name: "SQLite wallet", type: "liquid", currentBalance: 10000 }).returning(); accountId = account.id;
    const [settings] = await database.db.insert(schema.projectionSettings).values({ expectedSalaryAmount: 30000 }).returning();
    await database.db.insert(schema.incomeStreams).values({ projectionSettingsId: settings.id, name: "Salary", netPayCents: 30000,
      scheduleKind: "monthly", paydayAnchor: "2026-10-23", destinationAccountId: accountId });
  }, 30000);
  afterAll(async () => { await database?.client.end(); vi.unstubAllEnvs(); vi.resetModules(); });
  const request = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  it("stores and compares a server-generated JSON baseline", async () => {
    const { POST, GET } = await import("../src/app/api/runway/baseline/route");
    expect((await POST(request("/api/runway/baseline", {}))).status).toBe(200);
    expect((await (await GET(request("/api/runway/baseline"))).json()).comparison.metrics.every((item: { change_cents: number }) => item.change_cents === 0)).toBe(true);
    expect((await POST(request("/api/runway/baseline", {}))).status).toBe(200);
    expect(await database.db.select().from(schema.forecastBaselines)).toHaveLength(1);
  });
  it("saves a reviewed expense exactly once and exposes it to analytics", async () => {
    const [item] = await database.db.insert(schema.inboxItems).values({ sourceChannel: "quick_text", rawPayload: "Fixture",
      parsedJson: { merchant: "SQLite lunch", amount_cents: 500, type: "expense", fee_cents: 0, confidence: 1, raw_summary: "Fixture" } }).returning();
    const { POST } = await import("../src/app/api/inbox/[id]/approve/route");
    const confirm = () => POST(request(`/api/inbox/${item.id}/approve`, { source_account_id: accountId }), { params: Promise.resolve({ id: item.id }) });
    expect((await confirm()).status).toBe(200); expect((await confirm()).status).toBe(409);
    expect((await database.db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)))[0].currentBalance).toBe(9500);
    const { GET } = await import("../src/app/api/runway/insights/route");
    const response = await GET(request("/api/runway/insights")); expect(response.status).toBe(200);
    expect((await response.json()).weekly.unclassified_cents).toBe(500);
  });
});
