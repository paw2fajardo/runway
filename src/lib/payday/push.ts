import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import webPush from "web-push";
import { db } from "../../db";
import type { Owner } from "../auth/session";
import {
  paycheckOccurrences,
  paycheckPushDeliveries,
  pushSubscriptions,
} from "../../db/schema";

export interface PushKeys { p256dh: string; auth: string }
export interface ValidPushSubscription { endpoint: string; keys: PushKeys }
export interface StoredPushSubscription extends ValidPushSubscription {
  id: string;
  ownerId: number;
  endpointHash: string;
}

const ENDPOINT_MAX = 2048;

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

export function isAllowedPushEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:" || endpoint.port !== "" || endpoint.username || endpoint.password || endpoint.hash) return false;
    const hostname = endpoint.hostname.toLowerCase();
    if (isIpLiteral(hostname)) return false;
    return hostname === "fcm.googleapis.com" ||
      hostname === "web.push.apple.com" ||
      hostname === "push.services.mozilla.com" ||
      hostname === "updates.push.services.mozilla.com" ||
      /^wns\d+(?:-[a-z0-9-]+)?\.notify\.windows\.com$/.test(hostname);
  } catch { return false; }
}

export function parsePushSubscription(value: unknown): ValidPushSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > ENDPOINT_MAX) return null;
  if (!isAllowedPushEndpoint(candidate.endpoint)) return null;
  if (!candidate.keys || typeof candidate.keys !== "object" || Array.isArray(candidate.keys)) return null;
  const keys = candidate.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || !/^[A-Za-z0-9_-]{40,256}$/.test(keys.p256dh) ||
      typeof keys.auth !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(keys.auth)) return null;
  return { endpoint: candidate.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export interface PushSubscriptionStore {
  save(ownerId: number, subscription: ValidPushSubscription, hash: string): Promise<void>;
  remove(ownerId: number, hash: string): Promise<void>;
}

export const databasePushSubscriptionStore: PushSubscriptionStore = {
  async save(ownerId, subscription, hash) {
    await db.insert(pushSubscriptions).values({
      ownerId, endpoint: subscription.endpoint, endpointHash: hash,
      p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
    }).onConflictDoUpdate({
      target: pushSubscriptions.endpointHash,
      set: {
        ownerId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth, updatedAt: new Date(),
      },
    });
  },
  async remove(ownerId, hash) {
    await db.delete(pushSubscriptions).where(and(
      eq(pushSubscriptions.ownerId, ownerId), eq(pushSubscriptions.endpointHash, hash),
    ));
  },
};

const MAX_SUBSCRIPTION_BODY_BYTES = 4096;

function parseEndpoint(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const endpoint = (value as Record<string, unknown>).endpoint;
  if (typeof endpoint !== "string" || endpoint.length > ENDPOINT_MAX) return null;
  return isAllowedPushEndpoint(endpoint) ? endpoint : null;
}

type BoundedBody = { ok: true; text: string } | { ok: false; status: 400 | 413 };

async function readBoundedBody(request: Request): Promise<BoundedBody> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, status: 400 };
    if (Number(contentLength) > MAX_SUBSCRIPTION_BODY_BYTES) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SUBSCRIPTION_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(body) };
}

export interface PushSubscriptionRouteDependencies {
  authenticate(request: Request): Promise<Owner | Response>;
  sameOrigin(request: Request): Response | null;
  store: PushSubscriptionStore;
  publicKey: string | null;
}

export function createPushSubscriptionHandlers(deps: PushSubscriptionRouteDependencies) {
  return {
    async GET(request: Request): Promise<Response> {
      const owner = await deps.authenticate(request);
      if (owner instanceof Response) return owner;
      return Response.json({ publicKey: deps.publicKey });
    },
    async POST(request: Request): Promise<Response> {
      const originError = deps.sameOrigin(request);
      if (originError) return originError;
      const owner = await deps.authenticate(request);
      if (owner instanceof Response) return owner;
      const body = await readBoundedBody(request);
      if (!body.ok) return Response.json({ error: body.status === 413 ? "Subscription is too large." : "Invalid subscription." }, { status: body.status });
      let value: unknown;
      try { value = JSON.parse(body.text); } catch { return Response.json({ error: "Invalid subscription." }, { status: 400 }); }
      const subscription = parsePushSubscription(value);
      if (!subscription) return Response.json({ error: "Invalid push subscription." }, { status: 400 });
      try {
        await deps.store.save(owner.id, subscription, endpointHash(subscription.endpoint));
        return Response.json({ saved: true }, { status: 201 });
      } catch {
        return Response.json({ error: "Unable to save push subscription." }, { status: 503 });
      }
    },
    async DELETE(request: Request): Promise<Response> {
      const originError = deps.sameOrigin(request);
      if (originError) return originError;
      const owner = await deps.authenticate(request);
      if (owner instanceof Response) return owner;
      const body = await readBoundedBody(request);
      if (!body.ok) return Response.json({ error: body.status === 413 ? "Subscription is too large." : "Invalid subscription." }, { status: body.status });
      let value: unknown;
      try { value = JSON.parse(body.text); } catch { return Response.json({ error: "Invalid subscription." }, { status: 400 }); }
      const endpoint = parseEndpoint(value);
      if (!endpoint) return Response.json({ error: "Invalid push endpoint." }, { status: 400 });
      try {
        await deps.store.remove(owner.id, endpointHash(endpoint));
        return Response.json({ removed: true });
      } catch {
        return Response.json({ error: "Unable to remove push subscription." }, { status: 503 });
      }
    },
  };
}

