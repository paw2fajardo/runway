import { describe, expect, it } from "vitest";
import { PaySettingsSchema } from "../src/lib/types";
describe("Pay settings validation", () => {
  it.each([undefined, 0, -1, 1.5, 367, "7"])("rejects invalid custom interval %s", interval => {
    expect(PaySettingsSchema.safeParse({ net_pay_cents: 100, next_pay_date: "2026-10-15", schedule_kind: "custom", interval_days: interval }).success).toBe(false);
  });
  it.each([1, 366])("accepts custom interval boundary %s", interval => {
    expect(PaySettingsSchema.safeParse({ net_pay_cents: 100, next_pay_date: "2026-10-15", schedule_kind: "custom", interval_days: interval }).success).toBe(true);
  });
  it("rejects unknown kinds and irrelevant intervals", () => {
    expect(PaySettingsSchema.safeParse({ net_pay_cents: 100, next_pay_date: "2026-10-15", schedule_kind: "daily" }).success).toBe(false);
    expect(PaySettingsSchema.safeParse({ net_pay_cents: 100, next_pay_date: "2026-10-15", schedule_kind: "monthly", interval_days: 30 }).success).toBe(false);
  });
  it("accepts net take-home cents and a real date", () => {
    expect(PaySettingsSchema.parse({ net_pay_cents: 123456, next_pay_date: "2028-02-29" })).toEqual({ net_pay_cents: 123456, next_pay_date: "2028-02-29" });
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "12345"])("rejects invalid cents %s", (amount) => {
    expect(PaySettingsSchema.safeParse({ net_pay_cents: amount, next_pay_date: "2026-10-15" }).success).toBe(false);
  });
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2026-1-01", "2026-10-15T00:00:00Z", "invalid"])("rejects invalid date %s", (date) => {
    expect(PaySettingsSchema.safeParse({ net_pay_cents: 123456, next_pay_date: date }).success).toBe(false);
  });
});

