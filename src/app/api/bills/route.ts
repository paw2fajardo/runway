import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../db";
import { bills, billInstances, accounts, categories } from "../../../db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { assertSameOrigin, requireOwner } from "../../../lib/auth/guard";

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

    return NextResponse.json(activeBills, { status: 200 });
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
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    let dueDate: string;
    if (parsed.frequency === "weekly" || parsed.frequency === "biweekly") {
      const daysUntilDue = (parsed.due_day_of_week! - now.getDay() + 7) % 7;
      const initialDue = new Date(year, now.getMonth(), now.getDate() + daysUntilDue);
      dueDate = `${initialDue.getFullYear()}-${String(initialDue.getMonth() + 1).padStart(2, "0")}-${String(initialDue.getDate()).padStart(2, "0")}`;
    } else {
      const lastDayOfMonth = new Date(year, now.getMonth() + 1, 0).getDate();
      const dueDay = String(Math.min(parsed.due_day_of_month!, lastDayOfMonth)).padStart(2, "0");
      dueDate = `${year}-${month}-${dueDay}`;
    }
    const periodIdentifier = parsed.frequency === "weekly" || parsed.frequency === "biweekly"
      ? dueDate
      : `${year}-${month}`;

    const result = await db.transaction(async (tx) => {
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
          dueDayOfMonth: parsed.due_day_of_month ?? now.getDate(),
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

      return { bill: newBill, instance };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error("Create bill failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
