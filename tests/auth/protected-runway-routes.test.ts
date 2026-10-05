import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  requireOwner: vi.fn(),
  assertSameOrigin: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: { select: mocks.select, insert: mocks.insert, update: mocks.update, transaction: mocks.transaction },
}));
vi.mock("../../src/lib/auth/guard", () => ({
  requireOwner: mocks.requireOwner,
  assertSameOrigin: mocks.assertSameOrigin,
}));

import { GET as getForecast } from "../../src/app/api/runway/forecast/route";
import { GET as getSettings, PATCH as patchSettings, PUT as putSettings } from "../../src/app/api/runway/settings/route";
import { GET as getStreams, POST as createStream } from "../../src/app/api/runway/income-streams/route";
import { PATCH as patchStream } from "../../src/app/api/runway/income-streams/[id]/route";

const origin = "https://runway.example";
const owner = { id: 1, username: "owner", passwordHash: "hash" };

function request(method: string, path: string, requestOrigin = origin, body = "{}") {
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body: method === "GET" ? undefined : body,
  });
}

function query(rows: unknown[]) {
  const result = {
    from: vi.fn(() => result),
    where: vi.fn(() => result),
    orderBy: vi.fn(() => result),
    innerJoin: vi.fn(() => result),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
  };
  return result;
}

describe("owner-protected runway routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockImplementation((req: Request) =>
      req.headers.get("origin") === origin
        ? null
        : Response.json({ error: "Request origin is not allowed." }, { status: 403 }),
    );
    mocks.select.mockReturnValue(query([]));
  });

  it("rejects unauthenticated forecast, settings, and stream reads before database access", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    const responses = await Promise.all([
      getForecast(request("GET", "/api/runway/forecast")),
      getSettings(request("GET", "/api/runway/settings")),
      getStreams(request("GET", "/api/runway/income-streams")),
    ]);
    expect(responses.map(response => response.status)).toEqual([401, 401, 401]);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated stream and settings writes before parsing or database access", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    const responses = await Promise.all([
      patchSettings(request("PATCH", "/api/runway/settings", origin, "not-json")),
      putSettings(request("PUT", "/api/runway/settings", origin, "not-json")),
      createStream(request("POST", "/api/runway/income-streams", origin, "not-json")),
      patchStream(request("PATCH", "/api/runway/income-streams/stream-1", origin, "not-json"), { params: Promise.resolve({ id: "stream-1" }) }),
    ]);
    expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401]);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects foreign-origin mutations before auth, body parsing, or database access", async () => {
    const foreign = "https://attacker.example";
    const responses = await Promise.all([
      patchSettings(request("PATCH", "/api/runway/settings", foreign, "not-json")),
      putSettings(request("PUT", "/api/runway/settings", foreign, "not-json")),
      createStream(request("POST", "/api/runway/income-streams", foreign, "not-json")),
      patchStream(request("PATCH", "/api/runway/income-streams/stream-1", foreign, "not-json"), { params: Promise.resolve({ id: "stream-1" }) }),
    ]);
    expect(responses.map(response => response.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("preserves the authenticated income stream list payload", async () => {
    const settings = { id: "profile-1" };
    const account = { id: "account-1", name: "Main account", type: "liquid", currency: "PHP", isActive: true };
    const stream = { id: "stream-1", projectionSettingsId: "profile-1", destinationAccountId: account.id, name: "Salary", netPayCents: 100000, scheduleKind: "monthly", paydayAnchor: "2026-10-15", intervalDays: null, isEnabled: true };
    mocks.select.mockReturnValueOnce(query([settings])).mockReturnValueOnce(query([stream]));

    const response = await getStreams(request("GET", "/api/runway/income-streams"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ streams: [{ id: "stream-1", name: "Salary", net_pay_cents: 100000, next_pay_date: "2026-10-15", payday_anchor: "2026-10-15", schedule_kind: "monthly", interval_days: null, salary_cycle_days: "15,30", is_enabled: true,
      destination_account_id: "account-1" }] });
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });
});
