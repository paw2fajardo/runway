import { describe, expect, it } from "vitest";
import { getDuePaydayOccurrences, paydayDueAt, type PaydaySchedule } from "../../src/lib/payday/schedule";

const utc = (value: string) => new Date(value);
const dates = (schedule: PaydaySchedule, now: string, afterDate?: string) =>
  getDuePaydayOccurrences(schedule, utc(now), afterDate).map(({ dueDate }) => dueDate);

describe("payday due schedule", () => {
  it("uses the 09:00 Manila boundary and does not include a future due time", () => {
    const schedule: PaydaySchedule = { scheduleKind: "weekly", anchorDate: "2026-10-05" };
    expect(dates(schedule, "2026-10-12T00:59:59.999Z")).toEqual(["2026-10-05"]); // 08:59:59.999 Manila
    expect(dates(schedule, "2026-10-12T01:00:00.000Z")).toEqual(["2026-10-05", "2026-10-12"]);
    expect(dates(schedule, "2026-10-12T01:00:00.001Z")).toEqual(["2026-10-05", "2026-10-12"]);
    expect(paydayDueAt({ kind: "retry", retryDate: "2026-10-12" }).toISOString()).toBe("2026-10-12T01:00:00.000Z");
  });

  it("catches up overdue occurrences and excludes future occurrences", () => {
    const schedule: PaydaySchedule = { scheduleKind: "weekly", anchorDate: "2026-10-05" };
    expect(dates(schedule, "2026-10-19T00:59:59Z")).toEqual(["2026-10-05", "2026-10-12"]);
    expect(dates(schedule, "2026-10-19T01:00:00Z")).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(dates(schedule, "2026-10-19T02:00:00Z", "2026-10-12")).toEqual(["2026-10-19"]);
  });

  it("calculates weekly, biweekly, and custom intervals from their anchor", () => {
    expect(dates({ scheduleKind: "weekly", anchorDate: "2026-10-05" }, "2026-10-26T01:00:00Z")).toEqual([
      "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26",
    ]);
    expect(dates({ scheduleKind: "biweekly", anchorDate: "2026-10-05" }, "2026-10-26T01:00:00Z")).toEqual([
      "2026-10-05", "2026-10-19",
    ]);
    expect(dates({ scheduleKind: "custom", anchorDate: "2026-10-05", intervalDays: 10 }, "2026-10-26T01:00:00Z")).toEqual([
      "2026-10-05", "2026-10-15", "2026-10-25",
    ]);
  });

  it("clamps monthly anchors to month end without losing the original anchor day", () => {
    expect(dates({ scheduleKind: "monthly", anchorDate: "2027-01-31" }, "2027-04-30T01:00:00Z")).toEqual([
      "2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30",
    ]);
    expect(dates({ scheduleKind: "monthly", anchorDate: "2028-01-31" }, "2028-03-31T01:00:00Z")).toEqual([
      "2028-01-31", "2028-02-29", "2028-03-31",
    ]);
  });

  it("clamps calendar cycle days in short months", () => {
    expect(dates({ scheduleKind: "calendar", anchorDate: "2027-01-30", salaryCycleDays: "15,30" }, "2027-03-31T01:00:00Z")).toEqual([
      "2027-01-30", "2027-02-15", "2027-02-28", "2027-03-15", "2027-03-30",
    ]);
  });

  it("keeps retry date representation distinct from scheduled due dates", () => {
    expect(paydayDueAt({ kind: "scheduled", dueDate: "2026-10-15" }).toISOString()).toBe("2026-10-15T01:00:00.000Z");
    expect(paydayDueAt({ kind: "retry", retryDate: "2026-10-18" }).toISOString()).toBe("2026-10-18T01:00:00.000Z");
  });

  it("rejects invalid schedule parameters", () => {
    expect(() => getDuePaydayOccurrences({ scheduleKind: "custom", anchorDate: "2026-10-05" }, utc("2026-10-06T01:00:00Z"))).toThrow();
    expect(() => getDuePaydayOccurrences({ scheduleKind: "calendar", anchorDate: "2026-10-05", salaryCycleDays: "0" }, utc("2026-10-06T01:00:00Z"))).toThrow();
  });
});
