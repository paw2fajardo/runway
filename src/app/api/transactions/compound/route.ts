import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../db";
import {
  transactions,
  transactionLegs,
  accounts,
  categories,
} from "../../../../db/schema";
import { CompoundTransactionSchema } from "../../../../lib/types";
import { and, eq, sql } from "drizzle-orm";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { BillPostingError, postBillInstance } from "../../../../lib/bills/posting";

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  try {
    const body = await req.json();
    const parsed = CompoundTransactionSchema.parse(body);

    if (parsed.bill_instance_id) {
      if (parsed.type !== "expense" || parsed.gross_outflow <= 0 || parsed.fee_amount !== 0) {
        return NextResponse.json({ error: "Log a bill payment as an expense without a separate fee." }, { status: 400 });
      }
      const posted = await postBillInstance(parsed.bill_instance_id, {
        amount: parsed.gross_outflow,
        sourceAccountId: parsed.source_account_id ?? undefined,
        now: new Date(parsed.transacted_at),
      });
      return NextResponse.json(posted, { status: 201 });
    }

    if (parsed.category_id) {
      const [category] = await db.select().from(categories).where(eq(categories.id, parsed.category_id)).limit(1);
      if (!category || category.isArchived) throw new Error("Selected category is unavailable.");
    }

    // Look up System Fee category for friction legs
    let systemFeeCategoryId: string | null = null;
    if (parsed.fee_amount && parsed.fee_amount > 0) {
      const feeCat = await db
        .select()
        .from(categories)
        .where(and(eq(categories.isSystemFee, true), eq(categories.isArchived, false)))
        .limit(1);
      if (feeCat.length > 0) {
        systemFeeCategoryId = feeCat[0].id;
      }
    }

    // Execute atomic compound transaction
    const result = await db.transaction(async (tx) => {
      let categoryId = parsed.category_id || null;
      if (parsed.type === "expense" && parsed.category_name) {
        const [createdCategory] = await tx
          .insert(categories)
          .values({ name: parsed.category_name, isIncome: false, isSystemFee: false })
          .onConflictDoNothing({ target: categories.name })
          .returning({ id: categories.id });

        if (createdCategory) {
          categoryId = createdCategory.id;
        } else {
          const [existingCategory] = await tx
            .select({
              id: categories.id,
              isIncome: categories.isIncome,
              isSystemFee: categories.isSystemFee,
              isArchived: categories.isArchived,
            })
            .from(categories)
            .where(
              and(
                eq(categories.name, parsed.category_name),
                eq(categories.isArchived, false),
                eq(categories.isIncome, false),
                eq(categories.isSystemFee, false),
              ),
            )
            .limit(1);
          if (!existingCategory) throw new Error("Unable to resolve expense category.");
          categoryId = existingCategory.id;
        }
      }

      // 1. Insert parent transaction envelope
      const [parentTx] = await tx
        .insert(transactions)
        .values({
          type: parsed.type,
          description: parsed.description,
          transactedAt: parsed.transacted_at
            ? new Date(parsed.transacted_at)
            : new Date(),
        })
        .returning();

      const createdLegs = [];

      if (parsed.type === "transfer") {
        if (!parsed.source_account_id || !parsed.destination_account_id) {
          throw new Error("Transfers require both source and destination accounts.");
        }

        const grossOutflow = parsed.gross_outflow || 0;
        const netInflow = parsed.net_inflow || grossOutflow - (parsed.fee_amount || 0);
        const feeAmount = parsed.fee_amount || 0;

        // Leg 1: Source debit
        const [leg1] = await tx
          .insert(transactionLegs)
          .values({
            transactionId: parentTx.id,
            accountId: parsed.source_account_id,
            amount: -grossOutflow,
          })
          .returning();
        createdLegs.push(leg1);

        // Leg 2: Destination credit
        const [leg2] = await tx
          .insert(transactionLegs)
          .values({
            transactionId: parentTx.id,
            accountId: parsed.destination_account_id,
            amount: netInflow,
          })
          .returning();
        createdLegs.push(leg2);

        // Leg 3: Fee leg (if fee > 0)
        if (feeAmount > 0) {
          const [leg3] = await tx
            .insert(transactionLegs)
            .values({
              transactionId: parentTx.id,
              categoryId: systemFeeCategoryId,
              amount: feeAmount,
            })
            .returning();
          createdLegs.push(leg3);
        }

        // Update balances atomically
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`${accounts.currentBalance} - ${grossOutflow}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, parsed.source_account_id));

        await tx
          .update(accounts)
          .set({
            currentBalance: sql`${accounts.currentBalance} + ${netInflow}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, parsed.destination_account_id));
      } else if (parsed.type === "expense") {
        if (!parsed.source_account_id) {
          throw new Error("Expense requires a source account.");
        }

        const grossOutflow = parsed.gross_outflow || 0;
        const feeAmount = parsed.fee_amount || 0;
        const netExpense = grossOutflow - feeAmount;

        // Leg 1: Source debit
        const [leg1] = await tx
          .insert(transactionLegs)
          .values({
            transactionId: parentTx.id,
            accountId: parsed.source_account_id,
            amount: -grossOutflow,
          })
          .returning();
        createdLegs.push(leg1);

        // Leg 2: Expense category leg
        const [leg2] = await tx
          .insert(transactionLegs)
          .values({
            transactionId: parentTx.id,
            categoryId,
            amount: netExpense,
          })
          .returning();
        createdLegs.push(leg2);

        // Leg 3: Fee leg
        if (feeAmount > 0) {
          const [leg3] = await tx
            .insert(transactionLegs)
            .values({
              transactionId: parentTx.id,
              categoryId: systemFeeCategoryId,
              amount: feeAmount,
            })
            .returning();
          createdLegs.push(leg3);
        }

        // Update account balance
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`${accounts.currentBalance} - ${grossOutflow}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, parsed.source_account_id));
      } else if (parsed.type === "income") {
        if (!parsed.destination_account_id) {
          throw new Error("Income requires a target destination account.");
        }

        const netInflow = parsed.net_inflow || 0;

        // Leg 1: Target credit
        const [leg1] = await tx
          .insert(transactionLegs)
          .values({
            transactionId: parentTx.id,
            accountId: parsed.destination_account_id,
            amount: netInflow,
          })
          .returning();
        createdLegs.push(leg1);

        // Leg 2: Income category leg
        const [leg2] = await tx
          .insert(transactionLegs)
          .values({
            transactionId: parentTx.id,
            categoryId: parsed.category_id || null,
            amount: -netInflow,
          })
          .returning();
        createdLegs.push(leg2);

        // Update account balance
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`${accounts.currentBalance} + ${netInflow}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, parsed.destination_account_id));
      }

      return {
        transaction: parentTx,
        legs: createdLegs,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof BillPostingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Compound transaction failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
