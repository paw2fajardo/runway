import { describe, expect, it, vi } from "vitest";
import {
  configuredNtfySender,
  deliverNtfyPaydayNotifications,
  type NtfyDeliveryStore,
} from "../src/lib/ntfy";

function makeStore() {
  const queued: Array<[string, string, string]> = [];
  const finished: unknown[][] = [];
  const store: NtfyDeliveryStore = {
    listPaydayOccurrences: async () => [{ id: "payday-1", accountName: "Checking" }],
    queue: async (...args) => { queued.push(args); },
    dueDeliveries: async () => [{ id: "delivery-1", title: "Paycheck deposited", message: "A paycheck was added to Checking.", attemptCount: 0 }],
    finishAttempt: async (...args) => { finished.push(args); },
  };
  return { store, queued, finished };
}

describe("ntfy notifications", () => {
  it("publishes to the configured server topic", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const sender = configuredNtfySender({
        NTFY_SERVER_URL: "https://ntfy.example.test/base/",
        NTFY_TOPIC: "runway-finance",
      } as NodeJS.ProcessEnv);
      expect(sender).not.toBeNull();
      await sender!.send("Bill due today", "Internet · PHP 2,500.00");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://ntfy.example.test/base/runway-finance");
      expect(new Headers(init?.headers).get("Title")).toBe("Bill due today");
      expect(init?.body).toBe("Internet · PHP 2,500.00");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queues one stable payday key and records a successful delivery", async () => {
    const { store, queued, finished } = makeStore();
    const sender = { send: vi.fn(async () => undefined) };
    expect(await deliverNtfyPaydayNotifications({ store, sender, now: new Date("2026-10-10T01:30:00Z") })).toBe(1);
    expect(queued).toEqual([["payday:payday-1", "Paycheck deposited", "A paycheck was added to Checking. Confirm when it arrives."]]);
    expect(sender.send).toHaveBeenCalledOnce();
    expect(finished[0][1]).toBe("sent");
  });

  it("does not create payday reminders when ntfy is not configured", async () => {
    const { store, queued } = makeStore();
    expect(await deliverNtfyPaydayNotifications({ store, sender: null })).toBe(0);
    expect(queued).toHaveLength(0);
  });
});
