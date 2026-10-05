import { describe, expect, it } from "vitest";
import { CategoryCreateSchema, CategoryPatchSchema, DailyDiscretionaryBurnSchema, PaySettingsSchema } from "../src/lib/types";

describe("category settings validation", () => {
  it("trims category names and defaults categories to expenses", () => {
    expect(CategoryCreateSchema.parse({ name: "  Groceries  " })).toEqual({ name: "Groceries", is_income: false });
  });

  it.each(["", "   ", "x".repeat(101)])("rejects invalid category names", name => {
    expect(CategoryCreateSchema.safeParse({ name }).success).toBe(false);
  });

  it("allows category rename, retype, archive, and restore fields", () => {
    expect(CategoryPatchSchema.parse({ name: " Food ", is_income: true, is_archived: false })).toEqual({ name: "Food", is_income: true, is_archived: false });
    expect(CategoryPatchSchema.safeParse({}).success).toBe(false);
  });

  it("does not allow callers to set or change system fee identity", () => {
    expect(CategoryCreateSchema.safeParse({ name: "Fees", is_system_fee: true }).success).toBe(false);
    expect(CategoryPatchSchema.safeParse({ is_system_fee: false }).success).toBe(false);
  });

  it("validates nonnegative daily burn in whole cents", () => {
    expect(PaySettingsSchema.safeParse({ net_pay_cents: 1000, next_pay_date: "2026-10-15", daily_discretionary_burn_cents: 0 }).success).toBe(true);
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "100"]) {
      expect(PaySettingsSchema.safeParse({ net_pay_cents: 1000, next_pay_date: "2026-10-15", daily_discretionary_burn_cents: value }).success).toBe(false);
    }
  });

  it("accepts an independent daily allowance update without pay amount or date", () => {
    expect(DailyDiscretionaryBurnSchema.parse({ daily_discretionary_burn_cents: 50000 })).toEqual({ daily_discretionary_burn_cents: 50000 });
    expect(DailyDiscretionaryBurnSchema.safeParse({ daily_discretionary_burn_cents: 50000, net_pay_cents: 1000 }).success).toBe(false);
    expect(DailyDiscretionaryBurnSchema.safeParse({ daily_discretionary_burn_cents: -1 }).success).toBe(false);
  });
});
