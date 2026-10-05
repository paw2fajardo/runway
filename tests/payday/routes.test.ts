import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(), assertSameOrigin: vi.fn(), listPendingConfirmations: vi.fn(),
  confirmPaycheck: vi.fn(), markPaycheckMissed: vi.fn(),
}));

vi.mock("../../src/lib/auth/guard", () => ({ requireOwner: mocks.requireOwner, assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("../../src/lib/payday/confirmation", () => ({
  listPendingConfirmations: mocks.listPendingConfirmations,
  confirmPaycheck: mocks.confirmPaycheck,
  markPaycheckMissed: mocks.markPaycheckMissed,
}));

import { GET } from "../../src/app/api/payday/occurrences/route";
import { POST as received } from "../../src/app/api/payday/occurrences/[id]/received/route";
import { POST as missed } from "../../src/app/api/payday/occurrences/[id]/missed/route";

const context = { params: Promise.resolve({ id: "occ-1" }) };
const owner = { id: 1, username: "owner" };

describe("payday occurrence routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockReturnValue(null);
    mocks.listPendingConfirmations.mockResolvedValue([{ id: "occ-1" }]);
    mocks.confirmPaycheck.mockResolvedValue("confirmed");
    mocks.markPaycheckMissed.mockResolvedValue("confirmed");
  });

  it("requires owner authorization before listing", async () => {
    mocks.requireOwner.mockResolvedValueOnce(Response.json({ error: "Authentication required." }, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/payday/occurrences"));
    expect(response.status).toBe(401);
    expect(mocks.listPendingConfirmations).not.toHaveBeenCalled();
  });

  it("lists pending posted occurrences for the signed-in owner", async () => {
    const response = await GET(new Request("http://localhost/api/payday/occurrences"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ occurrences: [{ id: "occ-1" }] });
  });

  it("checks same origin and owner before applying Received", async () => {
    mocks.assertSameOrigin.mockReturnValueOnce(Response.json({ error: "blocked" }, { status: 403 }));
    expect((await received(new Request("http://localhost/api"), context)).status).toBe(403);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    mocks.assertSameOrigin.mockReturnValue(null);
    mocks.requireOwner.mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await received(new Request("http://localhost/api"), context)).status).toBe(401);
    expect(mocks.confirmPaycheck).not.toHaveBeenCalled();
  });

  it("returns conflict when the occurrence has not yet been posted", async () => {
    mocks.confirmPaycheck.mockResolvedValueOnce("invalid_state");
    const response = await received(new Request("http://localhost/api", { method: "POST" }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Paycheck cannot be confirmed in its current state." });
  });

  it("rejects invalid retry dates and checks origin/auth on valid missed requests", async () => {
    const invalid = await missed(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ retry_date: "tomorrow" }) }), context);
    expect(invalid.status).toBe(400);
    expect(mocks.markPaycheckMissed).not.toHaveBeenCalled();
    mocks.assertSameOrigin.mockReturnValueOnce(Response.json({ error: "blocked" }, { status: 403 }));
    expect((await missed(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ retry_date: "2026-10-16" }) }), context)).status).toBe(403);
  });
});
