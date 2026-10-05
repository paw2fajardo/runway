import { describe, expect, it, vi } from "vitest";
import {
  createPushSubscriptionHandlers,
  deliverPendingPaydayNotifications,
  endpointHash,
  parsePushSubscription,
  type PushDeliveryStore,
  type PushSender,
  type StoredPushSubscription,
} from "../../src/lib/payday/push";

const subscription = {
  endpoint: "https://fcm.googleapis.com/subscription/123",
  keys: { p256dh: "A".repeat(65), auth: "B".repeat(22) },
};
const owner = { id: 1 } as never;

describe("push subscription routes", () => {
  it("returns only the configured public key after authentication", async () => {
    const handlers = createPushSubscriptionHandlers({
      authenticate: vi.fn().mockResolvedValue(owner), sameOrigin: () => null,
      store: { save: vi.fn(), remove: vi.fn() }, publicKey: "public-only",
    });
    const response = await handlers.GET(new Request("https://runway.test/api/payday/push-subscriptions"));
    expect(await response.json()).toEqual({ publicKey: "public-only" });
  });

  it("rejects unauthenticated, foreign-origin, malformed, and oversized subscriptions", async () => {
    const save = vi.fn();
    const handlers = createPushSubscriptionHandlers({
      authenticate: vi.fn().mockResolvedValue(Response.json({}, { status: 401 })),
      sameOrigin: () => Response.json({}, { status: 403 }),
      store: { save, remove: vi.fn() }, publicKey: "public-only",
    });
    expect((await handlers.POST(new Request("https://runway.test", { method: "POST", body: JSON.stringify(subscription) }))).status).toBe(403);
    expect((await handlers.DELETE(new Request("https://runway.test", { method: "DELETE", body: "{}" }))).status).toBe(403);
    expect(save).not.toHaveBeenCalled();

    const unauthenticated = createPushSubscriptionHandlers({
      authenticate: vi.fn().mockResolvedValue(Response.json({}, { status: 401 })), sameOrigin: () => null,
      store: { save, remove: vi.fn() }, publicKey: null,
    });
    expect((await unauthenticated.POST(new Request("https://runway.test", { method: "POST", body: JSON.stringify(subscription) }))).status).toBe(401);

    const authenticated = createPushSubscriptionHandlers({
      authenticate: vi.fn().mockResolvedValue(owner), sameOrigin: () => null,
      store: { save, remove: vi.fn() }, publicKey: null,
    });
    expect((await authenticated.POST(new Request("https://runway.test", { method: "POST", body: "{}" }))).status).toBe(400);
    expect((await authenticated.POST(new Request("https://runway.test", { method: "POST", body: "x".repeat(4097) }))).status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });

  it("bounds streamed bodies even when Content-Length is missing or understated", async () => {
    const save = vi.fn();
    const handlers = createPushSubscriptionHandlers({
      authenticate: vi.fn().mockResolvedValue(owner), sameOrigin: () => null,
      store: { save, remove: vi.fn() }, publicKey: null,
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(4097)));
        controller.close();
      },
    });
    const request = new Request("https://runway.test", {
      method: "POST", body: stream, headers: { "content-length": "10" },
      duplex: "half",
    } as RequestInit);
    expect((await handlers.POST(request)).status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });

  it("stores by endpoint hash and removes only the signed-in owner's endpoint", async () => {
    const save = vi.fn(); const remove = vi.fn();
    const handlers = createPushSubscriptionHandlers({
      authenticate: vi.fn().mockResolvedValue(owner), sameOrigin: () => null,
      store: { save, remove }, publicKey: null,
    });
    const post = await handlers.POST(new Request("https://runway.test", { method: "POST", body: JSON.stringify(subscription) }));
    expect(post.status).toBe(201);
    expect(save).toHaveBeenCalledWith(1, subscription, endpointHash(subscription.endpoint));
    const del = await handlers.DELETE(new Request("https://runway.test", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }));
    expect(del.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(1, endpointHash(subscription.endpoint));
  });

  it("returns service-unavailable responses when subscription persistence fails", async () => {
    const handlers = createPushSubscriptionHandlers({
      authenticate: vi.fn().mockResolvedValue(owner), sameOrigin: () => null,
      store: { save: vi.fn().mockRejectedValue(new Error("db down")), remove: vi.fn().mockRejectedValue(new Error("db down")) },
      publicKey: null,
    });
    expect((await handlers.POST(new Request("https://runway.test", { method: "POST", body: JSON.stringify(subscription) }))).status).toBe(503);
    expect((await handlers.DELETE(new Request("https://runway.test", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }))).status).toBe(503);
  });

  it("rejects private, arbitrary, non-default-port, and credentialed push endpoints", () => {
    for (const endpoint of [
      "https://localhost/subscription",
      "https://127.0.0.1/subscription",
      "https://192.168.1.10/subscription",
      "https://push.example.test/subscription",
      "https://fcm.googleapis.com:8443/subscription",
      "https://user:pass@fcm.googleapis.com/subscription",
    ]) {
      expect(parsePushSubscription({ ...subscription, endpoint })).toBeNull();
    }
    expect(parsePushSubscription({ ...subscription, endpoint: "http://fcm.googleapis.com/subscription" })).toBeNull();
    expect(parsePushSubscription({ ...subscription, keys: { ...subscription.keys, auth: "bad" } })).toBeNull();
    expect(parsePushSubscription(subscription)).toEqual(subscription);
  });

  it("accepts mainstream FCM, Apple, Mozilla, and Windows push hosts", () => {
    const hosts = [
      "fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com",
      "push.services.mozilla.com", "wns2-example.notify.windows.com",
    ];
    for (const host of hosts) {
      expect(parsePushSubscription({ ...subscription, endpoint: `https://${host}/subscription` })).not.toBeNull();
    }
  });
});

