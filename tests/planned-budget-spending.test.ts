import { describe, expect, it } from "vitest";
import { plannedBudgetDates, remainingBudgetReserve } from "../src/lib/planned-budgets";
import { calculateRunwayForecast } from "../src/lib/runway";

describe("planned budget occurrences", () => {
  const budget = { id: "groceries", name: "Groceries", amountCents: 10000, startDate: "2026-12-25", cadence: "biweekly" as const };
  it("anchors occurrences across year boundaries and validates explicit dates", () => {
    expect(plannedBudgetDates(budget, "2027-02-01")).toEqual(["2026-12-25", "2027-01-08", "2027-01-22"]);
    expect(plannedBudgetDates(budget, "2027-01-09", "2027-01-09")).toEqual([]);
    expect(plannedBudgetDates(budget, "2026-12-24")).toEqual([]);
  });
  it.each([[4000, false, 6000], [12000, false, 0], [4000, true, 0]])("reserves remaining spend %i, finished %s", (amountCents, isFinished, expected) => {
    const spending = [{ budgetId: budget.id, occurrenceDate: budget.startDate, amountCents, isFinished }];
    expect(remainingBudgetReserve(10000, spending, budget.id, budget.startDate)).toBe(expected);
    expect(remainingBudgetReserve(10000, spending, budget.id, "2027-01-08")).toBe(10000);
  });
  it("uses current cash once and only the current unfinished cycle plus future reserves", () => {
    const result = calculateRunwayForecast({ currentLiquidCash: 96000, expectedSalaryAmount: 100000, dailyDiscretionaryBurn: 0, bills: [],
      payScheduleKind: "monthly", biweeklyPaydayAnchor: "2027-01-31", plannedBudgets: [budget],
      plannedBudgetSpending: [{ budgetId: budget.id, occurrenceDate: "2027-01-08", amountCents: 4000, isFinished: false }],
      referenceDate: new Date(2027, 0, 10), horizonDays: 14 });
    expect(result.current_liquid_cash).toBe(96000);
    expect(result.timeline[0].outflow).toBe(6000);
    expect(result.planned_spending_total).toBe(16000);
    expect(result.timeline.find(day => day.date === "2027-01-22")?.outflow).toBe(10000);
  });
  it("does not carry previous cycles onto the next occurrence", () => {
    const result = calculateRunwayForecast({ currentLiquidCash: 100000, expectedSalaryAmount: 100000, dailyDiscretionaryBurn: 0, bills: [],
      plannedBudgets: [budget], referenceDate: new Date(2027, 0, 8), horizonDays: 1 });
    expect(result.timeline[0].outflow).toBe(10000);
  });
});
