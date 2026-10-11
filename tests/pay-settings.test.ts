import { describe, expect, it } from "vitest";
import { BILL_NOTIFICATION_ALERTS, BillNotificationSchedulesSettingsSchema, BillReminderTimeSettingsSchema,
  PaySettingsSchema, resolveBillNotificationSchedules } from "../src/lib/types";
describe("Pay settings validation", () => {
  it("preserves the old reminder time and treats an empty saved list as disabled", () => {
    expect(resolveBillNotificationSchedules({ billReminderTime: "18:45" })).toEqual([
      { time: "18:45", alerts: [...BILL_NOTIFICATION_ALERTS] },
    ]);
    expect(resolveBillNotificationSchedules({ billNotificationSchedules: [] })).toEqual([]);
    expect(() => resolveBillNotificationSchedules({ billNotificationSchedules: [{ time: "bad", alerts: [] }] })).toThrow();
  });
  it("accepts multiple times with different alert selections", () => {
    expect(BillNotificationSchedulesSettingsSchema.safeParse({ bill_notification_schedules: [
      { time: "09:00", alerts: ["past_due", "due_today"] },
      { time: "18:00", alerts: ["due_tomorrow", "until_payday"] },
    ] }).success).toBe(true);
  });
  it.each([
    [{ time: "24:00", alerts: ["past_due"] }],
    [{ time: "09:00", alerts: [] }],
    [{ time: "09:00", alerts: ["unknown"] }],
    [{ time: "09:00", alerts: ["past_due", "past_due"] }],
    [{ time: "09:00", alerts: ["past_due"], unknown: true }],
    [{ time: "09:00", alerts: ["past_due"] }, { time: "09:00", alerts: ["due_today"] }],
    Array.from({ length: 9 }, (_, i) => ({ time: `${String(i).padStart(2, "0")}:00`, alerts: ["past_due"] })),
  ])("rejects invalid schedules before persistence: %j", (...schedules) => {
    expect(BillNotificationSchedulesSettingsSchema.safeParse({ bill_notification_schedules: schedules }).success).toBe(false);
  });
  it.each(["00:00", "09:30", "23:59"])("accepts bill reminder time %s", time => {
    expect(BillReminderTimeSettingsSchema.safeParse({ bill_reminder_time: time }).success).toBe(true);
  });
  it.each(["24:00", "9:00", "12:60", "12:30:00", "invalid"])("rejects invalid bill reminder time %s", time => {
    expect(BillReminderTimeSettingsSchema.safeParse({ bill_reminder_time: time }).success).toBe(false);
  });
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

