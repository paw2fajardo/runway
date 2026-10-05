import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { CompoundTransactionSchema } from "../src/lib/types";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  requireOwner: vi.fn(),
  assertSameOrigin: vi.fn(),
  selectWhere: vi.fn(),
  insertValues: vi.fn(),
  update: vi.fn(),
  existingCategory: null as null | {
    id: string;
    name: string;
    isIncome: boolean;
    isSystemFee: boolean;
    isArchived: boolean;
  },
}));

vi.mock("../src/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../src/lib/auth/guard", () => ({
  requireOwner: mocks.requireOwner,
  assertSameOrigin: mocks.assertSameOrigin,
}));

import { POST as createCompoundTransaction } from "../src/app/api/transactions/compound/route";

const appOrigin = "https://runway.example";
const owner = { id: 1, username: "owner", passwordHash: "hash" };
const expense = {
  type: "expense",
  description: "New category expense",
  source_account_id: "550e8400-e29b-41d4-a716-446655440000",
  gross_outflow: 12500,
  category_name: "  Pet Care  ",
};

function request(body: unknown) {
  return new NextRequest(`${appOrigin}/api/transactions/compound`, {
    method: "POST",
    headers: { origin: appOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("compound expense category synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existingCategory = null;
    mocks.requireOwner.mockResolvedValue(owner);
    mocks.assertSameOrigin.mockReturnValue(null);

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((condition) => {
            mocks.selectWhere(condition);
            const { sql, params } = new PgDialect().sqlToQuery(condition);
            const hasNameMatch =
              sql.includes('"name"') &&
              params.includes("Pet Care") &&
              mocks.existingCategory?.name === "Pet Care";
            const categoryMatches =
              mocks.existingCategory !== null &&
              (!sql.includes('"is_archived"') || !mocks.existingCategory.isArchived) &&
              (!sql.includes('"is_income"') || !mocks.existingCategory.isIncome) &&
              (!sql.includes('"is_system_fee"') || !mocks.existingCategory.isSystemFee);
            return {
              limit: vi.fn().mockResolvedValue(
                hasNameMatch && categoryMatches ? [mocks.existingCategory] : [],
              ),
            };
          }),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values) => {
          mocks.insertValues(values);
          const isCategoryInsert = "name" in values && "isSystemFee" in values;
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([]),
            })),
            returning: vi.fn().mockResolvedValue(
              isCategoryInsert
                ? [{ id: "created-category", ...values }]
                : "type" in values
                  ? [{ id: "parent-transaction", ...values }]
                  : [{ id: "transaction-leg", ...values }],
            ),
          };
        }),
      })),
      update: mocks.update,
    };
    mocks.update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    });
    mocks.transaction.mockImplementation((callback) => callback(tx));
  });

  it("accepts and trims a new category name for offline transaction sync", () => {
    const parsed = CompoundTransactionSchema.parse(expense);
    expect(parsed.category_name).toBe("Pet Care");
  });

  it("rejects blank or overlong category names", () => {
    expect(CompoundTransactionSchema.safeParse({ ...expense, category_name: "   " }).success).toBe(false);
    expect(CompoundTransactionSchema.safeParse({ ...expense, category_name: "x".repeat(101) }).success).toBe(false);
  });

  it.each([
    { label: "system fee", isIncome: false, isSystemFee: true, isArchived: false },
    { label: "archived", isIncome: false, isSystemFee: false, isArchived: true },
    { label: "income", isIncome: true, isSystemFee: false, isArchived: false },
  ])("rejects a name collision with a $label category atomically", async ({ label, ...flags }) => {
    mocks.existingCategory = { id: "protected-category", name: "Pet Care", ...flags };

    const response = await createCompoundTransaction(request(expense));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unable to resolve expense category." });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.selectWhere).toHaveBeenCalledOnce();
    const { sql, params } = new PgDialect().sqlToQuery(mocks.selectWhere.mock.calls[0][0]);
    expect(sql).toContain('"name"');
    expect(params).toContain("Pet Care");
    expect(mocks.insertValues).toHaveBeenCalledOnce(); // attempted category insert only
    expect(mocks.insertValues.mock.calls[0][0]).toMatchObject({ name: "Pet Care" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("reuses an existing active expense category", async () => {
    mocks.existingCategory = {
      id: "active-category",
      name: "Pet Care",
      isIncome: false,
      isSystemFee: false,
      isArchived: false,
    };

    const response = await createCompoundTransaction(request(expense));

    expect(response.status).toBe(201);
    const { sql, params } = new PgDialect().sqlToQuery(mocks.selectWhere.mock.calls[0][0]);
    expect(sql).toContain('"name"');
    expect(params).toContain("Pet Care");
    expect(mocks.insertValues).toHaveBeenCalledTimes(4);
    expect(mocks.insertValues.mock.calls[1][0]).toMatchObject({ type: "expense" });
    expect(mocks.insertValues.mock.calls[3][0]).toMatchObject({ categoryId: "active-category" });
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
