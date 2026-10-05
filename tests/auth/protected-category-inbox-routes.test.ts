import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  parseInboxText: vi.fn(),
  requireOwner: vi.fn(),
  assertSameOrigin: vi.fn(),
}));

vi.mock("../../src/db", () => ({
  db: { select: mocks.select, insert: mocks.insert, update: mocks.update },
}));
vi.mock("../../src/lib/ai-parser", () => ({ parseInboxText: mocks.parseInboxText }));
vi.mock("../../src/lib/auth/guard", () => ({
  requireOwner: mocks.requireOwner,
  assertSameOrigin: mocks.assertSameOrigin,
}));

import { GET as getCategories, POST as createCategory } from "../../src/app/api/categories/route";
import { PATCH as patchCategory } from "../../src/app/api/categories/[id]/route";
import { GET as getInbox } from "../../src/app/api/inbox/route";
import { POST as parseInbox } from "../../src/app/api/inbox/parse/route";
import { POST as approveInboxItem } from "../../src/app/api/inbox/[id]/approve/route";
import { POST as discardInboxItem } from "../../src/app/api/inbox/[id]/discard/route";

const appOrigin = "https://runway.example";
const owner = { id: 1, username: "owner", passwordHash: "hash" };

function request(method: string, path: string, origin = appOrigin, body = "{}") {
  return new NextRequest(`${appOrigin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: method === "GET" ? undefined : body,
  });
}

function resolvedQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return query;
}

describe("owner-protected category and inbox routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockImplementation((req: Request) =>
      req.headers.get("origin") === appOrigin
        ? null
        : Response.json({ error: "Request origin is not allowed." }, { status: 403 }),
    );
    mocks.select.mockReturnValue(resolvedQuery([]));
    mocks.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) });
    mocks.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) });
  });

  it("rejects unauthenticated reads and parsing before database or AI access", async () => {
    mocks.requireOwner.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));

    const responses = await Promise.all([
      getCategories(request("GET", "/api/categories")),
      getInbox(request("GET", "/api/inbox")),
      parseInbox(request("POST", "/api/inbox/parse", appOrigin, JSON.stringify({ raw_payload: "Paid ₱100" }))),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.parseInboxText).not.toHaveBeenCalled();
  });

  it("rejects foreign-origin writes before auth, body parsing, database, or AI work", async () => {
    const foreign = "https://attacker.example";
    const cases = [
      createCategory(request("POST", "/api/categories", foreign)),
      patchCategory(request("PATCH", "/api/categories/category-1", foreign), { params: Promise.resolve({ id: "category-1" }) }),
      parseInbox(request("POST", "/api/inbox/parse", foreign, JSON.stringify({ raw_payload: "Paid ₱100" }))),
      approveInboxItem(request("POST", "/api/inbox/item-1/approve", foreign), { params: Promise.resolve({ id: "item-1" }) }),
      discardInboxItem(request("POST", "/api/inbox/item-1/discard", foreign), { params: Promise.resolve({ id: "item-1" }) }),
    ];

    const responses = await Promise.all(cases);

    expect(responses.map((response: Response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.parseInboxText).not.toHaveBeenCalled();
  });

  it("preserves authenticated category and inbox list payloads", async () => {
    const category = { id: "category-1", name: "Food", isIncome: false, isArchived: false };
    const inboxItem = { id: "inbox-1", status: "pending", rawPayload: "Paid ₱100" };
    mocks.select
      .mockReturnValueOnce(resolvedQuery([category]))
      .mockReturnValueOnce(resolvedQuery([inboxItem]));

    const categoryResponse = await getCategories(request("GET", "/api/categories"));
    const inboxResponse = await getInbox(request("GET", "/api/inbox"));

    expect(categoryResponse.status).toBe(200);
    expect(await categoryResponse.json()).toEqual([category]);
    expect(inboxResponse.status).toBe(200);
    expect(await inboxResponse.json()).toEqual([inboxItem]);
    expect(mocks.requireOwner).toHaveBeenCalledTimes(2);
  });
});
