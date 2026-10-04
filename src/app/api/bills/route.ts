import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bills, billInstances, accounts, categories } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const BillCreateSchema = z.object({
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
  due_day_of_month: z.number().int().min(1).max(31),
  grace_period_days: z.number().int().min(0).default(0),
});

export async function GET() {
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
  try {
    const body = await req.json();
    const parsed = BillCreateSchema.parse(body);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const periodIdentifier = `${year}-${month}`;
    const dueDay = String(parsed.due_day_of_month).padStart(2, "0");
    const dueDate = `${year}-${month}-${dueDay}`;

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
          dueDayOfMonth: parsed.due_day_of_month,
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
