import { and, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { accounts, billInstances, billPaymentEvents, bills, categories, transactionLegs, transactions } from "../../db/schema";
import { nextBillDueDate, type BillFrequency } from "../bill-schedule";
import { manilaDate } from "../payday/occurrences";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BillPostingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface PostBillOptions {
  amount?: number;
  sourceAccountId?: string;
  automatic?: boolean;
  now?: Date;
}

export async function billPaymentCategory(tx: DbTransaction, preferredId: string | null): Promise<string> {
  if (preferredId) return preferredId;
  const name = "Bill Payments";
  await tx.insert(categories).values({ name, isIncome: false, isSystemFee: false })
    .onConflictDoNothing({ target: categories.name });
  const [category] = await tx.select().from(categories).where(eq(categories.name, name)).limit(1);
  if (!category || category.isIncome || category.isSystemFee) {
    throw new BillPostingError("Bill payment category is unavailable.");
  }
  return category.id;
}

async function createNextOccurrence(
  tx: DbTransaction,
  bill: typeof bills.$inferSelect,
  instance: typeof billInstances.$inferSelect,
) {
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
    .from(billInstances).where(eq(billInstances.billId, bill.id));
  if (bill.occurrenceLimit !== null && count >= bill.occurrenceLimit) return;
  const nextDueDate = nextBillDueDate(
    instance.dueDate, bill.frequency as BillFrequency, bill.dueDayOfMonth,
  );
  await tx.insert(billInstances).values({
    billId: bill.id,
    periodIdentifier: nextDueDate,
    dueDate: nextDueDate,
    targetSettlementDate: nextDueDate,
    amountDue: bill.amount,
    status: "upcoming",
  }).onConflictDoNothing();
}

/** The account debit, expense, paid state, and next occurrence are one write. */
export async function postBillInstanceInTransaction(
  tx: DbTransaction,
  instanceId: string,
  options: PostBillOptions = {},
) {
  const [instance] = await tx.select().from(billInstances)
    .where(eq(billInstances.id, instanceId)).for("update").limit(1);
  if (!instance) throw new BillPostingError("Bill occurrence not found.", 404);
  if (instance.status === "paid" || instance.status === "auto_debited" || instance.linkedTransactionId) {
    throw new BillPostingError("This bill has already been recorded.", 409);
  }

  const [bill] = await tx.select().from(bills).where(eq(bills.id, instance.billId)).limit(1);
  if (!bill || !bill.isActive) throw new BillPostingError("This bill is unavailable.", 404);
  if (options.automatic && !bill.isAutoPay) throw new BillPostingError("Auto-pay is off for this bill.");

  const accountId = options.sourceAccountId ?? bill.sourceAccountId;
  if (!accountId) throw new BillPostingError("Choose the account that paid this bill.");
  const [account] = await tx.select().from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.isActive, true)))
    .for("update").limit(1);
  if (!account || !["liquid", "revolving_credit"].includes(account.type)) {
    throw new BillPostingError("Choose an active cash or credit account for this bill.");
  }

  if (bill.isVariableAmount && !options.automatic && options.amount === undefined) {
    throw new BillPostingError("Enter the amount that was paid.");
  }
  const amount = options.amount ?? instance.amountDue;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new BillPostingError("Enter a payment amount greater than zero.");
  }

  const now = options.now ?? new Date();
  const [transaction] = await tx.insert(transactions).values({
    type: "expense",
    description: bill.name,
    transactedAt: options.automatic ? new Date(`${instance.dueDate}T12:00:00+08:00`) : now,
  }).returning();
  await tx.insert(transactionLegs).values({
    transactionId: transaction.id, accountId, amount: -amount,
  });
  const categoryId = await billPaymentCategory(tx, bill.categoryId);
  await tx.insert(transactionLegs).values({
    transactionId: transaction.id, categoryId, amount,
  });
  await tx.update(accounts).set({
    currentBalance: sql`${accounts.currentBalance} - ${amount}`,
    updatedAt: now,
  }).where(eq(accounts.id, accountId));
  const [posted] = await tx.update(billInstances).set({
    amountDue: amount,
    status: options.automatic ? "auto_debited" : "paid",
    linkedTransactionId: transaction.id,
    updatedAt: now,
  }).where(eq(billInstances.id, instanceId)).returning();
  await tx.insert(billPaymentEvents).values({
    transactionId: transaction.id,
    billInstanceId: instanceId,
    kind: options.automatic ? "auto_payment" : "manual_payment",
  });

  await createNextOccurrence(tx, bill, instance);
  return { instance: posted, transaction };
}

