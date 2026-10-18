import { describe, expect, it } from "vitest";
import { calculatePaymentPlan } from "../src/lib/payment-plan";
import type { calculateRunwayForecast } from "../src/lib/runway";

const params: Parameters<typeof calculateRunwayForecast>[0] = {
  currentLiquidCash: 10000, expectedSalaryAmount: 30000, dailyDiscretionaryBurn: 1000,
  payScheduleKind: "weekly", biweeklyPaydayAnchor: "2026-10-23",
  referenceDate: new Date("2026-10-18T00:00:00"), horizonDays: 10,
  bills: [{ id: "bill", name: "Internet", dueDate: "2026-10-20", amountDue: 12000,
    status: "upcoming", gracePeriodDays: 6, isAutoPay: false, originalDueDate: null }],
};

describe("bill payment planning", () => {
  it("keeps grace periods opt-in and calculates the smallest daily spending cut", () => {
    const plan = calculatePaymentPlan({ ...params, bills: [], currentLiquidCash: 2000 });
    expect(plan.scenarios.map(item => item.id)).toEqual(["current", "spending"]);
    const reduced = plan.scenarios[1];
    expect(reduced.daily_spending_cents).toBe(400);
    expect(reduced.minimum_balance_cents).toBe(0);
    expect(reduced.shortfall_date).toBeNull();
  });

  it("compares grace timing without changing obligations, income, or the input", () => {
    const before = structuredClone(params);
    const plan = calculatePaymentPlan(params, true);
    const current = plan.scenarios.find(item => item.id === "current")!;
    const grace = plan.scenarios.find(item => item.id === "grace")!;
    expect(current.shortfall_date).toBe("2026-10-20");
    expect(grace.shortfall_date).toBeNull();
    expect(grace.changes).toEqual([{ id: "bill", name: "Internet", amount_cents: 12000,
      due_date: "2026-10-20", payment_date: "2026-10-25", grace_end_date: "2026-10-26" }]);
    expect(grace.timeline.at(-1)?.balance).toBe(current.timeline.at(-1)?.balance);
    expect(grace.timeline.reduce((sum, day) => sum + day.outflow, 0))
      .toBe(current.timeline.reduce((sum, day) => sum + day.outflow, 0));
    expect(params).toEqual(before);
  });

  it.each([
    { isAutoPay: true }, { status: "paid" }, { status: "auto_debited" }, { status: "skipped" },
    { gracePeriodDays: 0 }, { gracePeriodDays: 1 }, { gracePeriodDays: -1 },
    { dueDate: "2026-10-10" }, { originalDueDate: "2026-10-10" },
  ])("does not move ineligible bills: %j", (overrides) => {
    const plan = calculatePaymentPlan({ ...params, bills: [{ ...params.bills[0], ...overrides }] }, true);
    expect(plan.scenarios.find(item => item.id === "grace")!.changes).toEqual([]);
  });

  it("keeps payments inside the horizon and preserves the original grace deadline", () => {
    const plan = calculatePaymentPlan({ ...params, bills: [{ ...params.bills[0],
      originalDueDate: "2026-10-19", gracePeriodDays: 30 }] }, true);
    const change = plan.scenarios.find(item => item.id === "grace")!.changes[0];
    expect(change.payment_date).toBe("2026-10-27");
    expect(change.grace_end_date).toBe("2026-11-18");
  });

  it("reports when eliminating discretionary spending cannot cover fixed obligations", () => {
    const plan = calculatePaymentPlan(params);
    const reduced = plan.scenarios.find(item => item.id === "spending")!;
    expect(reduced.daily_spending_cents).toBe(0);
    expect(reduced.shortfall_date).toBe("2026-10-20");
    expect(reduced.minimum_balance_cents).toBeLessThan(0);
  });

  it("does not invent a spending cut when the current plan already stays above zero", () => {
    const plan = calculatePaymentPlan({ ...params, currentLiquidCash: 100000 });
    expect(plan.scenarios[1].daily_spending_cents).toBe(1000);
  });

  it("combines grace timing and cuts even when timing alone cannot improve the overall minimum", () => {
    const plan = calculatePaymentPlan({ ...params, bills: [...params.bills,
      { id: "fixed", name: "Rent", dueDate: "2026-10-27", amountDue: 28000, status: "upcoming" }] }, true);
    const current = plan.scenarios.find(item => item.id === "current")!;
    const grace = plan.scenarios.find(item => item.id === "grace")!;
    const spending = plan.scenarios.find(item => item.id === "spending")!;
    const combined = plan.scenarios.find(item => item.id === "combined")!;
    expect(grace.minimum_balance_cents).toBe(current.minimum_balance_cents);
    expect(spending.shortfall_date).not.toBeNull();
    expect(combined.shortfall_date).toBeNull();
    expect(combined.minimum_balance_cents).toBe(0);
    expect(combined.changes).toHaveLength(1);
  });

  it("retains planned budgets and excludes already-posted paychecks in every scenario", () => {
    const plan = calculatePaymentPlan({ ...params, bills: [], currentLiquidCash: 2000,
      incomeStreams: [{ id: "salary", name: "Salary", netPayCents: 30000, isEnabled: true,
        scheduleKind: "weekly", paydayAnchor: "2026-10-23" }],
      paycheckOccurrences: [{ id: "posted", incomeStreamId: "salary", kind: "scheduled", dueDate: "2026-10-23",
        retryDate: null, amountCents: 30000, transactionId: "transaction", status: "posted", parentOccurrenceId: null }],
      plannedBudgets: [{ id: "food", name: "Groceries", amountCents: 3000, startDate: "2026-10-21", cadence: "once" }],
    }, true);
    expect(plan.scenarios.every(item => item.shortfall_date !== null)).toBe(true);
    expect(plan.scenarios.every(item => item.timeline.every(day => day.inflow === 0))).toBe(true);
  });
});
