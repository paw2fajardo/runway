import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "../../db";
import { billInstances, bills, incomeStreams, projectionSettings } from "../../db/schema";
import { BILL_NOTIFICATION_ALERTS, BillNotificationSchedulesSchema, DEFAULT_BILL_REMINDER_TIME,
  type BillNotificationSchedule } from "../types";
import { getNextPaydayDate } from "../runway";
import {
  configuredNtfySender,
  databaseNtfyDeliveryStore,
  deliverQueuedNtfyNotifications,
  type NtfyDeliveryStore,
  type NtfySender,
} from "../ntfy";
import { manilaDate } from "../payday/occurrences";

type RemindableBill = { id: string; dueDate: string; name: string; amount: number };

interface BillNtfyStore extends NtfyDeliveryStore {
  getReminderTime(): Promise<string>;
  getSchedules(): Promise<BillNotificationSchedule[] | null>;
  getNextPayday(today: string): Promise<string | null>;
  listBillsDue(today: string, through: string): Promise<RemindableBill[]>;
  listPastDueBills(today: string): Promise<RemindableBill[]>;
}

const databaseBillNtfyStore: BillNtfyStore = {
  ...databaseNtfyDeliveryStore,
  async getSchedules() {
    const [settings] = await db.select({ schedules: projectionSettings.billNotificationSchedules })
      .from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    return settings?.schedules == null ? null : BillNotificationSchedulesSchema.parse(settings.schedules);
  },
  async getReminderTime() {
    const [settings] = await db.select({ billReminderTime: projectionSettings.billReminderTime })
      .from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    return settings?.billReminderTime ?? DEFAULT_BILL_REMINDER_TIME;
  },
  async getNextPayday(today) {
    const [settings] = await db.select({ id: projectionSettings.id })
      .from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    if (!settings) return null;
    const streams = await db.select().from(incomeStreams).where(and(
      eq(incomeStreams.projectionSettingsId, settings.id), eq(incomeStreams.isEnabled, true),
    ));
    // Use the Manila civil date even when the worker runs in UTC.
    const reference = new Date(`${today}T00:00:00`);
    return streams.map(stream => getNextPaydayDate(reference, stream.salaryCycleDays,
      stream.paydayAnchor, stream.scheduleKind, stream.intervalDays)).sort()[0] ?? null;
  },
  async listBillsDue(today, through) {
    return db.select({ id: billInstances.id, dueDate: billInstances.dueDate, name: bills.name, amount: billInstances.amountDue })
      .from(billInstances).innerJoin(bills, eq(billInstances.billId, bills.id)).where(and(
        eq(bills.isActive, true),
        gte(billInstances.dueDate, today),
        lte(billInstances.dueDate, through),
        inArray(billInstances.status, ["upcoming", "due_today", "grace_period", "past_due"]),
      )).orderBy(billInstances.dueDate, bills.name);
  },
  async listPastDueBills(today) {
    return db.select({ id: billInstances.id, dueDate: billInstances.dueDate, name: bills.name, amount: billInstances.amountDue })
      .from(billInstances).innerJoin(bills, eq(billInstances.billId, bills.id)).where(and(
        eq(bills.isActive, true),
        inArray(billInstances.status, ["upcoming", "due_today", "grace_period", "past_due"]),
        lt(billInstances.dueDate, today),
      )).orderBy(billInstances.dueDate, bills.name);
  },
};

function addCalendarDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function manilaClockTime(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
}

function formatAmount(amount: number): string {
  return `PHP ${(amount / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatGroup(title: string, bills: RemindableBill[], includeDate = false): string[] {
  if (!bills.length) return [];
  const lines = [`${title} (${bills.length})`, ...bills.slice(0, 5).map(bill =>
    `• ${bill.name}${includeDate ? ` — due ${bill.dueDate}` : ""} · ${formatAmount(bill.amount)}`,
  )];
  if (bills.length > 5) lines.push(`+ ${bills.length - 5} more`);
  return lines;
}

/** Send each configured daily digest once, with only its selected alerts. */
export async function deliverBillNtfyNotifications(options: {
  store?: BillNtfyStore;
  sender?: NtfySender | null;
  now?: Date;
} = {}): Promise<number> {
  const store = options.store ?? databaseBillNtfyStore;
  const now = options.now ?? new Date();
  const sender = options.sender === undefined ? configuredNtfySender() : options.sender;
  if (!sender) return 0;

  const today = manilaDate(now);
  const savedSchedules = await store.getSchedules();
  const schedules = savedSchedules ?? [{ time: await store.getReminderTime(), alerts: [...BILL_NOTIFICATION_ALERTS] }];
  const dueSchedules = schedules.filter(schedule => schedule.time <= manilaClockTime(now));
  if (!dueSchedules.length) return 0;
  const tomorrow = addCalendarDay(today);
  const payday = dueSchedules.some(schedule => schedule.alerts.includes("until_payday"))
    ? await store.getNextPayday(today) : null;
  const through = payday && payday > tomorrow ? payday : tomorrow;
  const [dueBills, pastDueBills] = await Promise.all([
    store.listBillsDue(today, through),
    store.listPastDueBills(today),
  ]);
  for (const schedule of dueSchedules) {
    const dueToday = schedule.alerts.includes("due_today") ? dueBills.filter(bill => bill.dueDate === today) : [];
    const dueTomorrow = schedule.alerts.includes("due_tomorrow") ? dueBills.filter(bill => bill.dueDate === tomorrow) : [];
    const pastDue = schedule.alerts.includes("past_due") ? pastDueBills : [];
    const alreadyListed = new Set([...dueToday, ...dueTomorrow].map(bill => bill.id));
    const untilPayday = schedule.alerts.includes("until_payday")
      ? dueBills.filter(bill => payday && bill.dueDate <= payday && !alreadyListed.has(bill.id)) : [];
    const count = dueToday.length + dueTomorrow.length + pastDue.length + untilPayday.length;
    if (!count) continue;
    const message = [
      ...formatGroup("Due today", dueToday),
      ...formatGroup("Due tomorrow", dueTomorrow),
      ...formatGroup("Past due", pastDue, true),
      ...formatGroup(`Until payday (${payday})`, untilPayday, true),
    ].join("\n");
    const key = savedSchedules === null ? `bill-digest:${today}` : `bill-digest:${today}:${schedule.time}`;
    await store.queue(key, `Runway bill reminders (${count})`, message);
  }
  return deliverQueuedNtfyNotifications({ ...options, sender, store });
}

export type { BillNtfyStore };
