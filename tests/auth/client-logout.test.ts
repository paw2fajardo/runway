import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clearCachesMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/components/payday/NotificationSettings", () => ({
  clearPrivatePageCaches: () => clearCachesMock(),
}));

import { signOut } from "../../src/lib/auth/client";

describe("client signOut helper", () => {
  const assignMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    clearCachesMock.mockClear();
    assignMock.mockClear();

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

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(clearCachesMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith("/login");
  });

  it("throws error and does not redirect if /api/auth/logout fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Session revocation failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(signOut()).rejects.toThrow("Session revocation failed");
    expect(clearCachesMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
