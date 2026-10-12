import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { lockForUpdate } from "../../../../db/locking";
import { db } from "../../../../db";
import {
  transactions,
  transactionLegs,
  accounts,
  categories,
  plannedBudgets,
  plannedBudgetExpenses,
} from "../../../../db/schema";
import { CompoundTransactionSchema, DateOnlySchema } from "../../../../lib/types";
import { plannedBudgetDates } from "../../../../lib/planned-budgets";
import { and, eq } from "drizzle-orm";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { BillPostingError, postBillInstance } from "../../../../lib/bills/posting";
import { balanceAfterAccountLeg } from "../../../../lib/account-balance";

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  try {
    const body = await req.json();
    const parsed = CompoundTransactionSchema.parse(body);
    const linkedBudget = Boolean(parsed.planned_budget_id);
    if (linkedBudget ? parsed.type !== "expense" || Boolean(parsed.bill_instance_id) || !parsed.source_account_id || !parsed.idempotency_key || !DateOnlySchema.safeParse(parsed.planned_budget_occurrence_date).success || !Number.isSafeInteger(parsed.gross_outflow) || parsed.gross_outflow <= 0 || parsed.fee_amount >= parsed.gross_outflow
      : Boolean(parsed.planned_budget_occurrence_date || parsed.finish_planned_budget_occurrence || parsed.idempotency_key)) {
      return NextResponse.json({ error: "Select a budget occurrence and a positive expense with a retry key." }, { status: 400 });
    }
    const requestDigest = createHash("sha256").update(JSON.stringify({ ...parsed, transacted_at: body.transacted_at ?? null })).digest("hex");

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
      if (linkedBudget) {
        const [budget] = await lockForUpdate(tx.select().from(plannedBudgets).where(eq(plannedBudgets.id, parsed.planned_budget_id!))).limit(1);
        const [previous] = await tx.select().from(plannedBudgetExpenses).where(eq(plannedBudgetExpenses.transactionId, parsed.idempotency_key!)).limit(1);
        if (previous) {
          if (previous.requestDigest !== requestDigest) throw new Error("Retry key already used for a different expense.");
          const [transaction] = await tx.select().from(transactions).where(eq(transactions.id, previous.transactionId));
          const legs = await tx.select().from(transactionLegs).where(eq(transactionLegs.transactionId, previous.transactionId));
          return { transaction, legs };
        }
        if (!budget?.isActive || !plannedBudgetDates({ ...budget, cadence: budget.cadence as "once" | "weekly" | "biweekly" | "monthly" }, parsed.planned_budget_occurrence_date!, parsed.planned_budget_occurrence_date!).length) throw new Error("Budget occurrence is unavailable.");
        const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, parsed.source_account_id!), eq(accounts.isActive, true))).limit(1);
        if (!account) throw new Error("Selected account is unavailable.");
      }
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
          ...(linkedBudget ? { id: parsed.idempotency_key } : {}),
          type: parsed.type,
          description: parsed.description,
          transactedAt: parsed.transacted_at
            ? new Date(parsed.transacted_at)
            : new Date(),
        })
        .returning();

      if (linkedBudget) await tx.insert(plannedBudgetExpenses).values({ transactionId: parentTx.id, budgetId: parsed.planned_budget_id!,
        occurrenceDate: parsed.planned_budget_occurrence_date!, isFinished: parsed.finish_planned_budget_occurrence, requestDigest });

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
            currentBalance: balanceAfterAccountLeg(-grossOutflow),
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, parsed.source_account_id));

        await tx
          .update(accounts)
          .set({
            currentBalance: balanceAfterAccountLeg(netInflow),
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
            currentBalance: balanceAfterAccountLeg(-grossOutflow),
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
            currentBalance: balanceAfterAccountLeg(netInflow),
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
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    console.error("Compound transaction failed:", { code: cause && typeof cause === "object" && "code" in cause ? cause.code : "INVALID_TRANSACTION" });
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
