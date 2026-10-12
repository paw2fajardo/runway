import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("../src/db", () => ({ get db() { return state.database; } }));
vi.mock("../src/db/config", () => ({ databaseConfig: { sqlite: false } }));
vi.mock("../src/lib/auth/guard", () => ({ assertSameOrigin: () => null, requireOwner: async () => ({ id: 1 }) }));

import { POST } from "../src/app/api/transactions/compound/route";
import { PATCH, DELETE } from "../src/app/api/transactions/[id]/route";
import { loadPlannedBudgetSpending } from "../src/lib/planned-budget-spending";
import { remainingBudgetReserve } from "../src/lib/planned-budgets";

const url = process.env.RUNWAY_POSTGRES_TEST_URL;
describe.skipIf(!url)("PostgreSQL grocery expense recording", () => {
  let client: ReturnType<typeof postgres>;
  const account = randomUUID(), budget = randomUUID(), category = randomUUID();
  beforeAll(async () => {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname)) throw new Error("Only disposable local PostgreSQL is allowed.");
    client = postgres(url!, { max: 1 });
    await client`SET search_path TO pg_temp`;
    await client.unsafe(`
      CREATE TEMP TABLE accounts (id uuid PRIMARY KEY, name text, type text, currency text, current_balance bigint CHECK (current_balance >= 0), initial_balance bigint, credit_limit bigint, statement_cutoff_day smallint, payment_due_day smallint, is_active boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, is_income boolean, is_system_fee boolean, is_archived boolean DEFAULT false, created_at timestamptz DEFAULT now());
      CREATE TEMP TABLE transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, description text, transacted_at timestamptz, created_at timestamptz DEFAULT now());
      CREATE TEMP TABLE transaction_legs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid REFERENCES transactions(id) ON DELETE CASCADE, account_id uuid, category_id uuid, amount bigint, created_at timestamptz DEFAULT now());
      CREATE TEMP TABLE planned_budgets (id uuid PRIMARY KEY, name text, amount_cents bigint, start_date date, cadence text, is_active boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE bill_instances (id uuid, linked_transaction_id uuid);
      CREATE TEMP TABLE bill_payment_events (transaction_id uuid);
      CREATE TEMP TABLE paycheck_occurrences (id uuid, transaction_id uuid, reversal_transaction_id uuid);
    `);
    // Apply the real migration in a temporary schema, never public application tables.
    const migration = readFileSync("src/db/migrations/0018_planned_budget_expenses.sql", "utf8").replace("CREATE TABLE ", "CREATE TEMP TABLE ");
    await client.unsafe(migration);
    state.database = drizzle(client);
    await client`INSERT INTO accounts (id, name, type, current_balance, is_active) VALUES (${account}, 'Cash', 'liquid', 100000, true)`;
    await client`INSERT INTO categories (id, name, is_income, is_system_fee) VALUES (${category}, 'Groceries', false, false)`;
    await client`INSERT INTO planned_budgets (id, name, amount_cents, start_date, cadence, is_active) VALUES (${budget}, 'Groceries', 10000, '2026-10-09', 'biweekly', true)`;
  });
  afterAll(async () => { await client?.end(); });
  const request = (body: unknown, method = "POST") => new NextRequest("http://localhost/api/transactions/compound", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const expense = (amount: number, date = "2026-10-09", finish = false) => ({ type: "expense", description: "Grocery shop", source_account_id: account, category_id: category,
    gross_outflow: amount, transacted_at: "2026-10-12T08:00:00.000Z", planned_budget_id: budget, planned_budget_occurrence_date: date,
    finish_planned_budget_occurrence: finish, idempotency_key: randomUUID() });
  const reserve = async (date: string) => remainingBudgetReserve(10000, await loadPlannedBudgetSpending(), budget, date);

  it("records partial spend atomically, ignores duplicate retries, preserves future reserves", async () => {
    const body = expense(4000);
    expect((await POST(request(body))).status).toBe(201);
    expect((await POST(request(body))).status).toBe(201);
    expect(await reserve("2026-10-09")).toBe(6000);
    expect(await reserve("2026-10-23")).toBe(10000);
    const [row] = await client`SELECT current_balance FROM accounts WHERE id = ${account}`;
    expect(Number(row.current_balance)).toBe(96000);
    expect((await POST(request({ ...body, gross_outflow: 5000 }))).status).toBe(400);
  });
  it("finishes only the linked occurrence, edits its spending, and reopens when completion is deleted", async () => {
    const body = expense(2000, "2026-10-09", true);
    expect((await POST(request(body))).status).toBe(201);
    expect(await reserve("2026-10-09")).toBe(0);
    const context = { params: Promise.resolve({ id: body.idempotency_key }) };
    expect((await PATCH(request({ gross_outflow: 3000 }, "PATCH"), context)).status).toBe(200);
    expect(await reserve("2026-10-09")).toBe(0);
    expect((await PATCH(request({ type: "income", destination_account_id: account, net_inflow: 3000 }, "PATCH"), context)).status).toBe(400);
    expect((await DELETE(new NextRequest("http://localhost", { method: "DELETE" }), context)).status).toBe(200);
    expect(await reserve("2026-10-09")).toBe(6000);
  });
  it("clamps overspending and rejects off-cycle or impossible dates without writing", async () => {
    expect((await POST(request(expense(12000, "2026-10-23")))).status).toBe(201);
    expect(await reserve("2026-10-23")).toBe(0);
    expect((await POST(request(expense(100, "2026-10-16")))).status).toBe(400);
    expect((await POST(request(expense(100, "2026-02-30")))).status).toBe(400);
    const [row] = await client`SELECT count(*) AS count FROM transactions`;
    expect(Number(row.count)).toBe(2);
  });
  it("rolls back the expense and occurrence event when the balance write fails", async () => {
    const body = expense(999999, "2026-11-06", true);
    expect((await POST(request(body))).status).toBe(400);
    expect(await reserve("2026-11-06")).toBe(10000);
    const [row] = await client`SELECT count(*) AS count FROM transactions WHERE id = ${body.idempotency_key}`;
    expect(Number(row.count)).toBe(0);
  });
  it("keeps a retry with an omitted timestamp idempotent", async () => {
    const { transacted_at: _timestamp, ...body } = expense(1000, "2026-11-06");
    const responses = await Promise.all([POST(request(body)), POST(request(body))]);
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(await reserve("2026-11-06")).toBe(9000);
    const [row] = await client`SELECT count(*) AS count FROM transactions WHERE id = ${body.idempotency_key}`;
    expect(Number(row.count)).toBe(1);
  });
});
