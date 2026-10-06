import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ select: vi.fn(), requireOwner: vi.fn(), assertSameOrigin: vi.fn() }));
vi.mock("../src/db", () => ({ db: { select: mocks.select } }));
vi.mock("../src/lib/auth/guard", () => ({ requireOwner: mocks.requireOwner, assertSameOrigin: mocks.assertSameOrigin }));

import { GET } from "../src/app/api/transactions/route";
import { DELETE, PATCH } from "../src/app/api/transactions/[id]/route";
import { accountBalanceAdjustments, isQuickLogEligible } from "../src/lib/transaction-crud";

const url = "https://runway.example/api/transactions";
const context = { params: Promise.resolve({ id: "bad-id" }) };
const req = (method = "GET") => new NextRequest(url, { method, headers: { origin: "https://runway.example" } });

describe("logged transaction CRUD boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertSameOrigin.mockReturnValue(null);
    mocks.requireOwner.mockResolvedValue({ id: 1 });
  });

  it("requires owner authentication for listing", async () => {
    mocks.requireOwner.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await GET(req());
    expect(response.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([PATCH, DELETE])("rejects malformed ids before reading transaction records", async (handler) => {
    const response = await handler(req("PATCH"), context);
    expect(response.status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects cross-origin listing requests before authentication", async () => {
    mocks.assertSameOrigin.mockReturnValue(new Response(null, { status: 403 }));
    const response = await GET(req());
    expect(response.status).toBe(403);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
  });

  it("includes ordinary inflows with an uncategorized category leg and excludes one-leg reconciliation adjustments", () => {
    const incomeLegs = [{ accountId: "account-1" }, { accountId: null }];
    const reconciliationLegs = [{ accountId: "account-1" }];
    expect(isQuickLogEligible("income", incomeLegs)).toBe(true);
    expect(isQuickLogEligible("income", reconciliationLegs)).toBe(false);
  });

  it("computes reversal before replacement and applies the new account leg amounts", () => {
    const oldLegs = [
      { accountId: "source", amount: -1200 },
      { accountId: null, amount: 1100 },
      { accountId: "destination", amount: 700 },
    ];
    const newLegs = [
      { accountId: "source", amount: -1500 },
      { accountId: "destination", amount: 1000 },
    ];
    expect([...accountBalanceAdjustments(oldLegs, "reverse")]).toEqual([["source", 1200], ["destination", -700]]);
    expect([...accountBalanceAdjustments(newLegs, "apply")]).toEqual([["source", -1500], ["destination", 1000]]);
  });
});
