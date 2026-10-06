import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../db";
import { bills, billInstances, billPaymentEvents, accounts, categories } from "../../../db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../lib/auth/guard";
import { nextBillDueDate, type BillFrequency } from "../../../lib/bill-schedule";
import { linkExistingBillPaymentInTransaction, postBillInstanceInTransaction } from "../../../lib/bills/posting";
import { manilaDate } from "../../../lib/payday/occurrences";

const BillCreateBaseSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    "fixed_subscription",
    "variable_utility",
    "credit_card_statement",
    "loan_installment",
  ]),
  source_account_id: z.string().uuid().optional().nullable(),
  target_account_id: z.string().uuid().optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  amount: z.number().int().positive(),
  is_estimate: z.boolean().default(false),
  is_auto_pay: z.boolean().default(false),
  is_variable_amount: z.boolean().default(false),
  first_occurrence_paid: z.boolean().optional(),
  first_occurrence_transaction_id: z.string().uuid().optional(),
  due_day_of_month: z.number().int().min(1).max(31).optional(),
  due_day_of_week: z.number().int().min(0).max(6).optional(),
  frequency: z.enum(["weekly", "biweekly", "monthly", "every_2_months", "every_3_months", "every_6_months", "annually"]).default("monthly"),
  occurrence_limit: z.number().int().min(1).max(600).nullable().optional(),
  grace_period_days: z.number().int().min(0).default(0),
});

