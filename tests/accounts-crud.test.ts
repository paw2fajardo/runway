import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  requireOwner: vi.fn(),
  assertSameOrigin: vi.fn(),
}));

vi.mock("../src/db", () => ({ db: { update: mocks.update } }));
vi.mock("../src/lib/auth/guard", () => ({
  requireOwner: mocks.requireOwner,
  assertSameOrigin: mocks.assertSameOrigin,
}));

import { DELETE as deactivateAccount } from "../src/app/api/accounts/[id]/route";

const origin = "https://runway.example";
const accountId = "11111111-1111-4111-8111-111111111111";
const owner = { id: 1, username: "owner", passwordHash: "hash" };

function request(originHeader = origin) {
  return new NextRequest(`${origin}/api/accounts/${accountId}`, {
    method: "DELETE",
    headers: { origin: originHeader },
  });
}

function context(id = accountId) {
  return { params: Promise.resolve({ id }) };
}

function returningRows(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const set = vi.fn().mockReturnValue({ where });
  mocks.update.mockReturnValue({ set });
  return { set, where };
}

describe("account deactivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockImplementation((req: Request) =>
      req.headers.get("origin") === origin
        ? null
        : Response.json({ error: "Request origin is not allowed." }, { status: 403 }),
    );
  });

  it("deactivates the account without deleting linked history", async () => {
    const deactivated = { id: accountId, name: "Checking", isActive: false };
    const query = returningRows([deactivated]);

    const response = await deactivateAccount(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, account: deactivated });
    expect(query.set).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, updatedAt: expect.any(Date) }));
    expect(query.where).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for unknown or already inactive accounts", async () => {
    returningRows([]);

    const response = await deactivateAccount(request(), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Account not found." });
  });

  it("rejects invalid account identifiers before database access", async () => {
    const response = await deactivateAccount(request(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires an authenticated owner", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));

    const response = await deactivateAccount(request(), context());

    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects foreign origins before authentication or database access", async () => {
    const response = await deactivateAccount(request("https://attacker.example"), context());

    expect(response.status).toBe(403);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
