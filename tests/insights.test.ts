import { describe, expect, it } from "vitest";
import { compareForecasts, merchantKey, reconciliationInsights, recurringInsights, spendingInsights, variableBillEstimates, type InsightExpense } from "../src/lib/insights";
import { calculateRunwayForecast } from "../src/lib/runway";

const expense = (id: string, date: string, amount: number, description = "Netflix"): InsightExpense => ({
  id, date, timestamp: Date.parse(`${date}T12:00:00+08:00`), amount, description,
  accountId: "checking", billPayment: false, categories: [{ id: "food", name: "Food", amount }],
});

describe("spending insights", () => {
  it("compares civil-date weeks and keeps unexplained balance changes separate", () => {
    const weekly = spendingInsights([expense("old", "2026-10-11", 1000), expense("new", "2026-10-18", 1500),
      { ...expense("unknown", "2026-10-12", 500), categories: [] }, expense("future", "2026-10-19", 9999)],
      [{ id: "cp", accountId: "checking", date: "2026-10-18", timestamp: 1, discrepancy: -600 }], "2026-10-18");
    expect(weekly).toMatchObject({ current_cents: 2000, previous_cents: 1000, change_cents: 1000,
      unclassified_cents: 500, unexplained_decreases_cents: 600 });
    expect(weekly.categories.find(item => item.name === "Food")).toMatchObject({ current: 1500, change_cents: 500, transaction_ids: ["new"] });
  });
  it("counts split categories once and rejects corrupt allocations", () => {
    const row = { ...expense("split", "2026-10-18", 1000), categories: [
      { id: "food", name: "Food", amount: 700 }, { id: "fees", name: "Fees", amount: 100 }] };
    expect(spendingInsights([row], [], "2026-10-18").unclassified_cents).toBe(200);
    expect(() => spendingInsights([{ ...row, amount: 100 }], [], "2026-10-18")).toThrow();
  });
  it("requires three regularly spaced charges and separates paying accounts", () => {
    const rows = [expense("a", "2026-08-01", 500), expense("b", "2026-09-01", 500), expense("c", "2026-10-01", 600)];
    const result = recurringInsights(rows);
    expect(result.recurring[0]).toMatchObject({ cadence: "monthly", increase_cents: 100, transaction_ids: ["a", "b", "c"] });
    expect(recurringInsights(rows.slice(1)).recurring).toEqual([]);
    expect(recurringInsights(rows.map((row, index) => ({ ...row, accountId: String(index) }))).recurring).toEqual([]);
    expect(recurringInsights(rows.map(row => ({ ...row, billPayment: true }))).recurring).toEqual([]);
  });
  it("flags possible duplicates without inventing recurring cycles or deleting records", () => {
    const rows = [expense("a", "2026-10-18", 500), { ...expense("b", "2026-10-18", 500), timestamp: Date.parse("2026-10-18T12:05:00+08:00") }];
    expect(recurringInsights(rows)).toMatchObject({ recurring: [], duplicates: [{ transaction_ids: ["a", "b"] }] });
    expect(rows).toHaveLength(2);
    expect(merchantKey("  NETFLIX! ")).toBe("netflix");
  });
  it("uses actual paid bill samples, a median, and an observed range", () => {
    const result = variableBillEstimates([{ id: "utility", name: "Power", isVariable: true,
      samples: [{ date: "2026-08-01", amount: 100 }, { date: "2026-09-01", amount: 500 }, { date: "2026-10-01", amount: 300 }] }]);
    expect(result[0]).toMatchObject({ sample_count: 3, estimate_cents: 300, low_cents: 100, high_cents: 500 });
    expect(variableBillEstimates([{ id: "new", name: "New", isVariable: true, samples: [] }])[0].estimate_cents).toBeNull();
    expect(variableBillEstimates([{ id: "even", name: "Even", isVariable: true, samples: [100, 200, 300, 400]
      .map((amount, index) => ({ date: `2026-0${index + 1}-01`, amount })) }])[0].estimate_cents).toBe(250);
  });
  it("matches only evidence from the same account, direction, amount and checkpoint period", () => {
    const checkpoints = [ { id: "old", accountId: "checking", date: "2026-10-10", timestamp: 10, discrepancy: 0 },
      { id: "new", accountId: "checking", date: "2026-10-18", timestamp: 18, discrepancy: -500 } ];
    const evidence = [{ id: "match", accountId: "checking", date: "2026-10-12", amount: 500, type: "expense", description: "Lunch" },
      { id: "other", accountId: "other", date: "2026-10-12", amount: 500, type: "expense", description: "Wrong" }];
    expect(reconciliationInsights(checkpoints, evidence)[0].candidates.map(item => item.id)).toEqual(["match"]);
    expect(reconciliationInsights([...checkpoints, { ...checkpoints[1], id: "cleared", timestamp: 20, discrepancy: 0 }], evidence)).toEqual([]);
  });
  it("compares only overlapping forecast dates and reports exact component changes", () => {
    const params = { currentLiquidCash: 10000, expectedSalaryAmount: 1000, dailyDiscretionaryBurn: 0,
      bills: [], referenceDate: new Date("2026-10-18T00:00:00"), horizonDays: 3 };
    const previous = calculateRunwayForecast(params);
    const current = calculateRunwayForecast({ ...params, currentLiquidCash: 9000 });
    expect(compareForecasts(previous, current).changed_days).toHaveLength(3);
    expect(compareForecasts(previous, current).metrics[0].change_cents).toBe(-1000);
    expect(compareForecasts(previous, { ...current, timeline: [] }).overlapping_days).toBe(0);
  });

  it("explains named bill amount, date and settlement changes from saved inputs", () => {
    const forecast = calculateRunwayForecast({ currentLiquidCash: 10000, expectedSalaryAmount: 1000,
      dailyDiscretionaryBurn: 0, bills: [], referenceDate: new Date("2026-10-18T00:00:00") });
    const bill = { key: "power:2026-10-20", name: "Power", due_date: "2026-10-20", amount_cents: 1000, status: "upcoming" };
    const comparison = compareForecasts({ ...forecast, comparison_bills: [bill] },
      { ...forecast, comparison_bills: [{ ...bill, due_date: "2026-10-22", amount_cents: 2000, status: "paid" }] });
    expect(comparison.bill_changes[0]).toMatchObject({ name: "Power", before: { amount_cents: 1000 }, after: { amount_cents: 2000, due_date: "2026-10-22", status: "paid" } });
  });
});
