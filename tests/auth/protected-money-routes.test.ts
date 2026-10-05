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
      createTransaction(request("POST", "/api/transactions/compound", foreign)),
      reconcileCheckpoint(request("POST", "/api/checkpoints/reconcile", foreign)),
      createBill(request("POST", "/api/bills", foreign)),
      settleBill(request("POST", "/api/bills/one/settle", foreign), { params: Promise.resolve({ id: "one" }) }),
    ];

    const responses = await Promise.all(cases);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
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
});
