import { describe, expect, it } from "vitest";
import { CompoundTransactionSchema } from "../src/lib/types";

const expense = {
  type: "expense",
  description: "New category expense",
  source_account_id: "550e8400-e29b-41d4-a716-446655440000",
  gross_outflow: 12500,
  category_name: "  Pet Care  ",
};

describe("Quick log category sync contract", () => {
  it("accepts and trims a new category name for offline transaction sync", () => {
    const parsed = CompoundTransactionSchema.parse(expense);

    expect(parsed.category_name).toBe("Pet Care");
  });

  it("rejects blank or overlong category names", () => {
    expect(CompoundTransactionSchema.safeParse({ ...expense, category_name: "   " }).success).toBe(false);
    expect(CompoundTransactionSchema.safeParse({ ...expense, category_name: "x".repeat(101) }).success).toBe(false);
  });
});
