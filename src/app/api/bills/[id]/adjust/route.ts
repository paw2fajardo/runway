import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { accounts, billInstances, billPaymentEvents, bills, transactionLegs, transactions } from "../../../../../db/schema";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";
import { nextBillDueDate, type BillFrequency } from "../../../../../lib/bill-schedule";
import { manilaDate } from "../../../../../lib/payday/occurrences";
import { billPaymentCategory } from "../../../../../lib/bills/posting";

const adjustmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("correct"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("undo") }).strict(),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid bill identifier." }, { status: 400 });
  const parsed = adjustmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid correction." }, { status: 400 });
  try {
    const result = await db.transaction(async (tx) => {
      const [instance] = await tx.select().from(billInstances).where(eq(billInstances.id, id)).for("update").limit(1);
      if (!instance || instance.status !== "auto_debited" || !instance.linkedTransactionId) return null;
      const [bill] = await tx.select().from(bills).where(eq(bills.id, instance.billId)).limit(1);
      if (!bill) return null;
      const [accountLeg] = await tx.select().from(transactionLegs).where(and(
        eq(transactionLegs.transactionId, instance.linkedTransactionId),
        isNotNull(transactionLegs.accountId),
      )).limit(1);
      if (!accountLeg?.accountId || accountLeg.amount >= 0) throw new Error("Original payment account is unavailable.");
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountLeg.accountId)).for("update").limit(1);
      if (!account) throw new Error("Original payment account is unavailable.");

      if (parsed.data.kind === "correct" && !bill.isVariableAmount) {
        throw new Error("Only variable auto-pay amounts can be corrected here.");
      }
      const delta = parsed.data.kind === "undo"
        ? -instance.amountDue
        : parsed.data.amount - instance.amountDue;
      if (delta === 0) return { instance, unchanged: true };
      const now = new Date();
      const [adjustment] = await tx.insert(transactions).values({
        type: delta > 0 ? "expense" : "income",
        description: `${parsed.data.kind === "undo" ? "Reversal" : "Auto-pay correction"}: ${bill.name}`,
        transactedAt: now,
      }).returning();
      await tx.insert(billPaymentEvents).values({
        transactionId: instance.linkedTransactionId,
        billInstanceId: instance.id,
        kind: "auto_payment",
      }).onConflictDoNothing();
      await tx.insert(billPaymentEvents).values({
        transactionId: adjustment.id,
        billInstanceId: instance.id,
        kind: parsed.data.kind === "undo" ? "reversal" : "correction",
      });
      await tx.insert(transactionLegs).values({
        transactionId: adjustment.id, accountId: account.id, amount: -delta,
      });
      const categoryId = await billPaymentCategory(tx, bill.categoryId);
      await tx.insert(transactionLegs).values({
        transactionId: adjustment.id, categoryId, amount: delta,
      });
      await tx.update(accounts).set({
        currentBalance: sql`${accounts.currentBalance} - ${delta}`,
        updatedAt: now,
      }).where(eq(accounts.id, account.id));
      if (parsed.data.kind === "undo") {
        const nextDueDate = nextBillDueDate(instance.dueDate, bill.frequency as BillFrequency, bill.dueDayOfMonth);
        await tx.update(bills).set({ autoPostFrom: nextDueDate, updatedAt: now }).where(eq(bills.id, bill.id));
        await tx.update(billInstances).set({
          status: instance.dueDate < manilaDate(now) ? "past_due" : "upcoming",
          linkedTransactionId: null,
          updatedAt: now,
        }).where(eq(billInstances.id, id));
      } else {
        await tx.update(billInstances).set({ amountDue: parsed.data.amount, updatedAt: now })
          .where(eq(billInstances.id, id));
      }
      return { adjustment, kind: parsed.data.kind };
    });
    if (!result) return NextResponse.json({ error: "Auto-pay payment was not found." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Auto-pay adjustment failed:", error);
    return NextResponse.json({ error: "Unable to change this payment." }, { status: 500 });
  }
}