const BillCreateSchema = BillCreateBaseSchema.superRefine((bill, ctx) => {
  const weekly = bill.frequency === "weekly" || bill.frequency === "biweekly";
  if (weekly && bill.due_day_of_week === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["due_day_of_week"], message: "A due day of week is required for weekly bills." });
  }
  if (!weekly && bill.due_day_of_month === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["due_day_of_month"], message: "A due day of month is required for this frequency." });
  }
});

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (owner instanceof Response) return owner;

  try {
    const activeBills = await db
      .select({
        instanceId: billInstances.id,
        billId: bills.id,
        name: bills.name,
        type: bills.type,
        amount: bills.amount,
        amountDue: billInstances.amountDue,
        dueDate: billInstances.dueDate,
        targetSettlementDate: billInstances.targetSettlementDate,
        status: billInstances.status,
        isEstimate: bills.isEstimate,
        isAutoPay: bills.isAutoPay,
        autoPostFrom: bills.autoPostFrom,
        isVariableAmount: bills.isVariableAmount,
        dueDayOfMonth: bills.dueDayOfMonth,
        dueDayOfWeek: bills.dueDayOfWeek,
        frequency: bills.frequency,
        occurrenceLimit: bills.occurrenceLimit,
        gracePeriodDays: bills.gracePeriodDays,
        sourceAccountId: bills.sourceAccountId,
        sourceAccountName: accounts.name,
        sourceAccountBalance: accounts.currentBalance,
        categoryId: bills.categoryId,
        categoryName: categories.name,
      })
      .from(billInstances)
      .innerJoin(bills, eq(billInstances.billId, bills.id))
      .leftJoin(accounts, eq(bills.sourceAccountId, accounts.id))
      .leftJoin(categories, eq(bills.categoryId, categories.id))
      .where(eq(bills.isActive, true))
      .orderBy(billInstances.dueDate);

    const corrections = await db.select({ id: billPaymentEvents.billInstanceId })
      .from(billPaymentEvents).where(eq(billPaymentEvents.kind, "correction"));
    const correctedIds = new Set(corrections.map((item) => item.id));
    return NextResponse.json(activeBills.map((bill) => ({
      ...bill, hasCorrection: correctedIds.has(bill.instanceId),
    })), { status: 200 });
  } catch (error: unknown) {
    console.error("Fetch bills failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  try {
    const body = await req.json();
    const parsed = BillCreateSchema.parse(body);

    if (parsed.category_id) {
      const [category] = await db.select().from(categories).where(eq(categories.id, parsed.category_id)).limit(1);
      if (!category || category.isArchived) return NextResponse.json({ error: "Selected category is unavailable." }, { status: 400 });
    }

    const now = new Date();
    const today = manilaDate(now);
    const todayDate = new Date(`${today}T12:00:00Z`);
    const year = todayDate.getUTCFullYear();
    const month = String(todayDate.getUTCMonth() + 1).padStart(2, "0");
    let dueDate: string;
    if (parsed.frequency === "weekly" || parsed.frequency === "biweekly") {
      const daysUntilDue = (parsed.due_day_of_week! - todayDate.getUTCDay() + 7) % 7;
      const initialDue = new Date(Date.UTC(year, todayDate.getUTCMonth(), todayDate.getUTCDate() + daysUntilDue));
      dueDate = initialDue.toISOString().slice(0, 10);
    } else {
      const lastDayOfMonth = new Date(Date.UTC(year, todayDate.getUTCMonth() + 1, 0)).getUTCDate();
      const dueDay = String(Math.min(parsed.due_day_of_month!, lastDayOfMonth)).padStart(2, "0");
      dueDate = `${year}-${month}-${dueDay}`;
    }
    const periodIdentifier = parsed.frequency === "weekly" || parsed.frequency === "biweekly"
      ? dueDate
      : `${year}-${month}`;
    const pastDue = dueDate < today;
    if (parsed.is_auto_pay && !parsed.source_account_id) {
      return NextResponse.json({ error: "Choose the cash account used for auto-pay." }, { status: 400 });
    }
    if (parsed.is_auto_pay && pastDue && parsed.first_occurrence_paid === undefined) {
      return NextResponse.json({ error: "Confirm whether this month's auto-pay already happened." }, { status: 400 });
    }
    if (parsed.first_occurrence_transaction_id && !parsed.first_occurrence_paid) {
      return NextResponse.json({ error: "Confirm that this month's bill was paid." }, { status: 400 });
    }
    const autoPostFrom = parsed.is_auto_pay
      ? pastDue
        ? nextBillDueDate(dueDate, parsed.frequency as BillFrequency, parsed.due_day_of_month ?? todayDate.getUTCDate())
        : today
      : null;

    const result = await db.transaction(async (tx) => {
      if (parsed.source_account_id) {
        const [source] = await tx.select().from(accounts).where(eq(accounts.id, parsed.source_account_id)).limit(1);
        if (!source || !source.isActive || source.type !== "liquid") throw new Error("Choose an active cash account.");
      }
      const [newBill] = await tx
        .insert(bills)
        .values({
          name: parsed.name,
          type: parsed.type,
          sourceAccountId: parsed.source_account_id,
          targetAccountId: parsed.target_account_id,
          categoryId: parsed.category_id,
          amount: parsed.amount,
          isEstimate: parsed.is_estimate,
          isAutoPay: parsed.is_auto_pay,
          autoPostFrom,
          isVariableAmount: parsed.is_variable_amount,
          dueDayOfMonth: parsed.due_day_of_month ?? todayDate.getUTCDate(),
          dueDayOfWeek: parsed.due_day_of_week ?? null,
          frequency: parsed.frequency,
          occurrenceLimit: parsed.occurrence_limit ?? null,
          gracePeriodDays: parsed.grace_period_days,
        })
        .returning();

      const [instance] = await tx
        .insert(billInstances)
        .values({
          billId: newBill.id,
          periodIdentifier,
          dueDate,
          targetSettlementDate: dueDate,
          amountDue: parsed.amount,
          status: "upcoming",
        })
        .returning();

      if (parsed.is_auto_pay && pastDue && parsed.first_occurrence_paid) {
        if (parsed.first_occurrence_transaction_id) {
          await linkExistingBillPaymentInTransaction(tx, instance.id, parsed.first_occurrence_transaction_id);
        } else {
          await postBillInstanceInTransaction(tx, instance.id, { automatic: true, now });
        }
      }

      return { bill: newBill, instance };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error("Create bill failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
