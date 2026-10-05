import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  accounts,
  incomeStreams,
  paycheckOccurrences,
  transactionLegs,
  transactions,
} from "../../db/schema";
import { DateOnlySchema } from "../types";
import { manilaDate } from "./occurrences";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ConfirmationOccurrence {
  id: string;
  incomeStreamId: string;
  kind: "scheduled" | "retry";
  dueDate: string;
  retryDate: string | null;
  accountId: string | null;
  accountNameSnapshot: string | null;
  amountSnapshot: number;
  transactionId: string | null;
  status: "pending_confirmation" | "confirmed" | "reversed_awaiting_retry";
  parentOccurrenceId: string | null;
  reversalTransactionId: string | null;
}

export interface OriginalLeg { accountId: string | null; categoryId: string | null; amount: number }
export interface ConfirmationTransaction {
  lockOccurrence(id: string): Promise<ConfirmationOccurrence | null>;
  getOriginalLegs(transactionId: string): Promise<OriginalLeg[]>;
  setConfirmed(id: string, at: Date): Promise<void>;
  createReversal(description: string, at: Date): Promise<string>;
  createReversalLegs(transactionId: string, legs: OriginalLeg[]): Promise<void>;
  applyBalanceDelta(accountId: string, delta: number, at: Date): Promise<void>;
  markReversed(id: string, reversalTransactionId: string): Promise<void>;
  createRetry(parent: ConfirmationOccurrence, retryDate: string): Promise<void>;
}
export interface ConfirmationStore {
  transaction<T>(work: (tx: ConfirmationTransaction) => Promise<T>): Promise<T>;
}

function databaseStore(): ConfirmationStore {
  return { transaction: work => db.transaction(tx => work(databaseTransaction(tx))) };
}

function databaseTransaction(tx: DrizzleTx): ConfirmationTransaction {
  return {
    async lockOccurrence(id) {
      const [row] = await tx.select().from(paycheckOccurrences)
        .where(eq(paycheckOccurrences.id, id)).for("update").limit(1);
      return row ?? null;
    },
    async getOriginalLegs(transactionId) {
      return tx.select({ accountId: transactionLegs.accountId, categoryId: transactionLegs.categoryId,
        amount: transactionLegs.amount }).from(transactionLegs)
        .where(eq(transactionLegs.transactionId, transactionId));
    },
    async setConfirmed(id, at) {
      await tx.update(paycheckOccurrences).set({ status: "confirmed", confirmedAt: at })
        .where(eq(paycheckOccurrences.id, id));
    },
    async createReversal(description, at) {
      const [row] = await tx.insert(transactions).values({ type: "expense", description, transactedAt: at }).returning();
      return row.id;
    },
    async createReversalLegs(transactionId, legs) {
      await tx.insert(transactionLegs).values(legs.map(leg => ({
        transactionId, accountId: leg.accountId, categoryId: leg.categoryId, amount: -leg.amount,
      })));
    },
    async applyBalanceDelta(accountId, delta, at) {
      await tx.update(accounts).set({
        currentBalance: sql`${accounts.currentBalance} + ${delta}`, updatedAt: at,
      }).where(eq(accounts.id, accountId));
    },
    async markReversed(id, reversalTransactionId) {
      await tx.update(paycheckOccurrences).set({ status: "reversed_awaiting_retry", reversalTransactionId })
        .where(eq(paycheckOccurrences.id, id));
    },
    async createRetry(parent, retryDate) {
      await tx.insert(paycheckOccurrences).values({
        incomeStreamId: parent.incomeStreamId, kind: "retry", dueDate: retryDate, retryDate,
        accountId: parent.accountId, accountNameSnapshot: parent.accountNameSnapshot,
        amountSnapshot: parent.amountSnapshot, parentOccurrenceId: parent.id,
      }).onConflictDoNothing();
    },
  };
}

export type ConfirmationResult = "confirmed" | "already_confirmed" | "not_found" | "invalid_state";

export async function confirmPaycheck(
  id: string, at = new Date(), store: ConfirmationStore = databaseStore(),
): Promise<ConfirmationResult> {
  return store.transaction(async tx => {
    const occurrence = await tx.lockOccurrence(id);
    if (!occurrence) return "not_found";
    if (occurrence.status === "confirmed") return "already_confirmed";
    if (occurrence.status !== "pending_confirmation" || !occurrence.transactionId) return "invalid_state";
    await tx.setConfirmed(id, at);
    return "confirmed";
  });
}

export type MissedResult = ConfirmationResult | "invalid_date";

export async function markPaycheckMissed(
  id: string, retryDate: string, at = new Date(), store: ConfirmationStore = databaseStore(),
): Promise<MissedResult> {
  if (!DateOnlySchema.safeParse(retryDate).success || retryDate <= manilaDate(at)) return "invalid_date";
  return store.transaction(async tx => {
    const occurrence = await tx.lockOccurrence(id);
    if (!occurrence) return "not_found";
    if (occurrence.status !== "pending_confirmation" || !occurrence.transactionId ||
        !occurrence.accountId || !occurrence.accountNameSnapshot) return "invalid_state";
    const legs = await tx.getOriginalLegs(occurrence.transactionId);
    if (!legs.length || !legs.some(leg => leg.accountId === occurrence.accountId && leg.amount === occurrence.amountSnapshot)) {
      return "invalid_state";
    }
    const reversalId = await tx.createReversal(`Reverse paycheck: ${occurrence.accountNameSnapshot}`, at);
    await tx.createReversalLegs(reversalId, legs);
    for (const leg of legs) if (leg.accountId) await tx.applyBalanceDelta(leg.accountId, -leg.amount, at);
    await tx.markReversed(id, reversalId);
    await tx.createRetry(occurrence, retryDate);
    return "confirmed";
  });
}

export async function listPendingConfirmations() {
  return db.select({
    id: paycheckOccurrences.id, kind: paycheckOccurrences.kind, dueDate: paycheckOccurrences.dueDate,
    accountId: paycheckOccurrences.accountId, accountName: paycheckOccurrences.accountNameSnapshot,
    amountCents: paycheckOccurrences.amountSnapshot, transactionId: paycheckOccurrences.transactionId,
    streamName: incomeStreams.name,
  }).from(paycheckOccurrences)
    .innerJoin(incomeStreams, eq(paycheckOccurrences.incomeStreamId, incomeStreams.id))
    .where(and(eq(paycheckOccurrences.status, "pending_confirmation"), isNotNull(paycheckOccurrences.transactionId)))
    .orderBy(paycheckOccurrences.dueDate);
}
