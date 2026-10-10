import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { ntfyDeliveries, paycheckOccurrences } from "../db/schema";

export interface NtfySender {
  send(title: string, message: string): Promise<void>;
}

export interface NtfyDeliveryStore {
  listPaydayOccurrences(): Promise<Array<{ id: string; accountName: string | null }>>;
  queue(notificationKey: string, title: string, message: string): Promise<void>;
  dueDeliveries(now: Date): Promise<Array<{
    id: string;
    title: string;
    message: string;
    attemptCount: number;
  }>>;
  finishAttempt(id: string, status: "sent" | "retryable", now: Date, nextAttemptAt: Date | null, error: string | null): Promise<void>;
}

const databaseNtfyDeliveryStore: NtfyDeliveryStore = {
  async listPaydayOccurrences() {
    return db.select({
      id: paycheckOccurrences.id,
      accountName: paycheckOccurrences.accountNameSnapshot,
    }).from(paycheckOccurrences).where(and(
      eq(paycheckOccurrences.status, "pending_confirmation"),
      sql`${paycheckOccurrences.transactionId} IS NOT NULL`,
    ));
  },
  async queue(notificationKey, title, message) {
    await db.insert(ntfyDeliveries).values({ notificationKey, title, message }).onConflictDoNothing({
      target: ntfyDeliveries.notificationKey,
    });
  },
  async dueDeliveries(now) {
    return db.select({
      id: ntfyDeliveries.id,
      title: ntfyDeliveries.title,
      message: ntfyDeliveries.message,
      attemptCount: ntfyDeliveries.attemptCount,
    }).from(ntfyDeliveries).where(and(
      or(eq(ntfyDeliveries.status, "pending"), eq(ntfyDeliveries.status, "retryable")),
      or(isNull(ntfyDeliveries.nextAttemptAt), lte(ntfyDeliveries.nextAttemptAt, now)),
    ));
  },
  async finishAttempt(id, status, now, nextAttemptAt, error) {
    await db.update(ntfyDeliveries).set({
      status,
      attemptCount: sql`${ntfyDeliveries.attemptCount} + 1`,
      lastAttemptAt: now,
      nextAttemptAt,
      deliveredAt: status === "sent" ? now : null,
      lastError: error?.slice(0, 500) ?? null,
      updatedAt: now,
    }).where(eq(ntfyDeliveries.id, id));
  },
};

export function configuredNtfySender(env: NodeJS.ProcessEnv = process.env): NtfySender | null {
  const serverValue = env.NTFY_SERVER_URL?.trim();
  const topic = env.NTFY_TOPIC?.trim();
  if (!serverValue || !topic) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) throw new Error("NTFY_TOPIC must contain 1 to 64 letters, numbers, underscores, or hyphens.");

  const server = new URL(serverValue);
  if ((server.protocol !== "https:" && server.protocol !== "http:") || server.username || server.password || server.search || server.hash) {
    throw new Error("NTFY_SERVER_URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }
  const endpoint = new URL(encodeURIComponent(topic), server.href.endsWith("/") ? server : `${server.href}/`);
  const token = env.NTFY_TOKEN?.trim();

  return {
    async send(title, message) {
      const headers = new Headers({ Title: title, "Content-Type": "text/plain; charset=utf-8" });
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(endpoint, { method: "POST", headers, body: message, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}`);
    },
  };
}

function retryAt(now: Date, attempt: number): Date {
  return new Date(now.getTime() + Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.min(attempt, 10))));
}

export async function deliverNtfyPaydayNotifications(options: {
  store?: NtfyDeliveryStore;
  sender?: NtfySender | null;
  now?: Date;
} = {}): Promise<number> {
  const sender = options.sender === undefined ? configuredNtfySender() : options.sender;
  if (!sender) return 0;
  const store = options.store ?? databaseNtfyDeliveryStore;
  const occurrences = await store.listPaydayOccurrences();

  for (const occurrence of occurrences) {
    const accountName = occurrence.accountName ?? "your linked account";
    await store.queue(`payday:${occurrence.id}`, "Paycheck deposited", `A paycheck was added to ${accountName}. Confirm when it arrives.`);
  }
  return deliverQueuedNtfyNotifications({ ...options, sender, store });
}

export async function deliverQueuedNtfyNotifications(options: {
  store?: NtfyDeliveryStore;
  sender?: NtfySender | null;
  now?: Date;
} = {}): Promise<number> {
  const sender = options.sender === undefined ? configuredNtfySender() : options.sender;
  if (!sender) return 0;
  const store = options.store ?? databaseNtfyDeliveryStore;
  const now = options.now ?? new Date();
  const deliveries = await store.dueDeliveries(now);
  let sent = 0;
  for (const delivery of deliveries) {
    let status: "sent" | "retryable" = "retryable";
    let error: string | null = null;
    let nextAttemptAt: Date | null = retryAt(now, delivery.attemptCount);
    try {
      await sender.send(delivery.title, delivery.message);
      status = "sent";
      nextAttemptAt = null;
      sent += 1;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "ntfy request failed";
    }
    await store.finishAttempt(delivery.id, status, now, nextAttemptAt, error);
  }
  return sent;
}

export { databaseNtfyDeliveryStore };
