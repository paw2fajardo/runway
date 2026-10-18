import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ forecast: vi.fn(), answer: vi.fn(), owner: vi.fn(), origin: vi.fn(), insights: vi.fn() }));
vi.mock("../src/app/api/runway/forecast/route", () => ({ GET: mocks.forecast }));
vi.mock("../src/lib/auth/guard", () => ({ requireOwner: mocks.owner, assertSameOrigin: mocks.origin }));
vi.mock("../src/lib/load-insights", () => ({ loadInsights: mocks.insights }));
vi.mock("../src/lib/runway-assistant", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/runway-assistant")>(), answerRunwayQuestion: mocks.answer,
}));
import { POST } from "../src/app/api/runway/assistant/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/runway/assistant", { method: "POST",
    headers: { "content-type": "application/json", cookie: "runway_owner_session=test-session" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue(null);
  mocks.owner.mockResolvedValue({ id: 1 });
  mocks.answer.mockResolvedValue("Calculated explanation.");
});

describe("payment plan AI explanations", () => {
  it("rejects unauthenticated requests before parsing or forecasting", async () => {
    mocks.owner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    expect((await POST(request({ query: "Explain" }))).status).toBe(401);
    expect(mocks.forecast).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it("rejects foreign origins before authentication or AI use", async () => {
    mocks.origin.mockReturnValue(Response.json({ error: "Request origin is not allowed." }, { status: 403 }));
    expect((await POST(request({ query: "Explain" }))).status).toBe(403);
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it.each([
    { plan_scenario: "unknown" }, { plan_scenario: "grace" },
    { plan_scenario: "combined", use_grace_periods: "true" },
  ])("validates the requested scenario and grace opt-in: %j", async fields => {
    expect((await POST(request({ query: "Explain", ...fields }))).status).toBe(400);
    expect(mocks.forecast).not.toHaveBeenCalled();
  });

  it("forwards the owner session and uses only the selected server-calculated scenario", async () => {
    mocks.forecast.mockResolvedValue(Response.json({ current_liquid_cash: 10000,
      payment_plan: { scenarios: [{ id: "current" }, { id: "grace", minimum_balance_cents: 5000 }] } }));
    const response = await POST(request({ query: "Explain", plan_scenario: "grace", use_grace_periods: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "Calculated explanation." });
    const forwarded = mocks.forecast.mock.calls[0][0] as NextRequest;
    expect(forwarded.headers.get("cookie")).toBe("runway_owner_session=test-session");
    expect(forwarded.nextUrl.searchParams.get("payment_plan")).toBe("true");
    expect(forwarded.nextUrl.searchParams.get("use_grace_periods")).toBe("true");
    expect(mocks.answer.mock.calls[0][1].payment_plan.scenarios).toEqual([{ id: "grace", minimum_balance_cents: 5000 }]);
  });

  it("preserves ordinary assistant questions without requesting a payment plan", async () => {
    mocks.forecast.mockResolvedValue(Response.json({ current_liquid_cash: 10000 }));
    expect((await POST(request({ query: "What is my runway?" }))).status).toBe(200);
    expect((mocks.forecast.mock.calls[0][0] as NextRequest).nextUrl.searchParams.has("payment_plan")).toBe(false);
    expect(mocks.answer.mock.calls[0][0]).toBe("What is my runway?");
  });

  it("does not ask AI to explain a missing server-calculated scenario", async () => {
    mocks.forecast.mockResolvedValue(Response.json({ current_liquid_cash: 10000 }));
    expect((await POST(request({ query: "Explain", plan_scenario: "current" }))).status).toBe(503);
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it("loads spending evidence on the server instead of accepting client-calculated figures", async () => {
    mocks.forecast.mockResolvedValue(Response.json({ current_liquid_cash: 10000 }));
    mocks.insights.mockResolvedValue({ weekly: { current_cents: 5000 }, recurring: { recurring: [], duplicates: [] },
      variable_bills: [], history_from_date: "2026-04-21", history_truncated: false, accounts: [{ id: "private-id" }] });
    expect((await POST(request({ query: "Explain spending", insights: true }))).status).toBe(200);
    expect(mocks.insights).toHaveBeenCalledOnce();
    expect(mocks.answer.mock.calls[0][3]).toMatchObject({ weekly: { current_cents: 5000 } });
    expect(mocks.answer.mock.calls[0][3]).not.toHaveProperty("accounts");
  });
});