export interface PushSender {
  send(subscription: ValidPushSubscription, payload: string): Promise<{ statusCode?: number }>;
}

export interface PushDeliveryStore {
  listPendingOccurrences(): Promise<Array<{ id: string; description: string }>>;
  listSubscriptions(): Promise<StoredPushSubscription[]>;
  queue(occurrenceId: string, subscriptionId: string, hash: string): Promise<void>;
  dueDeliveries(now: Date): Promise<Array<{
    id: string; occurrenceId: string; endpointHash: string; endpoint: string;
    p256dh: string; auth: string; description: string; attemptCount: number;
  }>>;
  finishAttempt(id: string, status: "sent" | "retryable" | "expired", now: Date, nextAttemptAt: Date | null, error: string | null): Promise<void>;
  removeSubscription(hash: string): Promise<void>;
}

export const databasePushDeliveryStore: PushDeliveryStore = {
  async listPendingOccurrences() {
    const rows = await db.select({ id: paycheckOccurrences.id, description: paycheckOccurrences.accountNameSnapshot })
      .from(paycheckOccurrences)
      .where(and(
        eq(paycheckOccurrences.status, "pending_confirmation"),
        isNotNull(paycheckOccurrences.transactionId),
      ));
    return rows.map(row => ({ id: row.id, description: row.description ?? "your linked account" }));
  },
  async listSubscriptions() {
    const rows = await db.select().from(pushSubscriptions);
    return rows.map(row => ({
      id: row.id, ownerId: row.ownerId, endpointHash: row.endpointHash,
      endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth },
    }));
  },
  async queue(occurrenceId, subscriptionId, hash) {
    await db.insert(paycheckPushDeliveries).values({
      occurrenceId, subscriptionId, endpointHashSnapshot: hash,
    }).onConflictDoNothing();
  },
  async dueDeliveries(now) {
    const rows = await db.select({
      id: paycheckPushDeliveries.id,
      occurrenceId: paycheckPushDeliveries.occurrenceId,
      endpointHash: paycheckPushDeliveries.endpointHashSnapshot,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      endpoint: pushSubscriptions.endpoint,
      description: paycheckOccurrences.accountNameSnapshot,
      attemptCount: paycheckPushDeliveries.attemptCount,
    }).from(paycheckPushDeliveries)
      .innerJoin(pushSubscriptions, eq(paycheckPushDeliveries.subscriptionId, pushSubscriptions.id))
      .innerJoin(paycheckOccurrences, eq(paycheckPushDeliveries.occurrenceId, paycheckOccurrences.id))
      .where(and(
        eq(paycheckOccurrences.status, "pending_confirmation"),
        isNotNull(paycheckOccurrences.transactionId),
        or(eq(paycheckPushDeliveries.status, "pending"), eq(paycheckPushDeliveries.status, "retryable")),
        or(isNull(paycheckPushDeliveries.nextAttemptAt), lte(paycheckPushDeliveries.nextAttemptAt, now)),
      ));
    return rows.map(row => ({ ...row, description: row.description ?? "your linked account" }));
  },
  async finishAttempt(id, status, now, nextAttemptAt, error) {
    await db.update(paycheckPushDeliveries).set({
      status, attemptCount: sql`${paycheckPushDeliveries.attemptCount} + 1`,
      lastAttemptAt: now, nextAttemptAt, deliveredAt: status === "sent" ? now : null,
      lastError: error?.slice(0, 500) ?? null, updatedAt: now,
    }).where(eq(paycheckPushDeliveries.id, id));
  },
  async removeSubscription(hash) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, hash));
  },
};

function retryAt(now: Date, attempt: number): Date {
  return new Date(now.getTime() + Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.min(attempt, 10))));
}

export function configuredPushSender(env: NodeJS.ProcessEnv = process.env): PushSender | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  webPush.setVapidDetails(subject, publicKey, privateKey);
  return { send: async (subscription, payload) => {
    try {
      const response = await webPush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload);
      return { statusCode: response.statusCode };
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode: unknown }).statusCode) : undefined;
      if (statusCode) return { statusCode };
      throw error;
    }
  } };
}

/** Queue notifications only after the paycheck posting transaction has committed. */
export async function deliverPendingPaydayNotifications(options: {
  store?: PushDeliveryStore; sender?: PushSender | null; now?: Date;
} = {}): Promise<number> {
  const sender = options.sender === undefined ? configuredPushSender() : options.sender;
  if (!sender) return 0;
  const store = options.store ?? databasePushDeliveryStore;
  const now = options.now ?? new Date();
  const occurrences = await store.listPendingOccurrences();
  const subscriptions = await store.listSubscriptions();
  if (!occurrences.length || !subscriptions.length) return 0;
  for (const occurrence of occurrences) {
    for (const subscription of subscriptions) {
      await store.queue(occurrence.id, subscription.id, subscription.endpointHash);
    }
  }

  const deliveries = await store.dueDeliveries(now);
  let sent = 0;
  for (const delivery of deliveries) {
    const payload = JSON.stringify({
      title: "Paycheck deposited",
      body: `A paycheck was added to ${delivery.description}. Confirm when it arrives.`,
      url: `/payday/occurrences/${delivery.occurrenceId}`,
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
