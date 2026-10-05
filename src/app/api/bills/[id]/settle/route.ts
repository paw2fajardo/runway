import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../../db";
import {
  billInstances,
  bills,
  transactions,
  transactionLegs,
  accounts,
} from "../../../../../db/schema";
import { eq, sql } from "drizzle-orm";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const customSourceAccountId = body.source_account_id;

    const [instance] = await db
      .select({
        instanceId: billInstances.id,
        amountDue: billInstances.amountDue,
        status: billInstances.status,
        billId: bills.id,
        name: bills.name,
        sourceAccountId: bills.sourceAccountId,
        categoryId: bills.categoryId,
      })
      .from(billInstances)
      .innerJoin(bills, eq(billInstances.billId, bills.id))
      .where(eq(billInstances.id, id))
      .limit(1);

    if (!instance) {
      return NextResponse.json({ error: "Bill instance not found" }, { status: 404 });
    }

    if (instance.status === "paid") {
      return NextResponse.json(
        { error: "Bill instance is already marked as paid" },
        { status: 400 }
      );
    }

    const effectiveSourceAccountId = customSourceAccountId || instance.sourceAccountId;

    const result = await db.transaction(async (tx) => {
      let createdTx = null;

      // If source account exists, create compound transaction
      if (effectiveSourceAccountId) {
        const [parentTx] = await tx
          .insert(transactions)
          .values({
            type: "expense",
            description: `Settlement: ${instance.name}`,
          })
          .returning();

        // Source debit
        await tx.insert(transactionLegs).values({
          transactionId: parentTx.id,
          accountId: effectiveSourceAccountId,
          amount: -instance.amountDue,
        });

        // Category leg
        if (instance.categoryId) {
          await tx.insert(transactionLegs).values({
            transactionId: parentTx.id,
            categoryId: instance.categoryId,
            amount: instance.amountDue,
          });
        }

        // Deduct from account balance
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`${accounts.currentBalance} - ${instance.amountDue}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, effectiveSourceAccountId));

        createdTx = parentTx;
      }

      // Mark instance as paid
      const [updatedInstance] = await tx
        .update(billInstances)
        .set({
          status: "paid",
          linkedTransactionId: createdTx?.id || null,
          updatedAt: new Date(),
        })
        .where(eq(billInstances.id, id))
        .returning();

      return {
        instance: updatedInstance,
        transaction: createdTx,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    console.error("Settle bill failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
