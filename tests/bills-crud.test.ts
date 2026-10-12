import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), update: vi.fn(), select: vi.fn(), requireOwner: vi.fn(), assertSameOrigin: vi.fn(),
}));

vi.mock("../src/db", () => ({ db: { transaction: mocks.transaction, update: mocks.update } }));
vi.mock("../src/lib/auth/guard", () => ({ requireOwner: mocks.requireOwner, assertSameOrigin: mocks.assertSameOrigin }));

import { DELETE, PATCH } from "../src/app/api/bills/[id]/route";
import { POST } from "../src/app/api/bills/route";
import { nextBillDueDate } from "../src/lib/bill-schedule";

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
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(bill ? [{ ...currentBill, ...bill as object }] : []) }) }) };
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
  it("creates a biweekly bill on the chosen Friday with no earlier occurrence", async () => {
    const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: billId }]) });
    mocks.transaction.mockImplementation((callback) => callback({ insert: vi.fn().mockReturnValue({ values }) }));
    const response = await POST(new NextRequest(`${origin}/api/bills`, { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name: "Groceries", type: "variable_utility", amount: 250000, frequency: "biweekly", first_due_date: "2026-10-23" }),
    }));
    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ dueDate: "2026-10-23", periodIdentifier: "2026-10-23" }));
    expect(values).toHaveBeenCalledTimes(2);
    expect(nextBillDueDate("2026-10-23", "biweekly", 23)).toBe("2026-11-06");
    expect(nextBillDueDate("2026-11-06", "biweekly", 23)).toBe("2026-11-20");
    expect(nextBillDueDate("2026-12-25", "biweekly", 25)).toBe("2027-01-08");
  });
  it("anchors biweekly unpaid dates to an explicit first date", async () => {
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockReturnValue(null);
    const { updateSet } = makeTx({ instances: [
      { id: "a", dueDate: "2026-10-16", status: "upcoming" },
      { id: "b", dueDate: "2026-10-30", status: "upcoming" },
      { id: "paid", dueDate: "2026-10-02", status: "paid" },
    ] });
    const response = await PATCH(request("PATCH", { frequency: "biweekly", first_due_date: "2026-10-23" }), context());
    expect(response.status).toBe(200);
    const dates = updateSet.mock.calls.map(([values]) => (values as Record<string, unknown>).dueDate).filter(Boolean);
    expect(dates).toEqual(["2026-10-23", "2026-11-06"]);
    const periodMoves = updateSet.mock.calls.map(([values]) => values as Record<string, unknown>).filter((values) => String(values.periodIdentifier).startsWith("move"));
    expect(periodMoves).toHaveLength(2);
    expect(new Set(periodMoves.map((values) => values.periodIdentifier)).size).toBe(2);
  });

  it.each(["2026-02-30", "2026-13-01", "23/10/2026"])("rejects invalid first due date %s", async (date) => {
    const response = await PATCH(request("PATCH", { frequency: "biweekly", first_due_date: date }), context());
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("keeps a legacy biweekly anchor when editing its amount", async () => {
    const legacyBill = { ...currentBill, frequency: "biweekly", dueDayOfWeek: 5 };
    const { updateSet } = makeTx({ bill: legacyBill, instances: [{ id: "a", dueDate: "2026-10-23", status: "upcoming" }] });
    const response = await PATCH(request("PATCH", { amount: 3000 }), context());
    expect(response.status).toBe(200);
    const instanceUpdate = updateSet.mock.calls.map(([values]) => values as Record<string, unknown>).find((values) => "amountDue" in values);
    expect(instanceUpdate).toMatchObject({ amountDue: 3000 });
    expect(instanceUpdate).not.toHaveProperty("dueDate");
  });

  it("rejects a first date on monthly bills", async () => {
    makeTx();
    const response = await PATCH(request("PATCH", { first_due_date: "2026-10-23" }), context());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("only supported for biweekly");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReset();
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

  it.each([
    ["liquid", true, 200],
    ["revolving_credit", true, 200],
    ["revolving_credit", false, 400],
    ["installment_loan", true, 400],
  ])("validates %s accounts (active: %s) for auto-pay", async (type, isActive, status) => {
    const accountId = "22222222-2222-4222-8222-222222222222";
    const account = { id: accountId, type, isActive };
    makeTx();
    const selection = (rows: unknown[]) => ({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }) }),
    });
    mocks.select
      .mockReturnValueOnce(selection([{ ...currentBill, isAutoPay: true, autoPostFrom: "2026-10-01" }]))
      .mockReturnValueOnce(selection(isActive ? [account] : []))
      .mockReturnValueOnce(selection([account]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });

    const response = await PATCH(request("PATCH", {
      is_auto_pay: true, source_account_id: accountId,
    }), context());

    expect(response.status).toBe(status);
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
