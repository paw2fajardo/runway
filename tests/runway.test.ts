import { describe, it, expect } from "vitest";
import { calculateRunwayForecast, getNextPaydayDate, getScheduledPayDatesThrough } from "../src/lib/runway";

describe("Predictive Cash Runway & Forward Solvency Engine", () => {
  const mockBills = [
    {
      id: "1",
      name: "Meralco Electricity",
      dueDate: "2026-10-06",
      amountDue: 285000, // ₱2,850.00
      status: "grace_period",
      gracePeriodDays: 7,
    },
    {
      id: "2",
      name: "PLDT Home Fiber",
      dueDate: "2026-10-08",
      amountDue: 189900, // ₱1,899.00
      status: "upcoming",
      gracePeriodDays: 3,
    },
    {
      id: "3",
      name: "Netflix Standard",
      dueDate: "2026-10-10",
      amountDue: 54900, // ₱549.00
      status: "upcoming",
    },
  ];

  it("calculates forward solvency and safe-to-spend buffer correctly when solvent", () => {
    const forecast = calculateRunwayForecast({
      currentLiquidCash: 2200000, // ₱22,000.00
      salaryCycleDays: "15,30",
      expectedSalaryAmount: 3000000, // ₱30,000.00
      dailyDiscretionaryBurn: 85000, // ₱850.00/day
      bills: mockBills,
      referenceDate: new Date("2026-10-03"),
      horizonDays: 14,
    });

    expect(forecast.is_solvent).toBe(true);
    expect(forecast.shortfall_date).toBeNull();
    expect(forecast.shortfall_amount).toBe(0);
    expect(forecast.current_liquid_cash).toBe(2200000);
    expect(forecast.scheduled_bills_total).toBe(285000 + 189900 + 54900);
    expect(forecast.net_projected_buffer).toBeGreaterThan(0);
    expect(forecast.timeline).toHaveLength(14);
  });

  it("identifies exact shortfall date and deficit amount when liquid cash is insufficient", () => {
    // Insufficient liquid cash: ₱3,000.00 vs dues of > ₱5,000.00
    const forecast = calculateRunwayForecast({
      currentLiquidCash: 300000, // ₱3,000.00
      salaryCycleDays: "15,30",
      expectedSalaryAmount: 3000000,
      dailyDiscretionaryBurn: 100000, // ₱1,000.00/day
      bills: mockBills,
      referenceDate: new Date("2026-10-03"),
      horizonDays: 14,
    });

    expect(forecast.is_solvent).toBe(false);
    expect(forecast.shortfall_date).not.toBeNull();
    expect(forecast.shortfall_amount).toBeGreaterThan(0);
  });

  it("recognizes bimonthly payday dates (15th and 30th) in the timeline", () => {
    const forecast = calculateRunwayForecast({
      currentLiquidCash: 2200000,
      salaryCycleDays: "15,30",
      expectedSalaryAmount: 3000000,
      dailyDiscretionaryBurn: 50000,
      bills: mockBills,
      referenceDate: new Date("2026-10-03"),
      horizonDays: 14,
    });

    const payday = forecast.timeline.find((t) => t.isPayday);
    expect(payday).toBeDefined();
    expect(payday?.date).toBe("2026-10-15");
    expect(payday?.inflow).toBe(3000000);
  });
});

