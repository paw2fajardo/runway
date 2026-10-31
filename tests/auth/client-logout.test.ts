import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clearCachesMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/components/payday/NotificationSettings", () => ({
  clearPrivatePageCaches: () => clearCachesMock(),
}));

const waitForOfflineQueueMock = vi.fn().mockResolvedValue(undefined);
const recoverSyncingToPendingMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/lib/offline-db", () => ({
  waitForOfflineQueue: (timeout?: number) => waitForOfflineQueueMock(timeout),
  recoverSyncingToPending: () => recoverSyncingToPendingMock(),
}));

import {
  coordinateAuthMutation,
  getLastLoginEpoch,
  recordLoginSession,
  signOut,
} from "../../src/lib/auth/client";

describe("client signOut helper", () => {
  const assignMock = vi.fn();
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.resetModules();
    clearCachesMock.mockClear();
    assignMock.mockClear();
    waitForOfflineQueueMock.mockClear();
    recoverSyncingToPendingMock.mockClear();
    storage.clear();

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    vi.stubGlobal("window", {
      location: {
        assign: assignMock,
      },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls /api/auth/logout with POST, clears caches, and redirects to /login", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await signOut();

    expect(waitForOfflineQueueMock).toHaveBeenCalledTimes(1);
    expect(recoverSyncingToPendingMock).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(clearCachesMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith("/login");
  });

  it("handles ambiguous / failed logout response by still clearing caches and redirecting to /login", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await signOut();

    expect(clearCachesMock).toHaveBeenCalledTimes(1);
    expect(recoverSyncingToPendingMock).toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith("/login");
  });

  it("skips logout API call when a newer login completed across tabs while in flight", async () => {
    // Record an initial session epoch
    storage.set("runway_auth_session_epoch", "1000");

    // Stub navigator.locks to simulate a newer login finishing before lock acquisition
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, callback: () => Promise<void>) => {
          // Tab B completed a newer login at epoch 2000 while we were acquiring the lock
          storage.set("runway_auth_session_epoch", "2000");
          return callback();
        },
      },
    });

    await signOut();

    // Must NOT send logout request which would overwrite the new session cookie
    expect(fetch).not.toHaveBeenCalled();
    // But does clean client-side private page caches and redirect
    expect(clearCachesMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith("/login");
  });

  it("records login session epoch correctly", () => {
    expect(getLastLoginEpoch()).toBe(0);
    recordLoginSession();
    expect(getLastLoginEpoch()).toBeGreaterThan(0);
  });
});
