import { describe, expect, it, vi } from "vitest";
import {
  deliverDueBillNotifications,
  type BillPushDeliveryStore,
} from "../../src/lib/bills/push";
import type { PushSender, StoredPushSubscription, ValidPushSubscription } from "../../src/lib/payday/push";

const subscription: StoredPushSubscription = {
  id: "sub-1", ownerId: 1, endpointHash: "a".repeat(64),
  endpoint: "https://fcm.googleapis.com/subscription",
  keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) },
};

function makeStore(deliveries: Awaited<ReturnType<BillPushDeliveryStore["dueDeliveries"]>>) {
  const calls = { listed: [] as string[][], queued: [] as unknown[][], finished: [] as unknown[][] };
  const store: BillPushDeliveryStore = {
    getReminderTime: async () => "09:00",
    listRemindableBills: async (today, tomorrow) => {
      calls.listed.push([today, tomorrow]);
      return [
        { id: "today-instance", dueDate: today, name: "Internet", amount: 250000 },
        { id: "tomorrow-instance", dueDate: tomorrow, name: "Electricity", amount: 125050 },
      ];
    },
    listSubscriptions: async () => [subscription],
    queue: async (...args) => { calls.queued.push(args); },
    dueDeliveries: async () => deliveries,
    finishAttempt: async (...args) => { calls.finished.push(args); },
    removeSubscription: vi.fn(),
  };
  return { store, calls };
}

describe("bill push reminders", () => {
  it("queues today's reminders once per date and sends due-today and due-tomorrow alerts", async () => {
    const now = new Date("2026-10-10T01:30:00.000Z"); // Oct 10, 9:30 AM in Manila
    const deliveries = [
      { id: "delivery-today", instanceId: "today-instance", endpointHash: subscription.endpointHash,
        endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
        dueDate: "2026-10-10", name: "Internet", amount: 250000, attemptCount: 0 },
      { id: "delivery-tomorrow", instanceId: "tomorrow-instance", endpointHash: subscription.endpointHash,
        endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
        dueDate: "2026-10-11", name: "Electricity", amount: 125050, attemptCount: 0 },
    ];
    const { store, calls } = makeStore(deliveries);
    const titles: string[] = [];
    const sender: PushSender = { send: vi.fn(async (_subscription: ValidPushSubscription, rawPayload: string) => {
      const payload = JSON.parse(rawPayload);
      expect(payload.url).toBe("/bills");
      titles.push(payload.title);
      return { statusCode: 201 };
    }) };

    expect(await deliverDueBillNotifications({ store, sender, now })).toBe(2);
    expect(calls.listed).toEqual([["2026-10-10", "2026-10-11"]]);
    expect(calls.queued).toEqual([
      ["today-instance", "sub-1", subscription.endpointHash, "2026-10-10"],
      ["tomorrow-instance", "sub-1", subscription.endpointHash, "2026-10-10"],
    ]);
    expect(titles).toEqual(["Bill due today", "Bill due tomorrow"]);
    expect(calls.finished.map(([, status]) => status)).toEqual(["sent", "sent"]);
  });

  it("does not queue without push configuration", async () => {
    const { store, calls } = makeStore([]);
    expect(await deliverDueBillNotifications({ store, sender: null, now: new Date("2026-10-09T16:30:00Z") })).toBe(0);
    expect(calls.listed).toHaveLength(0);
    expect(calls.queued).toHaveLength(0);
  });

  it("waits until the configured Manila reminder time", async () => {
    const { store, calls } = makeStore([]);
    expect(await deliverDueBillNotifications({ store, sender: { send: vi.fn(async () => ({ statusCode: 201 })) }, now: new Date("2026-10-10T00:30:00Z") })).toBe(0);
    expect(calls.listed).toHaveLength(0);
    expect(calls.queued).toHaveLength(0);
  });
});