describe("Biweekly take-home pay", () => {
  const calculate = (anchor: string, date: Date, horizonDays = 40) => calculateRunwayForecast({
    currentLiquidCash: 100000, expectedSalaryAmount: 123456,
    dailyDiscretionaryBurn: 100, bills: [], biweeklyPaydayAnchor: anchor,
    referenceDate: date, horizonDays,
  });

  it("rolls past anchors forward and repeats every fourteen days across years", () => {
    const forecast = calculate("2026-12-18", new Date(2026, 11, 30));
    expect(forecast.next_payday_date).toBe("2027-01-01");
    expect(forecast.days_to_payday).toBe(2);
    expect(forecast.timeline.filter(day => day.isPayday).map(day => day.date)).toEqual(["2027-01-01", "2027-01-15", "2027-01-29"]);
    expect(forecast.confirmed_inflows).toBe(123456 * 3);
    expect(forecast.current_liquid_cash).toBe(100000);
  });

  it("includes same-day payday without division by zero", () => {
    const forecast = calculate("2026-10-03", new Date(2026, 9, 3), 1);
    expect(forecast.next_payday_date).toBe("2026-10-03");
    expect(forecast.days_to_payday).toBe(0);
    expect(forecast.timeline[0].inflow).toBe(123456);
    expect(Number.isFinite(forecast.daily_allowance)).toBe(true);
  });

  it("does not create paydays before a future anchor", () => {
    const forecast = calculate("2026-11-20", new Date(2026, 10, 1), 14);
    expect(forecast.next_payday_date).toBe("2026-11-20");
    expect(forecast.confirmed_inflows).toBe(0);
  });

  it("uses calendar days over leap day and daylight-saving changes", () => {
    expect(calculate("2028-02-16", new Date(2028, 1, 28)).next_payday_date).toBe("2028-03-01");
    const forecast = calculate("2026-03-01", new Date(2026, 2, 8));
    expect(forecast.days_to_payday).toBe(7);
    expect(forecast.timeline.filter(day => day.isPayday).map(day => day.date)).toEqual(["2026-03-15", "2026-03-29", "2026-04-12"]);
  });
});

describe("Configurable pay recurrence", () => {
  it("enumerates every missed recurring payday through today", () => {
    expect(getScheduledPayDatesThrough("2026-10-18", "15,30", "2026-10-02", "weekly")).toEqual([
      "2026-10-02", "2026-10-09", "2026-10-16",
    ]);
    expect(getScheduledPayDatesThrough("2026-10-18", "15,30", "2026-10-02", "weekly", null, "2026-10-10")).toEqual(["2026-10-16"]);
    expect(getScheduledPayDatesThrough("2026-10-18", "15,30", null, null, null, "2026-10-12")).toEqual(["2026-10-15"]);
  });

  it("does not count income already credited to its account balance again", () => {
    const forecast = calculateRunwayForecast({
      currentLiquidCash: 1500000,
      expectedSalaryAmount: 500000,
      dailyDiscretionaryBurn: 0,
      bills: [],
      incomeStreams: [{ id: "stream-1", name: "Salary", netPayCents: 500000, scheduleKind: "weekly", paydayAnchor: "2026-10-02", intervalDays: null, salaryCycleDays: "15,30", isEnabled: true }],
      depositedIncomeOccurrences: [{ incomeStreamId: "stream-1", scheduledDate: "2026-10-02" }],
      referenceDate: new Date(2026, 9, 2),
      horizonDays: 1,
    });
    expect(forecast.current_liquid_cash).toBe(1500000);
    expect(forecast.timeline[0].inflow).toBe(0);
    expect(forecast.timeline[0].balance).toBe(1500000);
  });
  const forecast = (kind: string, anchor: string, reference: Date, interval?: number, horizonDays = 100) => calculateRunwayForecast({
    currentLiquidCash: 100000, expectedSalaryAmount: 10000, dailyDiscretionaryBurn: 100, bills: [],
    payScheduleKind: kind, biweeklyPaydayAnchor: anchor, payIntervalDays: interval, referenceDate: reference, horizonDays,
  });
  it.each([["weekly", 7], ["biweekly", 14], ["custom", 10]])("repeats %s on civil days", (kind, days) => {
    const result = forecast(kind as string, "2026-12-30", new Date(2026, 11, 30), kind === "custom" ? days as number : undefined, 31);
    expect(result.days_to_payday).toBe(0);
    const paydays = result.timeline.filter(day => day.isPayday);
    expect(paydays.length).toBe(Math.ceil(31 / (days as number)));
    expect(result.confirmed_inflows).toBe(paydays.length * 10000);
  });
  it("clamps monthly payday then restores the original day", () => {
    const result = forecast("monthly", "2027-01-31", new Date(2027, 1, 1));
    expect(result.next_payday_date).toBe("2027-02-28");
    expect(result.timeline.filter(day => day.isPayday).map(day => day.date)).toEqual(["2027-02-28", "2027-03-31", "2027-04-30"]);
  });
  it("keeps leap-day and same-day monthly recurrence coherent", () => {
    const result = forecast("monthly", "2028-01-31", new Date(2028, 1, 29), undefined, 32);
    expect(result.next_payday_date).toBe("2028-02-29");
    expect(result.days_to_payday).toBe(0);
    expect(result.timeline.filter(day => day.isPayday).map(day => day.date)).toEqual(["2028-02-29", "2028-03-31"]);
    expect(getNextPaydayDate(new Date(2028, 2, 1), "15,30", "2028-01-31", "monthly")).toBe("2028-03-31");
  });
  it.each(["weekly", "monthly", "custom"])("does not generate %s income before its future anchor", kind => {
    const result = forecast(kind, "2026-11-20", new Date(2026, 10, 1), kind === "custom" ? 3 : undefined, 14);
    expect(result.next_payday_date).toBe("2026-11-20");
    expect(result.confirmed_inflows).toBe(0);
  });
  it("keeps custom intervals stable across daylight-saving calendar dates", () => {
    const result = forecast("custom", "2026-03-01", new Date(2026, 2, 8), 10, 25);
    expect(result.next_payday_date).toBe("2026-03-11");
    expect(result.days_to_payday).toBe(3);
    expect(result.timeline.filter(day => day.isPayday).map(day => day.date)).toEqual(["2026-03-11", "2026-03-21", "2026-03-31"]);
  });
  it("rejects corrupt stored schedule kinds instead of guessing", () => {
    expect(() => forecast("unknown", "2026-01-01", new Date(2026, 0, 1))).toThrow();
  });
});

