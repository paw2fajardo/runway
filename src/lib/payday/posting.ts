import { lockForUpdate } from "../../db/locking";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  accounts,
  categories,
  incomeStreams,
  paycheckOccurrences,
  transactionLegs,
  transactions,
} from "../../db/schema";
import { paydayDueAt } from "./schedule";
import { getDueOccurrences, manilaDate, type DuePaycheck } from "./occurrences";

const SALARY_CATEGORY = "Salary & Primary Income";
type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface PostingOccurrence {
  id: string;
  incomeStreamId: string;
  kind: "scheduled" | "retry";
  transactionId: string | null;
  retryDate: string | null;
  accountId: string | null;
  amountSnapshot: number;
  parentOccurrenceId: string | null;
  status: string;
}

export interface PostingStream {
  id: string; name: string; isEnabled: boolean; scheduleKind: string | null;
  paydayAnchor: string | null; destinationAccountId: string | null; netPayCents: number;
}

export interface PostingAccount { id: string; name: string; type: string; isActive: boolean }

export interface OccurrenceTransaction {
  lockStream(id: string, includeDisabled?: boolean): Promise<PostingStream | null>;
  lockOccurrence(id: string): Promise<PostingOccurrence | null>;
  lockParent(id: string): Promise<PostingOccurrence | null>;
  lockAccount(id: string): Promise<PostingAccount | null>;
  claimScheduled(stream: PostingStream, dueDate: string, account: PostingAccount): Promise<PostingOccurrence | null>;
  ensureSalaryCategory(): Promise<string>;
  createTransaction(name: string, retry: boolean, dueAt: Date): Promise<string>;
  createLegs(transactionId: string, accountId: string, categoryId: string, amount: number): Promise<void>;
  creditAccount(accountId: string, amount: number, now: Date): Promise<void>;
  markPosted(occurrenceId: string, transactionId: string, account: PostingAccount, amount: number, now: Date): Promise<void>;
}

export interface OccurrencePostingStore {
  transaction<T>(work: (tx: OccurrenceTransaction) => Promise<T>): Promise<T>;
}

function databaseStore(): OccurrencePostingStore {
  return {
    transaction: work => db.transaction(async tx => work(databaseTransaction(tx))),
  };
}

function databaseTransaction(tx: DrizzleTx): OccurrenceTransaction {
  return {
    async lockStream(id, includeDisabled = false) {
      const [row] = await lockForUpdate(tx.select().from(incomeStreams)
        .where(includeDisabled ? eq(incomeStreams.id, id) : and(eq(incomeStreams.id, id), eq(incomeStreams.isEnabled, true)))
        ).limit(1);
      return row ?? null;
    },
    async lockOccurrence(id) {
      const [row] = await lockForUpdate(tx.select().from(paycheckOccurrences).where(eq(paycheckOccurrences.id, id))).limit(1);
      return row ?? null;
    },
    async lockParent(id) {
      const [row] = await lockForUpdate(tx.select().from(paycheckOccurrences).where(eq(paycheckOccurrences.id, id))).limit(1);
      return row ?? null;
    },
    async lockAccount(id) {
      const [row] = await lockForUpdate(tx.select().from(accounts).where(eq(accounts.id, id))).limit(1);
      return row ?? null;
    },
    async claimScheduled(stream, dueDate, account) {
      const [row] = await tx.insert(paycheckOccurrences).values({
        incomeStreamId: stream.id, kind: "scheduled", dueDate, accountId: account.id,
        accountNameSnapshot: account.name, amountSnapshot: stream.netPayCents,
      }).onConflictDoNothing().returning();
      return row ?? null;
    },
    async ensureSalaryCategory() {
      let [category] = await tx.select().from(categories).where(eq(categories.name, SALARY_CATEGORY)).limit(1);
      if (!category) {
        await tx.insert(categories).values({ name: SALARY_CATEGORY, isIncome: true, isSystemFee: false })
          .onConflictDoNothing({ target: categories.name });
        [category] = await tx.select().from(categories).where(eq(categories.name, SALARY_CATEGORY)).limit(1);
      }
      if (!category || !category.isIncome) throw new Error("Salary category is unavailable or is not an income category.");
      if (category.isArchived) {
        [category] = await tx.update(categories).set({ isArchived: false })
          .where(eq(categories.id, category.id)).returning();
      }
      return category.id;
    },
    async createTransaction(name, retry, dueAt) {
      const [row] = await tx.insert(transactions).values({
        type: "income", description: `${name} paycheck${retry ? " retry" : ""}`, transactedAt: dueAt,
      }).returning();
      return row.id;
    },
    async createLegs(transactionId, accountId, categoryId, amount) {
      await tx.insert(transactionLegs).values([
        { transactionId, accountId, amount },
        { transactionId, categoryId, amount: -amount },
      ]);
    },
    async creditAccount(accountId, amount, now) {
      await tx.update(accounts).set({
        currentBalance: sql`${accounts.currentBalance} + ${amount}`, updatedAt: now,
      }).where(eq(accounts.id, accountId));
    },
    async markPosted(occurrenceId, transactionId, account, amount, now) {
      await tx.update(paycheckOccurrences).set({
        transactionId, accountId: account.id, accountNameSnapshot: account.name,
        amountSnapshot: amount, postedAt: now, status: "pending_confirmation",
      }).where(eq(paycheckOccurrences.id, occurrenceId));
    },
  };
}

