import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), update: vi.fn(), select: vi.fn(), requireOwner: vi.fn(), assertSameOrigin: vi.fn(),
}));

vi.mock("../src/db", () => ({ db: { transaction: mocks.transaction, update: mocks.update } }));
vi.mock("../src/lib/auth/guard", () => ({ requireOwner: mocks.requireOwner, assertSameOrigin: mocks.assertSameOrigin }));

import { DELETE, PATCH } from "../src/app/api/bills/[id]/route";

const origin = "https://runway.example";
const billId = "11111111-1111-4111-8111-111111111111";
const owner = { id: 1, username: "owner", passwordHash: "hash" };
const currentBill = {
  id: billId, name: "Internet", type: "fixed_subscription", sourceAccountId: null, targetAccountId: null,
  categoryId: null, amount: 2000, isEstimate: false, isAutoPay: false, dueDayOfMonth: 15,
  dueDayOfWeek: null, frequency: "monthly", occurrenceLimit: null, gracePeriodDays: 0, isActive: true,
};

function request(method: "PATCH" | "DELETE", body?: unknown, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/bills/${billId}`, {
    method,
    headers: { origin: requestOrigin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function context(id = billId) { return { params: Promise.resolve({ id }) }; }

function makeTx({ bill = currentBill, instances = [] }: { bill?: unknown; instances?: unknown[] } = {}) {
  const returningBill = vi.fn().mockResolvedValue(bill ? [{ ...currentBill, ...bill as object }] : []);
  const updateWhere = vi.fn().mockImplementation(() => ({ returning: returningBill }));
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere, returning: returningBill });
  let selected = 0;
  mocks.select.mockImplementation(() => {
    selected += 1;
    if (selected === 1) {
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(bill ? [currentBill] : []) }) }) };
    }
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(instances) }) };
  });
  const tx = {
    select: mocks.select,
    update: vi.fn().mockReturnValue({ set: updateSet }),
  };
  mocks.transaction.mockImplementation((callback) => callback(tx));
  mocks.update.mockReturnValue({ set: updateSet });
  return { tx, updateSet, updateWhere, returningBill };
}

describe("bill CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockImplementation((req: Request) => req.headers.get("origin") === origin ? null : Response.json({ error: "Request origin is not allowed." }, { status: 403 }));
  });

  it("updates recurring fields and moves only unpaid instances while preserving paid history", async () => {
    const unpaid = [
      { id: "a", dueDate: "2026-10-15", status: "upcoming" },
      { id: "b", dueDate: "2026-11-15", status: "grace_period" },
    ];
    const { tx, updateSet } = makeTx({ instances: unpaid });

    const response = await PATCH(request("PATCH", { frequency: "monthly", due_day_of_month: 20, amount: 2500 }), context());

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ dueDayOfMonth: 20, amount: 2500 }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ dueDate: expect.any(String), targetSettlementDate: expect.any(String), amountDue: 2500 }));
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenCalledTimes(3);
    const instanceUpdates = updateSet.mock.calls.map(([values]) => values as Record<string, unknown>).filter((values) => "amountDue" in values);
    expect(instanceUpdates).toHaveLength(2);
    expect(instanceUpdates.filter((values) => "dueDate" in values)).toHaveLength(1);
    expect(instanceUpdates.map((values) => values.amountDue)).toEqual([2500, 2500]);
  });

  it("stores whether a bill requires confirmation of its payment amount", async () => {
    const { updateSet } = makeTx();

    const response = await PATCH(request("PATCH", { is_variable_amount: true }), context());

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ isVariableAmount: true }));
  });

  it("rejects invalid body and identifier with 400", async () => {
    const invalidBody = await PATCH(request("PATCH", { amount: 0 }), context());
    const invalidId = await PATCH(request("PATCH", { name: "Updated" }), context("bad-id"));

    expect(invalidBody.status).toBe(400);
    expect(invalidId.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or inactive bill", async () => {
    makeTx({ bill: null });
    const response = await PATCH(request("PATCH", { name: "Updated" }), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Bill not found." });
  });

  it("soft-deactivates a bill and leaves instances untouched", async () => {
    const bill = { ...currentBill, isActive: false };
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([bill]) });
    const set = vi.fn().mockReturnValue({ where });
    mocks.update.mockReturnValue({ set });

    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, bill });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, updatedAt: expect.any(Date) }));
  });

  it("requires same-origin authentication before database access", async () => {
    mocks.assertSameOrigin.mockReturnValue(Response.json({ error: "Request origin is not allowed." }, { status: 403 }));

    const response = await DELETE(request("DELETE", undefined, "https://attacker.example"), context());

    expect(response.status).toBe(403);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