describe("Several income streams", () => {
  const stream = (name: string, amount: number, kind = "weekly", anchor = "2027-01-01", enabled = true) => ({ name, netPayCents: amount, scheduleKind: kind, paydayAnchor: anchor, isEnabled: enabled });
  const calculate = (streams: ReturnType<typeof stream>[], horizonDays = 31) => calculateRunwayForecast({
    currentLiquidCash: 100000, expectedSalaryAmount: 999999, dailyDiscretionaryBurn: 100, bills: [],
    incomeStreams: streams, referenceDate: new Date(2027, 0, 1), horizonDays,
  });
  it("sums same-day income and applies daily burn once", () => {
    const result = calculate([stream("Job", 10000), stream("Rental", 20000, "monthly")]);
    expect(result.timeline[0]).toMatchObject({ inflow: 30000, outflow: 100, balance: 129900, incomeDescription: ["Job", "Rental"] });
    expect(result.confirmed_inflows).toBe(70000);
  });
  it("uses the earliest enabled stream for pre-income budgeting", () => {
    const result = calculate([stream("Job", 10000, "biweekly", "2027-01-10"), stream("Rental", 20000, "monthly", "2027-01-04"), stream("Paused", 50000, "weekly", "2027-01-01", false)]);
    expect(result.next_payday_date).toBe("2027-01-04");
    expect(result.days_to_payday).toBe(3);
    expect(result.discretionary_burn_total).toBe(300);
    expect(result.timeline[0].inflow).toBe(0);
  });
  it("does not fall back to obsolete salary when every stream is disabled or absent", () => {
    expect(() => calculate([])).toThrow("No enabled income streams");
    expect(() => calculate([stream("Paused", 10000, "weekly", "2027-01-01", false)])).toThrow("No enabled income streams");
  });
  it("rejects same-day and horizon aggregate overflow", () => {
    expect(() => calculate([stream("A", Number.MAX_SAFE_INTEGER), stream("B", 1)])).toThrow("safe integer");
    expect(() => calculate([stream("A", Number.MAX_SAFE_INTEGER / 2 + 0.5)], 31)).toThrow("safe integer");
    const amount = Math.floor(Number.MAX_SAFE_INTEGER / 2);
    expect(() => calculateRunwayForecast({ currentLiquidCash: 0, expectedSalaryAmount: 0, dailyDiscretionaryBurn: amount, bills: [],
      incomeStreams: [{ ...stream("Daily", amount, "custom"), intervalDays: 1 }], referenceDate: new Date(2027, 0, 1), horizonDays: 3 })).toThrow("safe integer");
  });
  it("keeps monthly anchor recovery alongside a weekly stream", () => {
    const result = calculateRunwayForecast({ currentLiquidCash: 100000, expectedSalaryAmount: 0, dailyDiscretionaryBurn: 0, bills: [],
      incomeStreams: [stream("Rental", 1000, "monthly", "2027-01-31"), stream("Job", 1000)], referenceDate: new Date(2027, 1, 1), horizonDays: 60 });
    expect(result.timeline.filter(day => day.incomeDescription?.includes("Rental")).map(day => day.date)).toEqual(["2027-02-28", "2027-03-31"]);
  });
});