/** Attach an already logged expense without touching the account a second time. */
export async function linkExistingBillPaymentInTransaction(
  tx: DbTransaction,
  instanceId: string,
  transactionId: string,
) {
  const [instance] = await tx.select().from(billInstances)
    .where(eq(billInstances.id, instanceId)).for("update").limit(1);
  if (!instance || instance.status === "paid" || instance.status === "auto_debited" || instance.linkedTransactionId) {
    throw new BillPostingError("This bill is already recorded or unavailable.", 409);
  }
  const [bill] = await tx.select().from(bills).where(eq(bills.id, instance.billId)).limit(1);
  const [transaction] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for("update").limit(1);
  if (!bill || !transaction || transaction.type !== "expense" || !bill.sourceAccountId) {
    throw new BillPostingError("Choose a matching logged expense.");
  }
  const [linked] = await tx.select({ id: billInstances.id }).from(billInstances)
    .where(eq(billInstances.linkedTransactionId, transactionId)).limit(1);
  const [event] = await tx.select({ id: billPaymentEvents.transactionId }).from(billPaymentEvents)
    .where(eq(billPaymentEvents.transactionId, transactionId)).limit(1);
  if (linked || event) throw new BillPostingError("This expense already belongs to a bill.", 409);
  const [accountLeg] = await tx.select().from(transactionLegs).where(and(
    eq(transactionLegs.transactionId, transactionId),
    eq(transactionLegs.accountId, bill.sourceAccountId),
  )).limit(1);
  if (!accountLeg || accountLeg.amount >= 0) {
    throw new BillPostingError("This expense used a different account.");
  }
  const amount = -accountLeg.amount;
  const daysApart = Math.abs(
    Date.parse(`${manilaDate(transaction.transactedAt)}T00:00:00Z`) -
    Date.parse(`${instance.dueDate}T00:00:00Z`),
  ) / 86_400_000;
  if (daysApart > 31) throw new BillPostingError("Choose an expense near this bill's due date.");
  const [posted] = await tx.update(billInstances).set({
    amountDue: amount, status: "paid", linkedTransactionId: transactionId, updatedAt: new Date(),
  }).where(eq(billInstances.id, instanceId)).returning();
  await tx.insert(billPaymentEvents).values({
    transactionId, billInstanceId: instanceId, kind: "linked_payment",
  });
  await createNextOccurrence(tx, bill, instance);
  return posted;
}

export function postBillInstance(instanceId: string, options: PostBillOptions = {}) {
  return db.transaction(tx => postBillInstanceInTransaction(tx, instanceId, options));
}

/** Existing auto-pay bills remain opt-in until an account and start date are saved. */
export async function processDueAutoPayBills(now = new Date()): Promise<number> {
  const today = manilaDate(now);
  let posted = 0;
  const attempted = new Set<string>();
  for (let batch = 0; batch < 600; batch += 1) {
    const candidates = await db.select({ id: billInstances.id })
      .from(billInstances)
      .innerJoin(bills, eq(billInstances.billId, bills.id))
      .where(and(
        eq(bills.isActive, true),
        eq(bills.isAutoPay, true),
        inArray(billInstances.status, ["upcoming", "due_today", "grace_period", "past_due"]),
        lte(billInstances.dueDate, today),
        sql`${bills.autoPostFrom} IS NOT NULL AND ${billInstances.dueDate} >= ${bills.autoPostFrom}`,
        attempted.size ? notInArray(billInstances.id, [...attempted]) : undefined,
      ))
      .orderBy(billInstances.dueDate)
      .limit(100);
    if (!candidates.length) break;
    for (const candidate of candidates) {
      attempted.add(candidate.id);
      try {
        await postBillInstance(candidate.id, { automatic: true, now });
        posted += 1;
      } catch (error) {
        if (!(error instanceof BillPostingError && error.status === 409)) {
          console.error("Auto-pay posting failed:", candidate.id, error);
        }
      }
    }
  }
  return posted;
}
