import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ select: vi.fn(), requireOwner: vi.fn() }));
vi.mock("../src/db", () => ({ db: { select: mocks.select } }));
vi.mock("../src/lib/auth/guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("../src/lib/planned-budget-spending", () => ({ loadPlannedBudgetSpending: async () => [] }));
import { GET } from "../src/app/api/runway/forecast/route";

function query(rows: unknown[]) {
  const result = { from: () => result, where: () => result, orderBy: () => result,
    innerJoin: () => result, limit: async () => rows,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  return result;
}

function fixtures() {
  mocks.select.mockReturnValueOnce(query([{ currentBalance: 10000 }]))
    .mockReturnValueOnce(query([{ id: "settings", expectedSalaryAmount: 30000, dailyDiscretionaryBurn: 1000 }]))
    .mockReturnValueOnce(query([{ id: "salary", name: "Salary", netPayCents: 30000,
      scheduleKind: "weekly", paydayAnchor: "2026-10-23", isEnabled: true }]))
    .mockReturnValueOnce(query([])).mockReturnValueOnce(query([]))
    .mockReturnValueOnce(query([{ id: "bill", billId: "internet", name: "Internet", dueDate: "2026-10-20",
      originalDueDate: null, amountDue: 12000, amount: 12000, status: "upcoming", gracePeriodDays: 6,
      isAutoPay: false, frequency: "monthly", dueDayOfMonth: 20, occurrenceLimit: null }]));
}

const request = (extra = "") => new NextRequest(`http://localhost/api/runway/forecast?reference_date=2026-10-18&horizon_days=10${extra}`);

beforeEach(() => { vi.resetAllMocks(); mocks.requireOwner.mockResolvedValue({ id: 1 }); });

describe("payment plan forecast options", () => {
  it("requires authentication before reading financial data", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    expect((await GET(request("&payment_plan=true"))).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(["&payment_plan=maybe", "&payment_plan=true&use_grace_periods=1"])("validates options %s", async extra => {
    expect((await GET(request(extra))).status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("keeps the original forecast response when a plan is not requested", async () => {
    fixtures();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("payment_plan");
  });

  it("includes calculated comparisons only with explicit grace opt-in", async () => {
    fixtures();
    const response = await GET(request("&payment_plan=true&use_grace_periods=true"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.shortfall_date).toBe("2026-10-20");
    expect(data.payment_plan.scenarios.find((item: { id: string }) => item.id === "grace"))
      .toMatchObject({ shortfall_date: null, changes: [{ payment_date: "2026-10-25" }] });
    expect(mocks.select).toHaveBeenCalledTimes(6);
  });
});
