import Dexie, { Table } from "dexie";
import { CompoundTransactionInput } from "./types";

export interface QueuedTransactionRecord {
  id?: number;
  clientUuid: string;
  payload: CompoundTransactionInput;
  status: "pending" | "syncing" | "synced" | "failed";
  errorMessage?: string;
  createdAt: number;
}

export interface CachedAccountRecord {
  id: string;
  name: string;
  type: string;
  currentBalance: number;
  updatedAt: number;
}

export class LedgerFlowOfflineDB extends Dexie {
  queuedTransactions!: Table<QueuedTransactionRecord, number>;
  cachedAccounts!: Table<CachedAccountRecord, string>;

  constructor() {
    super("LedgerFlowOfflineDB");
    this.version(1).stores({
      queuedTransactions: "++id, clientUuid, status, createdAt",
      cachedAccounts: "id, name, type, currentBalance",
    });
  }
}

export const offlineDB = typeof window !== "undefined" ? new LedgerFlowOfflineDB() : null;

/**
 * Queue a transaction locally into IndexedDB for instant offline capture (<50ms).
 */
export async function queueOfflineTransaction(
  payload: CompoundTransactionInput
): Promise<string> {
  const clientUuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  if (offlineDB) {
    await offlineDB.queuedTransactions.add({
      clientUuid,
      payload,
      status: "pending",
      createdAt: Date.now(),
    });
  }

  // Attempt immediate background flush if online
  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushOfflineQueue().catch(console.error);
  }

  return clientUuid;
}

/**
 * Flush all pending offline transactions to the server sequentially.
 */
export async function flushOfflineQueue(): Promise<{ synced: number; failed: number }> {
  if (!offlineDB) return { synced: 0, failed: 0 };

  const pending = await offlineDB.queuedTransactions
    .where("status")
    .equals("pending")
    .toArray();

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    if (!item.id) continue;
    try {
      await offlineDB.queuedTransactions.update(item.id, { status: "syncing" });

      const res = await fetch("/api/transactions/compound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...item.payload,
          client_uuid: item.clientUuid,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      await offlineDB.queuedTransactions.update(item.id, { status: "synced" });
      synced++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sync error";
      await offlineDB.queuedTransactions.update(item.id, {
        status: "failed",
        errorMessage: message,
      });
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Get count of pending offline transactions.
 */
export async function getPendingQueueCount(): Promise<number> {
  if (!offlineDB) return 0;
  return await offlineDB.queuedTransactions
    .where("status")
    .equals("pending")
    .count();
}
