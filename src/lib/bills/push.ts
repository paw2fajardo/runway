import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { billInstances, billPushDeliveries, bills, projectionSettings, pushSubscriptions } from "../../db/schema";
import { manilaDate } from "../payday/occurrences";
import { DEFAULT_BILL_REMINDER_TIME } from "../types";
import {
  configuredPushSender,
  type PushSender,
  type StoredPushSubscription,
} from "../payday/push";

type RemindableBill = { id: string; dueDate: string; name: string; amount: number };

interface BillPushDeliveryStore {
  getReminderTime(): Promise<string>;
  listRemindableBills(today: string, tomorrow: string): Promise<RemindableBill[]>;
  listSubscriptions(): Promise<StoredPushSubscription[]>;
  queue(instanceId: string, subscriptionId: string, endpointHash: string, reminderDate: string): Promise<void>;
  dueDeliveries(now: Date): Promise<Array<{
    id: string; instanceId: string; endpointHash: string; endpoint: string;
    p256dh: string; auth: string; dueDate: string; name: string; amount: number;
    attemptCount: number;
  }>>;
  finishAttempt(id: string, status: "sent" | "retryable" | "expired", now: Date, nextAttemptAt: Date | null, error: string | null): Promise<void>;
  removeSubscription(hash: string): Promise<void>;
}

const databaseBillPushDeliveryStore: BillPushDeliveryStore = {
  async getReminderTime() {
    const [settings] = await db.select({ billReminderTime: projectionSettings.billReminderTime })
      .from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    return settings?.billReminderTime ?? DEFAULT_BILL_REMINDER_TIME;
  },
  async listRemindableBills(today, tomorrow) {
    return db.select({
      id: billInstances.id,
      dueDate: billInstances.dueDate,
      name: bills.name,
      amount: billInstances.amountDue,
    }).from(billInstances)
      .innerJoin(bills, eq(billInstances.billId, bills.id))
      .where(and(
        eq(bills.isActive, true),
        gte(billInstances.dueDate, today),
        lte(billInstances.dueDate, tomorrow),
        inArray(billInstances.status, ["upcoming", "due_today", "grace_period", "past_due"]),
      ));
  },
  async listSubscriptions() {
    const rows = await db.select().from(pushSubscriptions);
    return rows.map(row => ({
      id: row.id, ownerId: row.ownerId, endpointHash: row.endpointHash,
      endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth },
    }));
  },
  async queue(instanceId, subscriptionId, hash, reminderDate) {
    await db.insert(billPushDeliveries).values({
      billInstanceId: instanceId,
      subscriptionId,
      endpointHashSnapshot: hash,
      reminderDate,
    }).onConflictDoNothing({ target: [
      billPushDeliveries.billInstanceId,
      billPushDeliveries.endpointHashSnapshot,
      billPushDeliveries.reminderDate,
    ] });
  },
  async dueDeliveries(now) {
    const rows = await db.select({
      id: billPushDeliveries.id,
      instanceId: billPushDeliveries.billInstanceId,
      endpointHash: billPushDeliveries.endpointHashSnapshot,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      dueDate: billInstances.dueDate,
      name: bills.name,
      amount: billInstances.amountDue,
      attemptCount: billPushDeliveries.attemptCount,
    }).from(billPushDeliveries)
      .innerJoin(pushSubscriptions, eq(billPushDeliveries.subscriptionId, pushSubscriptions.id))
      .innerJoin(billInstances, eq(billPushDeliveries.billInstanceId, billInstances.id))
      .innerJoin(bills, eq(billInstances.billId, bills.id))
      .where(and(
        eq(bills.isActive, true),
        inArray(billInstances.status, ["upcoming", "due_today", "grace_period", "past_due"]),
        or(eq(billPushDeliveries.status, "pending"), eq(billPushDeliveries.status, "retryable")),
        or(isNull(billPushDeliveries.nextAttemptAt), lte(billPushDeliveries.nextAttemptAt, now)),
      ));
    return rows;
  },
  async finishAttempt(id, status, now, nextAttemptAt, error) {
    await db.update(billPushDeliveries).set({
      status,
      attemptCount: sql`${billPushDeliveries.attemptCount} + 1`,
      lastAttemptAt: now,
      nextAttemptAt,
      deliveredAt: status === "sent" ? now : null,
      lastError: error?.slice(0, 500) ?? null,
      updatedAt: now,
    }).where(eq(billPushDeliveries.id, id));
  },
  async removeSubscription(hash) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, hash));
  },
};

function retryAt(now: Date, attempt: number): Date {
  return new Date(now.getTime() + Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.min(attempt, 10))));
}

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

/** Deliver once for bills due today and tomorrow, using the owner's Manila date. */
export async function deliverDueBillNotifications(options: {
  store?: BillPushDeliveryStore; sender?: PushSender | null; now?: Date;
} = {}): Promise<number> {
  const sender = options.sender === undefined ? configuredPushSender() : options.sender;
  if (!sender) return 0;
  const store = options.store ?? databaseBillPushDeliveryStore;
  const now = options.now ?? new Date();
  const today = manilaDate(now);
  const reminderTime = await store.getReminderTime();
  if (manilaClockTime(now) < reminderTime) return 0;
  const tomorrow = addCalendarDay(today);
  const [remindableBills, subscriptions] = await Promise.all([
    store.listRemindableBills(today, tomorrow),
    store.listSubscriptions(),
  ]);
  if (!remindableBills.length || !subscriptions.length) return 0;

  for (const bill of remindableBills) {
    for (const subscription of subscriptions) {
      await store.queue(bill.id, subscription.id, subscription.endpointHash, today);
    }
  }

  const deliveries = await store.dueDeliveries(now);
  let sent = 0;
  for (const delivery of deliveries) {
    const dueToday = delivery.dueDate === today;
    const payload = JSON.stringify({
      title: dueToday ? "Bill due today" : "Bill due tomorrow",
      body: `${delivery.name} · PHP ${(delivery.amount / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      url: "/bills",
    });
    let status: "sent" | "retryable" | "expired" = "retryable";
    let errorMessage: string | null = null;
    let nextAttempt: Date | null = retryAt(now, delivery.attemptCount);
    try {
      const response = await sender.send({ endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } }, payload);
      if (!response.statusCode || (response.statusCode >= 200 && response.statusCode < 300)) {
        status = "sent"; nextAttempt = null; sent += 1;
      } else if (response.statusCode === 404 || response.statusCode === 410) {
        status = "expired"; nextAttempt = null;
        await store.removeSubscription(delivery.endpointHash);
      } else {
        errorMessage = `Push service returned ${response.statusCode}`;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Push service request failed";
    }
    await store.finishAttempt(delivery.id, status, now, nextAttempt, errorMessage);
  }
  return sent;
}

export type { BillPushDeliveryStore };
