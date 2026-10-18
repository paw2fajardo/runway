import { describe, expect, it } from "vitest";
import { calculatePurchaseScenarios } from "../src/lib/purchase-scenarios";

const params = { currentLiquidCash: 10000, expectedSalaryAmount: 30000, dailyDiscretionaryBurn: 1000,
  payScheduleKind: "weekly", biweeklyPaydayAnchor: "2026-10-23", referenceDate: new Date("2026-10-18T00:00:00"),
  horizonDays: 10, bills: [] };

describe("recalculated purchase scenarios", () => {
  it("recalculates daily timing instead of subtracting only from a summary buffer", () => {
    const before = structuredClone(params);
    const result = calculatePurchaseScenarios(params, 8000);
    expect(result.now.shortfall_date).toBe("2026-10-20");
    expect(result.after_payday?.shortfall_date).toBeNull();
    expect(result.now.timeline.at(-1)?.balance).toBe(result.after_payday?.timeline.at(-1)?.balance);
    expect(params).toEqual(before);
  });
  it("does not invent a payday outside the selected horizon", () => {
    expect(calculatePurchaseScenarios({ ...params, horizonDays: 3 }, 8000).after_payday).toBeNull();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe amount %s", value => {
    expect(() => calculatePurchaseScenarios(params, value)).toThrow();
  });
});
