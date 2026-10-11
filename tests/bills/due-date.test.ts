import { describe, expect, it } from "vitest";
import { billDueState, todayInManila } from "../../src/lib/bills/due-date";

describe("bill due dates", () => {
  it("uses the Manila date across UTC midnight boundaries", () => {
    expect(todayInManila(new Date("2026-10-10T15:59:59Z"))).toBe("2026-10-10");
    expect(todayInManila(new Date("2026-10-10T16:00:00Z"))).toBe("2026-10-11");
    expect(todayInManila(new Date("2026-10-11T16:00:00Z"))).toBe("2026-10-12");
  });

  it("classifies today's bill by date despite a stored upcoming status", () => {
    expect(billDueState({ dueDate: "2026-10-11", status: "upcoming" }, "2026-10-11")).toBe("due_today");
    expect(billDueState({ dueDate: "2026-10-12", status: "upcoming" }, "2026-10-11")).toBe("upcoming");
    expect(billDueState({ dueDate: "2026-10-10", status: "upcoming" }, "2026-10-11")).toBe("past_due");
  });

  it("preserves grace-period and past-due warnings", () => {
    for (const status of ["grace_period", "past_due"]) {
      expect(billDueState({ dueDate: "2026-10-11", status }, "2026-10-11")).toBe("past_due");
    }
  });
});
