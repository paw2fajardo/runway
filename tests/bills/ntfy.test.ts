import { describe, expect, it, vi } from "vitest";
import { deliverBillNtfyNotifications, type BillNtfyStore } from "../../src/lib/bills/ntfy";

function makeStore() {
  const queued: Array<[string, string, string]> = [];
  const calls: string[][] = [];
  const store: BillNtfyStore = {
    listPaydayOccurrences: async () => [],
    getReminderTime: async () => "09:00",
    listBillsDue: async (today, tomorrow) => {
      calls.push([today, tomorrow]);
      return [
        { id: "due-today", dueDate: today, name: "Internet", amount: 250000 },
        { id: "due-tomorrow", dueDate: tomorrow, name: "Electricity", amount: 125050 },
      ];
    },
    listPastDueBills: async (today) => {
      calls.push(["past-due", today]);
      return [{ id: "late-bill", dueDate: "2026-10-03", name: "Water", amount: 12500 }];
    },
    queue: async (...args) => { queued.push(args); },
    dueDeliveries: async () => [],
    finishAttempt: vi.fn(),
  };
  return { store, queued, calls };
}

describe("bill ntfy reminders", () => {
  it("queues one daily digest for due-today, due-tomorrow, and past-due bills", async () => {
    const { store, queued, calls } = makeStore();
    const sender = { send: vi.fn(async () => undefined) };
    await deliverBillNtfyNotifications({ store, sender, now: new Date("2026-10-10T01:30:00Z") });
    expect(calls).toEqual([["2026-10-10", "2026-10-11"], ["past-due", "2026-10-10"]]);
    expect(queued).toEqual([[
      "bill-digest:2026-10-10",
      "Runway bill reminders (3)",
      [
        "Due today (1)",
        "• Internet · PHP 2,500.00",
        "Due tomorrow (1)",
        "• Electricity · PHP 1,250.50",
        "Past due (1)",
        "• Water — due 2026-10-03 · PHP 125.00",
      ].join("\n"),
    ]]);
  });

  it("limits each digest section to five bill details", async () => {
    const { store, queued } = makeStore();
    store.listBillsDue = async (today) => Array.from({ length: 7 }, (_, index) => ({
      id: `bill-${index}`, dueDate: today, name: `Bill ${index + 1}`, amount: 10000,
    }));
    store.listPastDueBills = async () => [];
    await deliverBillNtfyNotifications({ store, sender: { send: vi.fn(async () => undefined) }, now: new Date("2026-10-10T01:30:00Z") });
    expect(queued[0][2]).toContain("Due today (7)");
    expect(queued[0][2]).toContain("+ 2 more");
    expect(queued[0][2].match(/• Bill/g)).toHaveLength(5);
  });

  it("waits until the configured reminder time in Manila", async () => {
    const { store, queued, calls } = makeStore();
    await deliverBillNtfyNotifications({ store, sender: { send: vi.fn(async () => undefined) }, now: new Date("2026-10-10T00:30:00Z") });
    expect(calls).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("does nothing when ntfy is disabled", async () => {
    const { store, queued, calls } = makeStore();
    expect(await deliverBillNtfyNotifications({ store, sender: null, now: new Date("2026-10-10T01:30:00Z") })).toBe(0);
    expect(calls).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });
});