function deliveryStore(deliveries: PushDeliveryStore["dueDeliveries"] extends (...args: never[]) => Promise<infer T> ? T : never) {
  const sub: StoredPushSubscription = {
    id: "sub-1", ownerId: 1, endpointHash: endpointHash(subscription.endpoint), ...subscription,
  };
  const calls: { queued: unknown[][]; finished: unknown[][]; removed: string[] } = { queued: [], finished: [], removed: [] };
  const store: PushDeliveryStore = {
    listPendingOccurrences: async () => [{ id: "occ-1", description: "Main account" }],
    listSubscriptions: async () => [sub],
    queue: async (...args) => { calls.queued.push(args); },
    dueDeliveries: async () => deliveries,
    finishAttempt: async (...args) => { calls.finished.push(args); },
    removeSubscription: async hash => { calls.removed.push(hash); },
  };
  return { store, calls };
}

describe("payday push delivery", () => {
  const now = new Date("2026-10-05T01:00:00.000Z");
  const due = [{
    id: "delivery-1", occurrenceId: "occ-1", endpointHash: endpointHash(subscription.endpoint),
    endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
    description: "Main account", attemptCount: 0,
  }];

  it("queues after posting and sends a deep link, then marks the delivery sent", async () => {
    const { store, calls } = deliveryStore(due);
    const sender: PushSender = { send: vi.fn(async (_sub, raw) => {
      expect(JSON.parse(raw)).toMatchObject({ url: "/payday/occurrences/occ-1", title: "Paycheck deposited" });
      return { statusCode: 201 };
    }) };
    expect(await deliverPendingPaydayNotifications({ store, sender, now })).toBe(1);
    expect(calls.queued).toEqual([["occ-1", "sub-1", endpointHash(subscription.endpoint)]]);
    expect(calls.finished[0]).toEqual(["delivery-1", "sent", now, null, null]);
  });

  it("keeps transient failure retryable, and expires only 404 or 410 endpoints", async () => {
    const transient = deliveryStore(due);
    await deliverPendingPaydayNotifications({ store: transient.store, sender: { send: async () => { throw new Error("offline"); } }, now });
    expect(transient.calls.removed).toEqual([]);
    expect(transient.calls.finished[0][1]).toBe("retryable");
    expect(transient.calls.finished[0][4]).toBe("offline");

    const expired = deliveryStore(due);
    await deliverPendingPaydayNotifications({ store: expired.store, sender: { send: async () => ({ statusCode: 410 }) }, now });
    expect(expired.calls.removed).toEqual([endpointHash(subscription.endpoint)]);
    expect(expired.calls.finished[0][1]).toBe("expired");
  });

  it("does not queue or send when config or subscriptions are absent", async () => {
    const noConfig = deliveryStore(due);
    expect(await deliverPendingPaydayNotifications({ store: noConfig.store, sender: null, now })).toBe(0);
    expect(noConfig.calls.queued).toHaveLength(0);
    const noSubscriptions = deliveryStore(due);
    noSubscriptions.store.listSubscriptions = async () => [];
    const send = vi.fn();
    expect(await deliverPendingPaydayNotifications({ store: noSubscriptions.store, sender: { send }, now })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
