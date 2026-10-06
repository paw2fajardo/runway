import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ records: [] as Array<Record<string, unknown>> }));

function installQueueTable(database: { queuedTransactions: unknown } | null) {
  if (!database) throw new Error("Offline database was not initialized");
  database.queuedTransactions = {
    where: () => ({
      equals: (status: string) => ({
        toArray: async () => state.records.filter((row) => row.status === status),
        count: async () => state.records.filter((row) => row.status === status).length,
      }),
    }),
    update: async (id: number, changes: Record<string, unknown>) => {
      const row = state.records.find((item) => item.id === id);
      if (row) Object.assign(row, changes);
    },
  };
}

describe("offline queue authentication boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    state.records = [{ id: 1, clientUuid: "queued-1", status: "pending", payload: {} }];
    vi.stubGlobal("fetch", vi.fn());
  });

  it("preserves queued rows and does not submit them when signed out", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const { flushOfflineQueue, offlineDB } = await import("../src/lib/offline-db");
    installQueueTable(offlineDB);

    await expect(flushOfflineQueue()).resolves.toEqual({ synced: 0, failed: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/accounts", { cache: "no-store" });
    expect(state.records[0]).toMatchObject({ id: 1, status: "pending" });
  });

  it("preserves queued rows when authentication cannot be checked", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("network unavailable"));
    const { flushOfflineQueue, offlineDB } = await import("../src/lib/offline-db");
    installQueueTable(offlineDB);

    await expect(flushOfflineQueue()).resolves.toEqual({ synced: 0, failed: 0 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.records[0]).toMatchObject({ id: 1, status: "pending" });
  });

  it("returns an auth-rejected row to pending and retries it after reauthentication", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const { flushOfflineQueue, offlineDB } = await import("../src/lib/offline-db");
    installQueueTable(offlineDB);

    await expect(flushOfflineQueue()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(state.records[0]).toMatchObject({ id: 1, status: "pending" });

    await expect(flushOfflineQueue()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(state.records[0]).toMatchObject({ id: 1, status: "synced" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("omits an empty optional category id before syncing an expense", async () => {
    state.records = [{
      id: 1,
      clientUuid: "queued-1",
      status: "pending",
      payload: {
        type: "expense",
        description: "Groceries",
        source_account_id: "11111111-1111-4111-8111-111111111111",
        gross_outflow: 50000,
        category_id: "",
        category_name: "Food & Groceries",
      },
    }];
    const fetchMock = vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const { flushOfflineQueue, offlineDB } = await import("../src/lib/offline-db");
    installQueueTable(offlineDB);

    await expect(flushOfflineQueue()).resolves.toEqual({ synced: 1, failed: 0 });

    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(request.body))).not.toHaveProperty("category_id");
  });
});
