import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../../db";
import {
  inboxItems,
  accounts,
  categories,
  transactions,
  transactionLegs,
} from "../../../../../db/schema";
import { eq, sql } from "drizzle-orm";
import { ParsedInboxItem } from "../../../../../lib/types";
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
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, id))
      .limit(1);

    if (!item) {
      return NextResponse.json({ error: "Inbox item not found" }, { status: 404 });
    }

    if (item.status === "approved") {
      return NextResponse.json(
        { error: "Item has already been approved into ledger" },
        { status: 400 }
      );
    }

    const data = item.parsedJson as ParsedInboxItem;
    const body = await req.json().catch(() => ({}));

    // Allow user overrides from UI or use hints
    const sourceHint = body.source_account_id || data.source_account_hint;
    const destHint = body.destination_account_id || data.destination_account_hint;
    const categoryHint = body.category_id || data.category_hint;

    // Resolve Account
    const allAccounts = await db.select().from(accounts);
    let sourceAcc = allAccounts.find(
      (a) =>
        a.id === sourceHint ||
        (sourceHint && a.name.toLowerCase().includes(sourceHint.toLowerCase()))
    );
    if (!sourceAcc) {
      sourceAcc = allAccounts.find((a) => a.type === "liquid") || allAccounts[0];
    }

    let destAcc = allAccounts.find(
      (a) =>
        a.id === destHint ||
        (destHint && a.name.toLowerCase().includes(destHint.toLowerCase()))
    );

    // Resolve Category
    const allCategories = await db.select().from(categories);
    let cat = allCategories.filter((category) => !category.isArchived).find(
      (c) =>
        c.id === categoryHint ||
        (categoryHint && c.name.toLowerCase().includes(categoryHint.toLowerCase()))
    );
    const systemFeeCat = allCategories.find((c) => c.isSystemFee && !c.isArchived);

    const grossOutflow = data.amount_cents;
    const feeAmount = data.fee_cents || 0;

    const result = await db.transaction(async (tx) => {
      const [parentTx] = await tx
        .insert(transactions)
        .values({
          type: data.type,
          description: data.merchant || "Inbox Approved Expense",
          transactedAt: data.transacted_at
            ? new Date(data.transacted_at)
            : new Date(),
        })
        .returning();

      if (data.type === "transfer" && destAcc && sourceAcc) {
        const netInflow = grossOutflow - feeAmount;
        // Source debit
        await tx.insert(transactionLegs).values({
          transactionId: parentTx.id,
          accountId: sourceAcc.id,
          amount: -grossOutflow,
        });

        // Destination credit
        await tx.insert(transactionLegs).values({
          transactionId: parentTx.id,
          accountId: destAcc.id,
          amount: netInflow,
        });

        // Fee leg
        if (feeAmount > 0 && systemFeeCat) {
          await tx.insert(transactionLegs).values({
            transactionId: parentTx.id,
            categoryId: systemFeeCat.id,
            amount: feeAmount,
          });
        }

        // Balances
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`${accounts.currentBalance} - ${grossOutflow}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, sourceAcc.id));

        await tx
          .update(accounts)
          .set({
            currentBalance: sql`${accounts.currentBalance} + ${netInflow}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, destAcc.id));
      } else {
        // Direct Expense
        if (sourceAcc) {
          const netExpense = grossOutflow - feeAmount;
          await tx.insert(transactionLegs).values({
            transactionId: parentTx.id,
            accountId: sourceAcc.id,
            amount: -grossOutflow,
          });

          if (cat) {
            await tx.insert(transactionLegs).values({
              transactionId: parentTx.id,
              categoryId: cat.id,
              amount: netExpense,
            });
          }

          if (feeAmount > 0 && systemFeeCat) {
            await tx.insert(transactionLegs).values({
              transactionId: parentTx.id,
              categoryId: systemFeeCat.id,
              amount: feeAmount,
            });
          }

          await tx
            .update(accounts)
            .set({
              currentBalance: sql`${accounts.currentBalance} - ${grossOutflow}`,
              updatedAt: new Date(),
            })
            .where(eq(accounts.id, sourceAcc.id));
        }
      }

      // Mark inbox item approved
      const [approvedItem] = await tx
        .update(inboxItems)
        .set({ status: "approved" })
        .where(eq(inboxItems.id, id))
        .returning();

      return { inbox_item: approvedItem, transaction: parentTx };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    console.error("Approve inbox item failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
