import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { inboxItems, accounts, categories, transactions, transactionLegs, balanceCheckpoints, billInstances } from "../../../../../db/schema";
import { ParsedInboxItemSchema } from "../../../../../lib/types";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import { balanceAfterAccountLeg } from "../../../../../lib/account-balance";
import { lockForUpdate } from "../../../../../db/locking";
import { merchantKey } from "../../../../../lib/insights";
import { BillPostingError, postBillInstanceInTransaction } from "../../../../../lib/bills/posting";

const ReviewSchema = z.object({
  source_account_id: z.string().uuid().optional(),
  destination_account_id: z.string().uuid().optional(),
  category_id: z.string().uuid().nullable().optional(),
  merchant: z.string().trim().min(1).max(120).optional(),
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  fee_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  transacted_at: z.string().datetime({ offset: true }).optional(),
  confirm_duplicate: z.boolean().default(false),
  bill_instance_id: z.string().uuid().optional(),
}).strict();

class ReviewError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_ENTRY") { super(message); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ReviewError("Choose a valid inbox entry.");
    const review = ReviewSchema.parse(await req.json().catch(() => undefined));
    const result = await db.transaction(async tx => {
      const [item] = await lockForUpdate(tx.select().from(inboxItems).where(eq(inboxItems.id, id))).limit(1);
      if (!item) throw new ReviewError("Inbox entry not found.", 404);
      if (item.status !== "pending") throw new ReviewError("This entry has already been reviewed.", 409);
      const data = ParsedInboxItemSchema.parse({ ...item.parsedJson as object,
        ...(review.merchant !== undefined ? { merchant: review.merchant } : {}),
        ...(review.amount_cents !== undefined ? { amount_cents: review.amount_cents } : {}),
        ...(review.fee_cents !== undefined ? { fee_cents: review.fee_cents } : {}) });
      if (data.amount_cents <= 0 || !Number.isSafeInteger(data.amount_cents + data.fee_cents)) throw new ReviewError("Enter a positive amount and valid fee.");
      if (data.type === "income" && data.fee_cents > 0) throw new ReviewError("Record income fees separately.");
      const at = review.transacted_at ?? data.transacted_at ?? item.createdAt.toISOString();
      if (!z.string().datetime({ offset: true }).safeParse(at).success) throw new ReviewError("Review the payment date and time.");
      const transactedAt = new Date(at);
      if (transactedAt.getTime() > Date.now() + 60000) throw new ReviewError("A payment cannot be logged in the future.");
      const active = await tx.select().from(accounts).where(eq(accounts.isActive, true));
      const resolve = (explicit: string | undefined, hint: string | undefined) => {
        const matches = active.filter(account => explicit ? account.id === explicit : hint && merchantKey(account.name) === merchantKey(hint));
        return matches.length === 1 ? matches[0] : undefined;
      };
      const source = resolve(review.source_account_id, data.source_account_hint);
      const destination = data.type === "income"
        ? resolve(review.destination_account_id ?? review.source_account_id, data.destination_account_hint ?? data.source_account_hint)
        : resolve(review.destination_account_id, data.destination_account_hint);
      const affected = data.type === "income" ? [destination] : data.type === "transfer" ? [source, destination] : [source];
      if (affected.some(account => !account || !["liquid", "revolving_credit"].includes(account.type))) throw new ReviewError("Choose active liquid or credit accounts.");
      if (data.type === "transfer" && source!.id === destination!.id) throw new ReviewError("Choose different transfer accounts.");
      // Match the bill posting path's bill-before-account lock order.
      if (review.bill_instance_id) await lockForUpdate(tx.select().from(billInstances).where(eq(billInstances.id, review.bill_instance_id))).limit(1);
      for (const account of [...affected].sort((a, b) => a!.id.localeCompare(b!.id))) {
        const [locked] = await lockForUpdate(tx.select().from(accounts).where(and(eq(accounts.id, account!.id), eq(accounts.isActive, true)))).limit(1);
        if (!locked || !["liquid", "revolving_credit"].includes(locked.type)) throw new ReviewError("The selected account is no longer available.");
        const [checkpoint] = await tx.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, account!.id))
          .orderBy(desc(balanceCheckpoints.checkpointAt)).limit(1);
        if (checkpoint && transactedAt <= checkpoint.checkpointAt) throw new ReviewError("This payment predates a balance checkpoint. Review reconciliation evidence to avoid counting it twice.", 409, "ALREADY_RECONCILED");
      }
      const availableCategories = await tx.select().from(categories).where(eq(categories.isArchived, false));
      const category = review.category_id === null ? undefined : availableCategories.find(value => review.category_id
        ? value.id === review.category_id : !value.isSystemFee && value.isIncome === (data.type === "income") && merchantKey(value.name) === merchantKey(data.category_hint ?? ""));
      if (review.category_id && (!category || category.isSystemFee || category.isIncome !== (data.type === "income"))) throw new ReviewError("Choose an available category for this entry type.");
      const feeCategory = availableCategories.find(value => value.isSystemFee);
      const gross = data.amount_cents + data.fee_cents;
      if (!review.confirm_duplicate) {
        const nearby = await tx.select({ id: transactions.id, description: transactions.description, amount: transactionLegs.amount })
          .from(transactions).innerJoin(transactionLegs, eq(transactionLegs.transactionId, transactions.id))
          .where(and(eq(transactionLegs.accountId, affected[0]!.id), eq(transactions.type, data.type),
            gte(transactions.transactedAt, new Date(transactedAt.getTime() - 15 * 60000)),
            lte(transactions.transactedAt, new Date(transactedAt.getTime() + 15 * 60000))));
        const signed = data.type === "income" ? data.amount_cents : -gross;
        if (nearby.some(value => value.amount === signed && merchantKey(value.description) === merchantKey(data.merchant))) {
          throw new ReviewError("Possible duplicate payment. Check History, then confirm if this is a separate payment.", 409, "POSSIBLE_DUPLICATE");
        }
      }
      const markReviewed = async (transaction: typeof transactions.$inferSelect | null) => {
        const [approved] = await tx.update(inboxItems).set({ status: "approved", parsedJson: { ...data,
          transacted_at: transactedAt.toISOString(), source_account_hint: source?.name,
          destination_account_hint: destination?.name, category_hint: category?.name } }).where(eq(inboxItems.id, id)).returning();
        return { inbox_item: approved, transaction };
      };
      if (review.bill_instance_id) {
        if (data.type !== "expense" || data.fee_cents !== 0) throw new ReviewError("Link a bill payment as an expense without a separate fee.");
        const posted = await postBillInstanceInTransaction(tx, review.bill_instance_id, { amount: data.amount_cents, sourceAccountId: source!.id, now: transactedAt });
        return markReviewed(posted.transaction);
      }
      const [transaction] = await tx.insert(transactions).values({ type: data.type, description: data.merchant, transactedAt }).returning();
      const legs = data.type === "income"
        ? [{ transactionId: transaction.id, accountId: destination!.id, amount: data.amount_cents },
          { transactionId: transaction.id, categoryId: category?.id ?? null, amount: -data.amount_cents }]
        : [{ transactionId: transaction.id, accountId: source!.id, amount: -gross },
          ...(data.type === "transfer"
            ? [{ transactionId: transaction.id, accountId: destination!.id, amount: data.amount_cents }]
            : [{ transactionId: transaction.id, categoryId: category?.id ?? null, amount: data.amount_cents }]),
          ...(data.fee_cents > 0 ? [{ transactionId: transaction.id, categoryId: feeCategory?.id ?? null, amount: data.fee_cents }] : [])];
      await tx.insert(transactionLegs).values(legs);
      for (const leg of legs) if ("accountId" in leg && leg.accountId) {
        await tx.update(accounts).set({ currentBalance: balanceAfterAccountLeg(leg.amount), updatedAt: new Date() }).where(eq(accounts.id, leg.accountId));
      }
      return markReviewed(transaction);
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReviewError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof BillPostingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof z.ZodError ? "Review the entry fields before saving." : "Entry could not be saved. Retry." }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}
