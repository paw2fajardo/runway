import { describe, expect, it, vi } from "vitest";
import { deliverBillNtfyNotifications, type BillNtfyStore } from "../../src/lib/bills/ntfy";

function makeStore() {
  const queued: Array<[string, string, string]> = [];
  const calls: string[][] = [];
  const store: BillNtfyStore = {
    listPaydayOccurrences: async () => [],
    getReminderTime: async () => "09:00",
    getNextPayday: async () => null,
    listBillsDue: async (today, through) => {
      calls.push([today, through]);
      return [
        { id: "due-today", dueDate: today, name: "Internet", amount: 250000 },
        { id: "due-tomorrow", dueDate: "2026-10-11", name: "Electricity", amount: 125050 },
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

  it("includes later bills through payday, once each, even with no bills due today or tomorrow", async () => {
    const { store, queued, calls } = makeStore();
    store.getNextPayday = vi.fn(async () => "2026-10-15");
    store.listBillsDue = async (today, through) => {
      calls.push([today, through]);
      return [
        { id: "later", dueDate: "2026-10-12", name: "Rent", amount: 100000 },
        { id: "payday", dueDate: "2026-10-15", name: "Phone", amount: 50000 },
        { id: "after", dueDate: "2026-10-16", name: "Outside window", amount: 50000 },
      ];
    };
    store.listPastDueBills = async () => [];
    await deliverBillNtfyNotifications({ store, sender: { send: vi.fn() }, now: new Date("2026-10-10T01:30:00Z") });
    expect(store.getNextPayday).toHaveBeenCalledWith("2026-10-10");
    expect(calls).toEqual([["2026-10-10", "2026-10-15"]]);
    expect(queued).toHaveLength(1);
    expect(queued[0][1]).toBe("Runway bill reminders (2)");
    expect(queued[0][2]).toContain("Until payday (2026-10-15) (2)");
    expect(queued[0][2]).toContain("Rent — due 2026-10-12");
    expect(queued[0][2]).toContain("Phone — due 2026-10-15");
    expect(queued[0][2]).not.toContain("Outside window");
  });

  it("does not repeat today or tomorrow bills in the payday section", async () => {
    const { store, queued } = makeStore();
    store.getNextPayday = async () => "2026-10-15";
    await deliverBillNtfyNotifications({ store, sender: { send: vi.fn() }, now: new Date("2026-10-10T01:30:00Z") });
    expect(queued[0][2].match(/Internet/g)).toHaveLength(1);
    expect(queued[0][2].match(/Electricity/g)).toHaveLength(1);
    expect(queued[0][2]).not.toContain("Until payday");
  });

  it("keeps today and tomorrow reminders when payday is today", async () => {
    const { store, queued, calls } = makeStore();
    store.getNextPayday = async () => "2026-10-10";
    await deliverBillNtfyNotifications({ store, sender: { send: vi.fn() }, now: new Date("2026-10-10T01:30:00Z") });
    expect(calls[0]).toEqual(["2026-10-10", "2026-10-11"]);
    expect(queued[0][2]).toContain("Due tomorrow (1)");
    expect(queued[0][2]).not.toContain("Until payday");
  });

  it("does not queue an empty digest", async () => {
    const { store, queued } = makeStore();
    store.listBillsDue = async () => [];
    store.listPastDueBills = async () => [];
    await deliverBillNtfyNotifications({ store, sender: { send: vi.fn() }, now: new Date("2026-10-10T01:30:00Z") });
    expect(queued).toHaveLength(0);
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
