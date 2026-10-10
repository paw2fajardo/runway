import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "../../db";
import { billInstances, bills, projectionSettings } from "../../db/schema";
import { DEFAULT_BILL_REMINDER_TIME } from "../types";
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
  listBillsDue(today: string, tomorrow: string): Promise<RemindableBill[]>;
  listPastDueBills(today: string): Promise<RemindableBill[]>;
}

const databaseBillNtfyStore: BillNtfyStore = {
  ...databaseNtfyDeliveryStore,
  async getReminderTime() {
    const [settings] = await db.select({ billReminderTime: projectionSettings.billReminderTime })
      .from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    return settings?.billReminderTime ?? DEFAULT_BILL_REMINDER_TIME;
  },
  async listBillsDue(today, tomorrow) {
    return db.select({ id: billInstances.id, dueDate: billInstances.dueDate, name: bills.name, amount: billInstances.amountDue })
      .from(billInstances).innerJoin(bills, eq(billInstances.billId, bills.id)).where(and(
        eq(bills.isActive, true),
        inArray(billInstances.dueDate, [today, tomorrow]),
        inArray(billInstances.status, ["upcoming", "due_today", "grace_period", "past_due"]),
      ));
  },
  async listPastDueBills(today) {
    return db.select({ id: billInstances.id, dueDate: billInstances.dueDate, name: bills.name, amount: billInstances.amountDue })
      .from(billInstances).innerJoin(bills, eq(billInstances.billId, bills.id)).where(and(
        eq(bills.isActive, true),
        inArray(billInstances.status, ["upcoming", "due_today", "grace_period", "past_due"]),
        lt(billInstances.dueDate, today),
      ));
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

/** Send daily reminders for bills due today, tomorrow, and already past due. */
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
  if (manilaClockTime(now) < await store.getReminderTime()) return 0;
  const tomorrow = addCalendarDay(today);
  const [dueBills, pastDueBills] = await Promise.all([
    store.listBillsDue(today, tomorrow),
    store.listPastDueBills(today),
  ]);
  const dueToday = dueBills.filter(bill => bill.dueDate === today);
  const dueTomorrow = dueBills.filter(bill => bill.dueDate === tomorrow);
  const count = dueToday.length + dueTomorrow.length + pastDueBills.length;
  if (count) {
    const message = [
      ...formatGroup("Due today", dueToday),
      ...formatGroup("Due tomorrow", dueTomorrow),
      ...formatGroup("Past due", pastDueBills, true),
    ].join("\n");
    await store.queue(`bill-digest:${today}`, `Runway bill reminders (${count})`, message);
  }
  return deliverQueuedNtfyNotifications({ ...options, sender, store });
}

export type { BillNtfyStore };
