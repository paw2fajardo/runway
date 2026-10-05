import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  requireOwner: vi.fn(),
  assertSameOrigin: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}));

vi.mock("../../src/lib/auth/guard", () => ({
  requireOwner: mocks.requireOwner,
  assertSameOrigin: mocks.assertSameOrigin,
}));

import { GET as getAccounts, POST as createAccount } from "../../src/app/api/accounts/route";
import { PATCH as updateAccount } from "../../src/app/api/accounts/[id]/route";
import { POST as createTransaction } from "../../src/app/api/transactions/compound/route";
import { POST as reconcileCheckpoint } from "../../src/app/api/checkpoints/reconcile/route";
import { GET as getBills, POST as createBill } from "../../src/app/api/bills/route";
import { POST as settleBill } from "../../src/app/api/bills/[id]/settle/route";

const owner = { id: 1, username: "owner", passwordHash: "hash" };
const appOrigin = "https://runway.example";

function request(method: string, path: string, origin = appOrigin, body = "{}") {
  return new NextRequest(`${appOrigin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: method === "GET" ? undefined : body,
  });
}

function resolvedQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    innerJoin: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return query;
}

describe("owner-protected money routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockImplementation((req: Request) =>
      req.headers.get("origin") === appOrigin
        ? null
        : Response.json({ error: "Request origin is not allowed." }, { status: 403 }),
    );
    mocks.select.mockReturnValue(resolvedQuery([]));
  });

  it("rejects unauthenticated account and bill reads before database access", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));

    const accountResponse = await getAccounts(request("GET", "/api/accounts"));
    const billResponse = await getBills(request("GET", "/api/bills"));

    expect(accountResponse.status).toBe(401);
    expect(billResponse.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated mutations before database access", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));

    const response = await createAccount(request("POST", "/api/accounts"));

    expect(response.status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects foreign-origin writes on every protected mutation before auth or finance DB access", async () => {
    const foreign = "https://attacker.example";
    const cases = [
      createAccount(request("POST", "/api/accounts", foreign)),
      updateAccount(request("PATCH", "/api/accounts/account-1", foreign), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) }),
      createTransaction(request("POST", "/api/transactions/compound", foreign)),
      reconcileCheckpoint(request("POST", "/api/checkpoints/reconcile", foreign)),
      createBill(request("POST", "/api/bills", foreign)),
      settleBill(request("POST", "/api/bills/one/settle", foreign), { params: Promise.resolve({ id: "one" }) }),
    ];

    const responses = await Promise.all(cases);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("preserves the authenticated account-read payload", async () => {
    const account = { id: "account-1", name: "Main", isActive: true };
    mocks.select.mockReturnValue(resolvedQuery([account]));

    const response = await getAccounts(request("GET", "/api/accounts"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([account]);
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.select).toHaveBeenCalledOnce();
  });

  it("creates an account with its initial and current balances in sync", async () => {
    const saved = { id: "00000000-0000-4000-8000-000000000001", initialBalance: 42000, currentBalance: 42000 };
    const returning = vi.fn().mockResolvedValue([saved]);
    const values = vi.fn(() => ({ returning }));
    mocks.insert.mockReturnValue({ values });

    const response = await createAccount(request("POST", "/api/accounts", appOrigin, JSON.stringify({
      name: "Main", type: "liquid", current_balance: 42000,
    })));

    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ initialBalance: 42000, currentBalance: 42000 }));
  });

  it("updates account metadata without changing its current balance", async () => {
    const saved = { id: "00000000-0000-4000-8000-000000000001", name: "Travel", type: "revolving_credit", currentBalance: 12500, creditLimit: 50000, statementCutoffDay: 12, paymentDueDay: 25 };
    const returning = vi.fn().mockResolvedValue([saved]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    mocks.update.mockReturnValue({ set });

    const response = await updateAccount(request("PATCH", `/api/accounts/${saved.id}`, appOrigin, JSON.stringify({
      name: "Travel", type: "revolving_credit", credit_limit: 50000, statement_cutoff_day: 12, payment_due_day: 25,
    })), { params: Promise.resolve({ id: saved.id }) });

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledOnce();
    const changes = set.mock.calls[0][0];
    expect(changes).toMatchObject({ name: "Travel", type: "revolving_credit", creditLimit: 50000, statementCutoffDay: 12, paymentDueDay: 25 });
    expect(changes).not.toHaveProperty("currentBalance");
    expect(await response.json()).toEqual(saved);
  });

  it("recomputes current balance from the new initial balance and ledger activity", async () => {
    const saved = { id: "00000000-0000-4000-8000-000000000001", initialBalance: 50000, currentBalance: 63750 };
    const returning = vi.fn().mockResolvedValue([saved]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    mocks.update.mockReturnValue({ set });

    const response = await updateAccount(request("PATCH", `/api/accounts/${saved.id}`, appOrigin, JSON.stringify({ initial_balance: 50000 })), { params: Promise.resolve({ id: saved.id }) });

    expect(response.status).toBe(200);
    const changes = set.mock.calls[0][0];
    expect(changes.initialBalance).toBe(50000);
    expect(changes.currentBalance).toBeDefined();
    expect(String(changes.currentBalance.queryChunks ?? changes.currentBalance)).toContain("transaction_legs");
    expect(String(changes.currentBalance.queryChunks ?? changes.currentBalance)).toContain("income_stream_deposits");
  });

  it("rejects invalid account changes and returns not found for unavailable accounts", async () => {
    const invalid = await updateAccount(request("PATCH", "/api/accounts/00000000-0000-4000-8000-000000000001", appOrigin, JSON.stringify({ current_balance: 100 })), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    expect(invalid.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();

    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    mocks.update.mockReturnValue({ set });
    const missing = await updateAccount(request("PATCH", "/api/accounts/00000000-0000-4000-8000-000000000001", appOrigin, JSON.stringify({ name: "Missing" })), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    expect(missing.status).toBe(404);
  });

  it("rejects unauthenticated account updates before database access", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    const response = await updateAccount(request("PATCH", "/api/accounts/00000000-0000-4000-8000-000000000001", appOrigin, JSON.stringify({ name: "Main" })), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
