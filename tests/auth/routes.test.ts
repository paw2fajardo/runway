import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), where: vi.fn(), limit: vi.fn(),
  insert: vi.fn(), values: vi.fn(), onConflictDoNothing: vi.fn(), returning: vi.fn(),
  update: vi.fn(), set: vi.fn(), txUpdate: vi.fn(), txSet: vi.fn(), txWhere: vi.fn(), transaction: vi.fn(),
  hashPassword: vi.fn(), verifyPassword: vi.fn(), createOwnerSession: vi.fn(), revokeSession: vi.fn(),
  revokeOwnerSessions: vi.fn(), getOwnerFromRequest: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: {
    select: () => ({ from: mocks.from }),
    insert: mocks.insert,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}));
vi.mock("../../src/lib/auth/password", () => ({ hashPassword: mocks.hashPassword, verifyPassword: mocks.verifyPassword }));
vi.mock("../../src/lib/auth/session", () => ({
  OWNER_SESSION_COOKIE: "runway_owner_session",
  createOwnerSession: mocks.createOwnerSession,
  getOwnerFromRequest: mocks.getOwnerFromRequest,
  revokeSession: mocks.revokeSession,
  revokeOwnerSessions: mocks.revokeOwnerSessions,
  serializeOwnerSessionCookie: (token: string) => `runway_owner_session=${token}; HttpOnly; Path=/; SameSite=Lax`,
  serializeClearedOwnerSessionCookie: () => "runway_owner_session=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax",
}));

import { GET as setupStatus, POST as setup } from "../../src/app/api/auth/setup/route";
import { POST as login } from "../../src/app/api/auth/login/route";
import { POST as logout } from "../../src/app/api/auth/logout/route";
import { PATCH as changePassword } from "../../src/app/api/auth/password/route";
import { DELETE as revokeSessions } from "../../src/app/api/auth/sessions/route";
import { assertSameOrigin, clearLoginFailures, isLoginThrottled, recordLoginFailure, resetLoginThrottleForTests } from "../../src/lib/auth/guard";

const owner = { id: 1, username: "owner", passwordHash: "encoded-hash" };
const sameOriginHeaders = { origin: "https://runway.example", "content-type": "application/json" };

function post(body: unknown, path = "/api/auth/login") {
  return new Request(`https://runway.example${path}`, { method: "POST", headers: sameOriginHeaders, body: JSON.stringify(body) });
}

