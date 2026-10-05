import { describe, expect, it } from "vitest";
import { calculateRunwayForecast, type ForecastPaycheckOccurrence } from "../../src/lib/runway";

const stream = { id: "stream-1", name: "Salary", netPayCents: 100_000, scheduleKind: "weekly",
  paydayAnchor: "2027-01-01", isEnabled: true };

function occurrence(overrides: Partial<ForecastPaycheckOccurrence> = {}): ForecastPaycheckOccurrence {
  return {
    id: "scheduled-1", incomeStreamId: stream.id, kind: "scheduled", dueDate: "2027-01-01",
    retryDate: null, amountCents: 100_000, transactionId: null, status: "pending_confirmation",
    parentOccurrenceId: null, parentStatus: null, ...overrides,
  };
}

function forecast(paycheckOccurrences: ForecastPaycheckOccurrence[] = [], horizonDays = 8) {
  return calculateRunwayForecast({ currentLiquidCash: 500_000, expectedSalaryAmount: 0,
    dailyDiscretionaryBurn: 0, bills: [], incomeStreams: [stream], paycheckOccurrences,
    referenceDate: new Date(2027, 0, 1), horizonDays });
}

describe("payday forecast occurrences", () => {
  it("does not forecast a posted scheduled paycheck again on its posting date", () => {
    const result = forecast([occurrence({ transactionId: "transaction-1" })]);

    expect(result.timeline[0]).toMatchObject({ date: "2027-01-01", inflow: 0, isPayday: false });
    expect(result.confirmed_inflows).toBe(100_000);
    expect(result.timeline[7]).toMatchObject({ date: "2027-01-08", inflow: 100_000, isPayday: true });
  });

  it("keeps a normal unposted scheduled paycheck in the projection", () => {
    const result = forecast([occurrence()]);

    expect(result.timeline[0]).toMatchObject({ inflow: 100_000, isPayday: true, incomeDescription: ["Salary"] });
    expect(result.confirmed_inflows).toBe(200_000);
  });

  it("excludes a reversed scheduled paycheck and forecasts its unposted retry once", () => {
    const parent = occurrence({ status: "reversed_awaiting_retry", transactionId: "original-credit" });
    const retry = occurrence({ id: "retry-1", kind: "retry", dueDate: "2027-01-03", retryDate: "2027-01-03",
      transactionId: null, parentOccurrenceId: parent.id, parentStatus: parent.status });
    const result = forecast([parent, retry], 4);

    expect(result.timeline[0]).toMatchObject({ inflow: 0, isPayday: false });
    expect(result.timeline[2]).toMatchObject({ inflow: 100_000, isPayday: true, incomeDescription: ["Salary retry"] });
    expect(result.confirmed_inflows).toBe(100_000);
  });

  it("projects a retry and the regular paycheck separately when they share a date", () => {
    const parent = occurrence({ status: "reversed_awaiting_retry", transactionId: "original-credit" });
    const retry = occurrence({ id: "retry-1", kind: "retry", dueDate: "2027-01-08", retryDate: "2027-01-08",
      transactionId: null, parentOccurrenceId: parent.id, parentStatus: parent.status });
    const result = forecast([parent, retry], 8);

    expect(result.timeline[7]).toMatchObject({ inflow: 200_000, isPayday: true,
      incomeDescription: ["Salary", "Salary retry"] });
    expect(result.confirmed_inflows).toBe(200_000);
  });

  it("does not forecast an already posted retry", () => {
    const parent = occurrence({ status: "reversed_awaiting_retry", transactionId: "original-credit" });
    const retry = occurrence({ id: "retry-1", kind: "retry", dueDate: "2027-01-03", retryDate: "2027-01-03",
      transactionId: "retry-credit", parentOccurrenceId: parent.id, parentStatus: parent.status });
    const result = forecast([parent, retry], 4);

    expect(result.timeline[2]).toMatchObject({ inflow: 0, isPayday: false });
    expect(result.confirmed_inflows).toBe(0);
  });
});
