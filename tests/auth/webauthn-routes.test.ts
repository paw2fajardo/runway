import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  getOwnerFromRequest: vi.fn(),
  createOwnerSession: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: {
    select: () => ({ from: mocks.from }),
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
  },
}));

vi.mock("../../src/lib/auth/session", () => ({
  createOwnerSession: mocks.createOwnerSession,
  serializeOwnerSessionCookie: (token: string) => `runway_owner_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`,
  getOwnerFromRequest: mocks.getOwnerFromRequest,
}));

import { POST as registerOptions } from "../../src/app/api/auth/webauthn/register-options/route";
import { POST as registerVerify } from "../../src/app/api/auth/webauthn/register-verify/route";
import { POST as loginOptions } from "../../src/app/api/auth/webauthn/login-options/route";
import { POST as loginVerify } from "../../src/app/api/auth/webauthn/login-verify/route";
import { GET as getCredentials, DELETE as deleteCredential } from "../../src/app/api/auth/webauthn/credentials/route";
import { resetChallengesForTests, createWebAuthnChallenge } from "../../src/lib/auth/webauthn";
import { resetLoginThrottleForTests } from "../../src/lib/auth/guard";

const owner = { id: 1, username: "owner" };
const headers = { origin: "https://runway.example", "content-type": "application/json" };

describe("WebAuthn route flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChallengesForTests();
    resetLoginThrottleForTests();
    mocks.from.mockReturnValue({ where: mocks.where, limit: mocks.limit });
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue([]);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockResolvedValue([]);
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.delete.mockReturnValue({ where: mocks.where });
    mocks.getOwnerFromRequest.mockResolvedValue(owner);
    mocks.createOwnerSession.mockResolvedValue("A".repeat(43));
  });

  describe("register-options", () => {
    it("rejects non-owner requests", async () => {
      mocks.getOwnerFromRequest.mockResolvedValueOnce(null);
      const req = new Request("https://runway.example/api/auth/webauthn/register-options", {
        method: "POST",
        headers,
      });
      const res = await registerOptions(req);
      expect(res.status).toBe(401);
    });

    it("returns WebAuthn registration options for authenticated owner", async () => {
      mocks.where.mockResolvedValueOnce([]); // no existing passkeys
      const req = new Request("https://runway.example/api/auth/webauthn/register-options", {
        method: "POST",
        headers,
      });
      const res = await registerOptions(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.challenge).toBeTypeOf("string");
      expect(data.rp.name).toBe("Runway");
      expect(data.user.name).toBe("owner");
    });
  });

  describe("login-options", () => {
    it("returns 404 when no passkeys exist for owner", async () => {
      mocks.limit.mockResolvedValueOnce([owner]); // owner found
      mocks.where.mockResolvedValueOnce([]); // no passkeys
      const req = new Request("https://runway.example/api/auth/webauthn/login-options", {
        method: "POST",
        headers,
      });
      const res = await loginOptions(req);
      expect(res.status).toBe(404);
    });

    it("returns authentication options when owner has registered passkeys", async () => {
      mocks.limit.mockResolvedValueOnce([owner]);
      mocks.where.mockResolvedValueOnce([
        { id: "pk-1", ownerId: 1, credentialId: "cred-123", transports: "internal" },
      ]);
      const req = new Request("https://runway.example/api/auth/webauthn/login-options", {
        method: "POST",
        headers,
      });
      const res = await loginOptions(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.challenge).toBeTypeOf("string");
      expect(data.allowCredentials).toHaveLength(1);
      expect(data.allowCredentials[0].id).toBe("cred-123");
    });
  });

  describe("login-verify", () => {
    it("rejects request when challenge is missing or invalid", async () => {
      const clientDataJSON = Buffer.from(JSON.stringify({ challenge: "nonexistent-challenge" })).toString("base64url");
      const req = new Request("https://runway.example/api/auth/webauthn/login-verify", {
        method: "POST",
        headers,
        body: JSON.stringify({
          response: {
            id: "cred-1",
            response: { clientDataJSON },
          },
        }),
      });
      const res = await loginVerify(req);
      expect(res.status).toBe(400);
    });

    it("rejects request gracefully when clientDataJSON is corrupted without 500 crash", async () => {
      const req = new Request("https://runway.example/api/auth/webauthn/login-verify", {
        method: "POST",
        headers,
        body: JSON.stringify({
          response: {
            id: "cred-1",
            response: { clientDataJSON: "invalid-base64-json" },
          },
        }),
      });
      const res = await loginVerify(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing or malformed challenge.");
    });
  });

  describe("credentials management", () => {
    it("lists owner credentials", async () => {
      mocks.where.mockResolvedValueOnce([
        {
          id: "pk-1",
          ownerId: 1,
          deviceName: "Pixel 9",
          createdAt: new Date("2026-10-01"),
          lastUsedAt: null,
        },
      ]);
      const req = new Request("https://runway.example/api/auth/webauthn/credentials", {
        headers,
      });
      const res = await getCredentials(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.passkeys).toHaveLength(1);
      expect(data.passkeys[0].deviceName).toBe("Pixel 9");
    });

    it("deletes a credential scoped to the owner ID", async () => {
      const req = new Request("https://runway.example/api/auth/webauthn/credentials", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id: "pk-1" }),
      });
      const res = await deleteCredential(req);
      expect(res.status).toBe(200);
      expect(mocks.delete).toHaveBeenCalled();
    });
  });
});
