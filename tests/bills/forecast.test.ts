import { describe, expect, it } from "vitest";
import { projectBillOccurrences } from "../../src/lib/bills/forecast";

const bill = { id: "october", billId: "monthly", name: "Monthly bill", dueDate: "2026-10-22",
  originalDueDate: null, amountDue: 6000, amount: 5000, status: "upcoming", gracePeriodDays: 0,
  frequency: "monthly", dueDayOfMonth: 22, occurrenceLimit: null as number | null };

describe("bill forecast occurrences", () => {
  it("projects through the inclusive end date using the bill's recurring estimate", () => {
    const input = [bill];
    const before = structuredClone(input);
    expect(projectBillOccurrences(input, "2026-12-22").map(item => [item.dueDate, item.amountDue])).toEqual([
      ["2026-10-22", 6000], ["2026-11-22", 5000], ["2026-12-22", 5000],
    ]);
    expect(projectBillOccurrences(input, "2026-12-21")).toHaveLength(2);
    expect(input).toEqual(before);
  });

  it("keeps saved history and counts paid and skipped occurrences toward the limit", () => {
    const input = [{ ...bill, status: "paid", occurrenceLimit: 3 },
      { ...bill, id: "november", dueDate: "2026-11-22", status: "skipped", occurrenceLimit: 3 }];
    const result = projectBillOccurrences(input.reverse(), "2027-02-22");
    expect(result.slice(0, 2)).toEqual(input);
    expect(result.slice(2)).toMatchObject([{ dueDate: "2026-12-22", status: "upcoming" }]);
    expect(result).toHaveLength(3);
    expect(projectBillOccurrences([{ ...bill, occurrenceLimit: 1 }], "2027-02-22")).toEqual([{ ...bill, occurrenceLimit: 1 }]);
  });

  it("preserves a moved date while keeping the original recurrence anchor", () => {
    const moved = { ...bill, originalDueDate: "2026-10-22", dueDate: "2026-12-25" };
    expect(projectBillOccurrences([moved], "2026-12-22").map(item => item.dueDate)).toEqual([
      "2026-12-25", "2026-11-22", "2026-12-22",
    ]);
  });

  it("does not duplicate saved future occurrences or restart a moved older occurrence", () => {
    const input = [{ ...bill, id: "november", dueDate: "2026-11-22", amountDue: 7000 },
      { ...bill, originalDueDate: "2026-10-22", dueDate: "2027-01-01" }];
    expect(projectBillOccurrences(input, "2026-12-22").map(item => [item.dueDate, item.amountDue])).toEqual([
      ["2026-11-22", 7000], ["2027-01-01", 6000], ["2026-12-22", 5000],
    ]);
  });

  it.each([
    ["weekly", "2026-11-05", ["2026-10-22", "2026-10-29", "2026-11-05"]],
    ["biweekly", "2026-11-19", ["2026-10-22", "2026-11-05", "2026-11-19"]],
    ["every_2_months", "2027-02-22", ["2026-10-22", "2026-12-22", "2027-02-22"]],
    ["every_3_months", "2027-01-22", ["2026-10-22", "2027-01-22"]],
    ["every_6_months", "2027-04-22", ["2026-10-22", "2027-04-22"]],
    ["annually", "2027-10-22", ["2026-10-22", "2027-10-22"]],
  ])("uses the existing %s schedule", (frequency, through, dates) => {
    expect(projectBillOccurrences([{ ...bill, frequency }], through).map(item => item.dueDate)).toEqual(dates);
  });

  it("clamps month-end dates without drifting and keeps bills separate", () => {
    const input = [{ ...bill, dueDate: "2028-01-31", dueDayOfMonth: 31 },
      { ...bill, billId: "other", dueDate: "2028-03-22" }];
    expect(projectBillOccurrences(input, "2028-03-31").map(item => item.dueDate)).toEqual([
      "2028-01-31", "2028-03-22", "2028-02-29", "2028-03-31",
    ]);
    expect(projectBillOccurrences([], "2026-12-22")).toEqual([]);
  });
});