describe("owner auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLoginThrottleForTests();
    mocks.from.mockReturnValue({ limit: mocks.limit, where: mocks.where });
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ onConflictDoNothing: mocks.onConflictDoNothing });
    mocks.onConflictDoNothing.mockReturnValue({ returning: mocks.returning });
    mocks.hashPassword.mockResolvedValue("new-hash");
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.createOwnerSession.mockResolvedValue("A".repeat(43));
    mocks.revokeSession.mockResolvedValue(undefined);
    mocks.revokeOwnerSessions.mockResolvedValue(undefined);
    mocks.getOwnerFromRequest.mockResolvedValue(owner);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => callback({
      update: mocks.txUpdate,
    }));
    mocks.txUpdate.mockReturnValue({ set: mocks.txSet });
    mocks.txSet.mockReturnValue({ where: mocks.txWhere });
    mocks.txWhere.mockResolvedValue(undefined);
  });

  it("reports whether the one-time owner setup has been completed", async () => {
    mocks.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }]);
    expect(await (await setupStatus()).json()).toEqual({ configured: false });
    expect(await (await setupStatus()).json()).toEqual({ configured: true });
  });

  it("creates only the singleton owner and rejects a second setup", async () => {
    mocks.returning.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    const first = await setup(post({ username: "Owner", password: "long-enough-password" }, "/api/auth/setup"));
    const second = await setup(post({ username: "other", password: "long-enough-password" }, "/api/auth/setup"));
    expect(first.status).toBe(201);
    expect(mocks.values).toHaveBeenNthCalledWith(1, { id: 1, username: "owner", passwordHash: "new-hash" });
    expect(second.status).toBe(409);
  });

  it("sets a non-expiring session cookie after valid login", async () => {
    mocks.limit.mockResolvedValueOnce([owner]);
    const response = await login(post({ username: "Owner", password: "long-enough-password" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).not.toMatch(/Max-Age|Expires/i);
  });

  it("uses the same generic response for bad credentials and throttled attempts", async () => {
    mocks.limit.mockResolvedValue([]);
    mocks.verifyPassword.mockResolvedValue(false);
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await login(post({ username: "owner", password: "wrong-password" })));
    }
    expect(responses.slice(0, 5).map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    expect(responses[5].status).toBe(401);
    const firstBody = await responses[0].json();
    expect(firstBody).toEqual(await responses[1].json());
    expect(firstBody).toEqual(await responses[5].json());
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(5);
  });

  it("does not let failures from one client and username lock out another client", async () => {
    mocks.limit.mockResolvedValue([]);
    mocks.verifyPassword.mockResolvedValue(false);
    for (let index = 0; index < 5; index += 1) {
      await login(post({ username: "owner", password: "wrong-password" }));
    }
    mocks.limit.mockResolvedValueOnce([owner]);
    mocks.verifyPassword.mockResolvedValueOnce(true);
    const otherClient = new Request("https://runway.example/api/auth/login", {
      method: "POST",
      headers: { ...sameOriginHeaders, "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ username: "owner", password: "long-enough-password" }),
    });
    expect((await login(otherClient)).status).toBe(200);
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(6);
  });

  it("revokes the current session and clears its cookie on logout", async () => {
    const request = new Request("https://runway.example/api/auth/logout", {
      method: "POST", headers: { ...sameOriginHeaders, cookie: `runway_owner_session=${"A".repeat(43)}` },
    });
    const response = await logout(request);
    expect(response.status).toBe(200);
    expect(mocks.revokeSession).toHaveBeenCalledWith("A".repeat(43));
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("verifies the current password and revokes all sessions during password change", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(false);
    const wrong = await changePassword(new Request("https://runway.example/api/auth/password", {
      method: "PATCH", headers: sameOriginHeaders,
      body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "new-long-password" }),
    }));
    expect(wrong.status).toBe(400);
    mocks.verifyPassword.mockResolvedValue(true);
    const request = new Request("https://runway.example/api/auth/password", {
      method: "PATCH", headers: sameOriginHeaders,
      body: JSON.stringify({ currentPassword: "old-long-password", newPassword: "new-long-password" }),
    });
    const response = await changePassword(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reauthenticationRequired: true });
    expect(mocks.txUpdate).toHaveBeenCalledTimes(2);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("revokes all sessions and requires a fresh login", async () => {
    const response = await revokeSessions(new Request("https://runway.example/api/auth/sessions", {
      method: "DELETE", headers: sameOriginHeaders,
    }));
    expect(response.status).toBe(200);
    expect(mocks.revokeOwnerSessions).toHaveBeenCalledWith(1);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects a foreign Origin on state-changing requests", async () => {
    const response = assertSameOrigin(new Request("https://runway.example/api/auth/login", {
      method: "POST", headers: { origin: "https://attacker.example" },
    }));
    expect(response?.status).toBe(403);
    expect(assertSameOrigin(new Request("https://runway.example/api/auth/login", {
      method: "POST", headers: { origin: "https://runway.example" },
    }))).toBeNull();
  });

  it("expires login failure windows and clears counters after success", () => {
    const start = 10_000;
    for (let i = 0; i < 5; i += 1) recordLoginFailure("ip", start + i);
    expect(isLoginThrottled("ip", start + 5)).toBe(true);
    expect(isLoginThrottled("other-ip", start + 5)).toBe(false);
    clearLoginFailures("ip");
    expect(isLoginThrottled("ip", start + 6)).toBe(false);
    expect(isLoginThrottled("ip", start + 15 * 60 * 1_000 + 1)).toBe(false);
  });

  it("throttles all usernames consistently for an IP and clears that IP after success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    mocks.limit.mockResolvedValue([]);
    mocks.verifyPassword.mockResolvedValue(false);
    const clientHeaders = { ...sameOriginHeaders, "x-forwarded-for": "203.0.113.9" };
    try {
      for (let index = 0; index < 5; index += 1) {
        await login(new Request("https://runway.example/api/auth/login", {
          method: "POST", headers: clientHeaders,
          body: JSON.stringify({ username: `guess${index}`, password: "wrong-password" }),
        }));
      }

      const badCredential = await login(new Request("https://runway.example/api/auth/login", {
        method: "POST", headers: clientHeaders,
        body: JSON.stringify({ username: "owner", password: "wrong-password" }),
      }));
      const blockedOwner = await login(new Request("https://runway.example/api/auth/login", {
        method: "POST", headers: clientHeaders,
        body: JSON.stringify({ username: "owner", password: "long-enough-password" }),
      }));
      expect(blockedOwner.status).toBe(badCredential.status);
      expect(await blockedOwner.json()).toEqual(await badCredential.json());
      expect(mocks.verifyPassword).toHaveBeenCalledTimes(5);

      vi.advanceTimersByTime(15 * 60 * 1_000 + 1);
      for (let index = 0; index < 4; index += 1) {
        await login(new Request("https://runway.example/api/auth/login", {
          method: "POST", headers: clientHeaders,
          body: JSON.stringify({ username: "owner", password: "wrong-password" }),
        }));
      }
      mocks.limit.mockResolvedValueOnce([owner]);
      mocks.verifyPassword.mockResolvedValueOnce(true);
      expect((await login(new Request("https://runway.example/api/auth/login", {
        method: "POST", headers: clientHeaders,
        body: JSON.stringify({ username: "owner", password: "long-enough-password" }),
      }))).status).toBe(200);

      mocks.verifyPassword.mockResolvedValue(false);
      for (let index = 0; index < 5; index += 1) {
        mocks.limit.mockResolvedValueOnce([owner]);
        const response = await login(new Request("https://runway.example/api/auth/login", {
          method: "POST", headers: clientHeaders,
          body: JSON.stringify({ username: "owner", password: "wrong-password" }),
        }));
        expect(response.status).toBe(401);
        expect(mocks.verifyPassword).toHaveBeenCalledTimes(11 + index);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
