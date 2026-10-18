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
import { POST as parse } from "../src/app/api/inbox/parse/route";
import { POST as approve } from "../src/app/api/inbox/[id]/approve/route";
import { GET as insights } from "../src/app/api/runway/insights/route";
import { GET as getBaseline, POST as saveBaseline } from "../src/app/api/runway/baseline/route";
import { GET as forecast } from "../src/app/api/runway/forecast/route";
import { createOwnerSession } from "../src/lib/auth/session";
import { todayInManila } from "../src/lib/bills/due-date";
import { insightDate } from "../src/lib/insights";

const url = process.env.RUNWAY_POSTGRES_TEST_URL;
describe.skipIf(!url)("AI features on disposable PostgreSQL", () => {
  const namespace = `ai_features_${randomUUID().replaceAll("-", "")}`;
  let setup: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let cookie: string;
  let categoryId: string;
  let mainAccount: string;
  const today = todayInManila();

  beforeAll(async () => {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname)) throw new Error("Only disposable local PostgreSQL is allowed.");
    vi.stubEnv("OPENROUTER_API_KEY", ""); vi.stubEnv("AI_API_KEY", "");
    setup = postgres(url!, { max: 1, onnotice: () => {} });
    await setup.unsafe(`CREATE SCHEMA "${namespace}"`);
    await setup.unsafe(`SET search_path TO "${namespace}"`);
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api") as typeof import("drizzle-kit/api");
    const { forecastBaselines: _baseline, ...withoutBaseline } = schema;
    for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(withoutBaseline))) {
      await setup.unsafe(statement.replaceAll('"public".', `"${namespace}".`));
    }
    await setup.unsafe(readFileSync("src/db/migrations/0021_forecast_baseline.sql", "utf8"));
    client = postgres(url!, { max: 4, connection: { search_path: namespace }, onnotice: () => {} });
    database = drizzle(client, { schema }); state.database = database;
    await database.insert(schema.ownerAuth).values({ username: "ai-test-owner", passwordHash: "unused" });
    cookie = `runway_owner_session=${await createOwnerSession(1)}`;
    const [account] = await database.insert(schema.accounts).values({ name: "GCash", type: "liquid", currentBalance: 100000 }).returning(); mainAccount = account.id;
    const [category] = await database.insert(schema.categories).values({ name: "Groceries" }).returning(); categoryId = category.id;
    await database.insert(schema.categories).values({ name: "Fees", isSystemFee: true });
    const [settings] = await database.insert(schema.projectionSettings).values({ expectedSalaryAmount: 300000, dailyDiscretionaryBurn: 1000 }).returning();
    await database.insert(schema.incomeStreams).values({ projectionSettingsId: settings.id, name: "Salary", netPayCents: 300000,
      destinationAccountId: mainAccount, scheduleKind: "weekly", paydayAnchor: insightDate(today, 5), isEnabled: true });
  }, 30000);

  afterAll(async () => {
    await client?.end();
    if (setup) { await setup.unsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await setup.end(); }
    vi.unstubAllEnvs();
  });

  const request = (path: string, body?: unknown, authenticated = true) => new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...(authenticated ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const balance = async (id: string) => (await database.select().from(schema.accounts).where(eq(schema.accounts.id, id)))[0].currentBalance;
  const stage = async (data: Partial<import("../src/lib/types").ParsedInboxItem> = {}) => (await database.insert(schema.inboxItems).values({
    sourceChannel: "quick_text", rawPayload: "Fixture payment", parsedJson: { merchant: `Payment ${randomUUID()}`, amount_cents: 1000, type: "expense", fee_cents: 0, confidence: 1, raw_summary: "Fixture", ...data },
  }).returning())[0];
  const confirm = (id: string, body: unknown) => approve(request(`/api/inbox/${id}/approve`, body), { params: Promise.resolve({ id }) });

  it("applies the real baseline migration and its singleton constraint", async () => {
    const rows = await setup`SELECT data_type FROM information_schema.columns WHERE table_schema = ${namespace} AND table_name = 'forecast_baselines' AND column_name = 'forecast'`;
    expect(rows[0].data_type).toBe("jsonb");
    await expect(setup.unsafe("INSERT INTO forecast_baselines (id, forecast) VALUES (2, '{}')")).rejects.toMatchObject({ code: "23514" });
  });

  it("stages plain language with an existing category and leaves balances untouched", async () => {
    const before = await balance(mainAccount);
    const response = await parse(request("/api/inbox/parse", { raw_payload: "Spent ₱420 on groceries using GCash", source_channel: "quick_text" }));
    expect(response.status).toBe(201);
    expect((await response.json()).parsedJson).toMatchObject({ amount_cents: 42000, category_hint: "Groceries", source_account_hint: "GCash" });
    expect(await balance(mainAccount)).toBe(before);
  });

  it("requires a source account instead of guessing the first account", async () => {
    const item = await stage(); const before = await balance(mainAccount);
    expect((await confirm(item.id, {})).status).toBe(400);
    expect(await balance(mainAccount)).toBe(before);
  });

  it("records principal plus fees once and serializes concurrent approvals", async () => {
    const item = await stage({ fee_cents: 100 }); const before = await balance(mainAccount);
    const results = await Promise.all([confirm(item.id, { source_account_id: mainAccount, category_id: categoryId }),
      confirm(item.id, { source_account_id: mainAccount, category_id: categoryId })]);
    expect(results.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await balance(mainAccount)).toBe(before - 1100);
    const success = results.find(response => response.status === 200)!;
    const saved = await success.json();
    const legs = await database.select().from(schema.transactionLegs).where(eq(schema.transactionLegs.transactionId, saved.transaction.id));
    expect(legs.reduce((total, leg) => total + leg.amount, 0)).toBe(0);
  });

  it("credits income and increases outstanding credit debt on expenses", async () => {
    const [credit] = await database.insert(schema.accounts).values({ name: "Credit fixture", type: "revolving_credit", currentBalance: 50000 }).returning();
    const expense = await stage();
    expect((await confirm(expense.id, { source_account_id: credit.id })).status).toBe(200);
    expect(await balance(credit.id)).toBe(51000);
    const income = await stage({ type: "income" }); const before = await balance(mainAccount);
    expect((await confirm(income.id, { destination_account_id: mainAccount })).status).toBe(200);
    expect(await balance(mainAccount)).toBe(before + 1000);
  });

  it("persists reviewed corrections and settles a linked bill without a second debit", async () => {
    const [bill] = await database.insert(schema.bills).values({ name: "Linked bill fixture", type: "variable_utility",
      amount: 5000, isVariableAmount: true, dueDayOfMonth: Number(today.slice(8)) }).returning();
    const [instance] = await database.insert(schema.billInstances).values({ billId: bill.id,
      periodIdentifier: today, dueDate: today, targetSettlementDate: today, amountDue: 5000 }).returning();
    const item = await stage(); const before = await balance(mainAccount);
    const response = await confirm(item.id, { source_account_id: mainAccount, amount_cents: 4500,
      merchant: "Reviewed description", bill_instance_id: instance.id });
    expect(response.status).toBe(200);
    expect(await balance(mainAccount)).toBe(before - 4500);
    const saved = await response.json();
    expect(saved.inbox_item.parsedJson).toMatchObject({ merchant: "Reviewed description", amount_cents: 4500 });
    const [paid] = await database.select().from(schema.billInstances).where(eq(schema.billInstances.id, instance.id));
    expect(paid.status).toBe("paid");
    expect(paid.linkedTransactionId).toBe(saved.transaction.id);
    expect(await database.select().from(schema.billInstances).where(eq(schema.billInstances.billId, bill.id))).toHaveLength(2);
  });

  it("records transfer principal and additional fees without classifying principal as spending", async () => {
    const [destination] = await database.insert(schema.accounts).values({ name: "Transfer destination", type: "liquid", currentBalance: 0 }).returning();
    const item = await stage({ type: "transfer", fee_cents: 100 }); const before = await balance(mainAccount);
    expect((await confirm(item.id, { source_account_id: mainAccount, destination_account_id: destination.id })).status).toBe(200);
    expect(await balance(mainAccount)).toBe(before - 1100);
    expect(await balance(destination.id)).toBe(1000);
  });

  it("blocks entries already covered by reconciliation and finds dated pending evidence", async () => {
    const [account] = await database.insert(schema.accounts).values({ name: "Evidence wallet", type: "liquid", currentBalance: 10000 }).returning();
    const at = new Date(`${insightDate(today, -1)}T12:00:00+08:00`);
    const item = await stage({ merchant: "Missing lunch", source_account_hint: account.name, transacted_at: at.toISOString(), amount_cents: 500 });
    await database.insert(schema.balanceCheckpoints).values({ accountId: account.id, verifiedBalance: 10000, discrepancyAmount: -500 });
    const response = await confirm(item.id, { source_account_id: account.id });
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("ALREADY_RECONCILED");
    expect(await balance(account.id)).toBe(10000);
    const data = await (await insights(request("/api/runway/insights"))).json();
    expect(data.reconciliation.find((value: { account_id: string }) => value.account_id === account.id).candidates[0].id).toBe(item.id);
  });

  it("rejects a discarded item, invalid category, and future timestamps without ledger changes", async () => {
    const item = await stage(); const before = await balance(mainAccount);
    await database.update(schema.inboxItems).set({ status: "discarded" }).where(eq(schema.inboxItems.id, item.id));
    expect((await confirm(item.id, { source_account_id: mainAccount })).status).toBe(409);
    const other = await stage();
    expect((await confirm(other.id, { source_account_id: mainAccount, category_id: randomUUID() })).status).toBe(400);
    expect((await confirm(other.id, { source_account_id: mainAccount, transacted_at: new Date(Date.now() + 3600000).toISOString() })).status).toBe(400);
    expect(await balance(mainAccount)).toBe(before);
  });

  it("detects duplicate payments and requires an explicit override", async () => {
    const data = { merchant: "Duplicate fixture", amount_cents: 1234 };
    const first = await stage(data); const second = await stage(data);
    expect((await confirm(first.id, { source_account_id: mainAccount })).status).toBe(200);
    const rejected = await confirm(second.id, { source_account_id: mainAccount });
    expect(rejected.status).toBe(409); expect((await rejected.json()).code).toBe("POSSIBLE_DUPLICATE");
    expect((await confirm(second.id, { source_account_id: mainAccount, confirm_duplicate: true })).status).toBe(200);
  });

  it("saves a single server-generated baseline, compares changes, and replaces it explicitly", async () => {
    expect((await saveBaseline(request("/api/runway/baseline", {}))).status).toBe(200);
    await database.update(schema.accounts).set({ currentBalance: 200000 }).where(eq(schema.accounts.id, mainAccount));
    const comparison = await (await getBaseline(request("/api/runway/baseline"))).json();
    expect(comparison.comparison.metrics[0].change_cents).not.toBe(0);
    expect((await saveBaseline(request("/api/runway/baseline", {}))).status).toBe(200);
    expect(await database.select().from(schema.forecastBaselines)).toHaveLength(1);
    const after = await (await getBaseline(request("/api/runway/baseline"))).json();
    expect(after.comparison.metrics.every((value: { change_cents: number }) => value.change_cents === 0)).toBe(true);
  });

  it("recalculates purchase timing without saving hypothetical transactions", async () => {
    const before = await database.select().from(schema.transactions);
    const response = await forecast(request(`/api/runway/forecast?horizon_days=45&reference_date=${today}&purchase_cents=50000`));
    expect(response.status).toBe(200);
    expect((await response.json()).purchase_scenarios.now.timeline[0].duesDescription).toContain("Hypothetical purchase");
    expect(await database.select().from(schema.transactions)).toEqual(before);
  });

  it("protects insights and baseline endpoints and rejects foreign-origin writes", async () => {
    expect((await insights(request("/api/runway/insights", undefined, false))).status).toBe(401);
    expect((await getBaseline(request("/api/runway/baseline", undefined, false))).status).toBe(401);
    expect((await saveBaseline(new NextRequest("http://localhost/api/runway/baseline", { method: "POST", headers: { origin: "https://attacker.test" } }))).status).toBe(403);
  });
});