async function postOne(candidate: DuePaycheck, now: Date, store: OccurrencePostingStore): Promise<boolean> {
  return store.transaction(async tx => {
    let stream: PostingStream | null = null;
    let occurrence: PostingOccurrence | null = null;

    if (candidate.kind === "scheduled") {
      stream = await tx.lockStream(candidate.incomeStreamId);
      if (!stream || !stream.scheduleKind || !stream.paydayAnchor || stream.destinationAccountId === null) return false;
    } else {
      occurrence = await tx.lockOccurrence(candidate.occurrenceId!);
      if (!occurrence || occurrence.kind !== "retry" || occurrence.transactionId || !occurrence.retryDate ||
          occurrence.retryDate > manilaDate(now) || !occurrence.accountId ||
          !["pending_confirmation", "reversed_awaiting_retry"].includes(occurrence.status)) return false;
      const parent = occurrence.parentOccurrenceId ? await tx.lockParent(occurrence.parentOccurrenceId) : null;
      if (!parent || parent.status !== "reversed_awaiting_retry") return false;
      // Disabled streams may still have an explicitly requested one-time retry.
      stream = await tx.lockStream(occurrence.incomeStreamId, true);
      if (!stream) return false;
    }

    const accountId = candidate.kind === "scheduled" ? stream.destinationAccountId! : occurrence!.accountId!;
    const account = await tx.lockAccount(accountId);
    if (!account || !account.isActive || account.type !== "liquid") return false;

    const dueAt = paydayDueAt(candidate.kind === "scheduled"
      ? { kind: "scheduled", dueDate: candidate.dueDate }
      : { kind: "retry", retryDate: candidate.dueDate });
    if (dueAt > now) return false;

    if (candidate.kind === "scheduled") {
      const claimed = await tx.claimScheduled(stream, candidate.dueDate, account);
      if (!claimed) return false;
      occurrence = claimed;
    }

    const categoryId = await tx.ensureSalaryCategory();
    const amount = candidate.kind === "scheduled" ? stream!.netPayCents : occurrence!.amountSnapshot;
    const transactionId = await tx.createTransaction(stream!.name, candidate.kind === "retry", dueAt);
    await tx.createLegs(transactionId, account.id, categoryId, amount);
    await tx.creditAccount(account.id, amount, now);
    await tx.markPosted(occurrence!.id, transactionId, account, amount, now);
    return true;
  });
}

/** Catch up every currently due scheduled paycheck and persisted one-time retry. */
export async function processDueOccurrences(
  now: Date = new Date(),
  options: { getDue?: typeof getDueOccurrences; store?: OccurrencePostingStore } = {},
): Promise<number> {
  const candidates = await (options.getDue ?? getDueOccurrences)(now);
  const store = options.store ?? databaseStore();
  let posted = 0;
  for (const candidate of candidates) {
    if (await postOne(candidate, now, store)) posted += 1;
  }
  return posted;
}
