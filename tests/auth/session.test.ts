import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  innerJoin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    select: mocks.select,
  },
}));

import {
  createOwnerSession,
  getOwnerFromRequest,
  OWNER_SESSION_COOKIE,
  revokeOwnerSessions,
  revokeSession,
  serializeOwnerSessionCookie,
} from "../../src/lib/auth/session";

describe("owner sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.where });
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin });
    mocks.innerJoin.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ limit: mocks.limit });
  });

  it("creates a random opaque token and persists only its SHA-256 digest", async () => {
    const token = await createOwnerSession(1);
    const [{ tokenDigest, ownerId }] = mocks.insertValues.mock.calls[0];

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ownerId).toBe(1);
    expect(tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenDigest).not.toBe(token);
    expect(tokenDigest).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("accepts an active known token and rejects absent, malformed, and revoked sessions", async () => {
    const owner = { id: 1, username: "owner", passwordHash: "hash" };
    mocks.limit.mockResolvedValueOnce([{ owner, revokedAt: null }]);
    const valid = new Request("https://runway.test/", {
      headers: { cookie: `${OWNER_SESSION_COOKIE}=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` },
    });
    await expect(getOwnerFromRequest(valid)).resolves.toEqual(owner);

    await expect(getOwnerFromRequest(new Request("https://runway.test/"))).resolves.toBeNull();
    await expect(getOwnerFromRequest(new Request("https://runway.test/", {
      headers: { cookie: `${OWNER_SESSION_COOKIE}=garbage` },
    }))).resolves.toBeNull();

    mocks.limit.mockResolvedValueOnce([{ owner, revokedAt: new Date() }]);
    await expect(getOwnerFromRequest(valid)).resolves.toBeNull();

    mocks.limit.mockResolvedValueOnce([]);
    await expect(getOwnerFromRequest(valid)).resolves.toBeNull();
  });

  it("revokes one session or every session for an owner", async () => {
    const token = await createOwnerSession(1);
    await revokeSession(token);
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ revokedAt: expect.any(Date) }));

    await revokeOwnerSessions(1);
    expect(mocks.updateSet).toHaveBeenLastCalledWith(expect.objectContaining({ revokedAt: expect.any(Date) }));
  });

  it("sets secure cookie attributes in production without automatic expiry", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const cookie = serializeOwnerSessionCookie("A".repeat(43));
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("Path=/");
      expect(cookie).not.toMatch(/Max-Age|Expires/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
