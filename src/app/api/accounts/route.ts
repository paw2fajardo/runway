import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, balanceCheckpoints } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { applyDueIncomeStreamDeposits } from "@/lib/income-stream-deposits";

const AccountCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["liquid", "revolving_credit", "installment_loan"]),
  currency: z.string().default("PHP"),
  current_balance: z.number().int().default(0),
  credit_limit: z.number().int().optional().nullable(),
  statement_cutoff_day: z.number().int().min(1).max(31).optional().nullable(),
  payment_due_day: z.number().int().min(1).max(31).optional().nullable(),
});

export async function GET() {
  try {
    await applyDueIncomeStreamDeposits();
    const allAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.isActive, true))
      .orderBy(accounts.name);

    return NextResponse.json(allAccounts, { status: 200 });
  } catch (error: unknown) {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && (cause.code === "42703" || cause.code === "42P01")) {
      return NextResponse.json({ error: "Income deposit database update is required.", code: "INCOME_DEPOSIT_MIGRATION_REQUIRED" }, { status: 503 });
    }
    console.error("Fetch accounts failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AccountCreateSchema.parse(body);

    const [newAccount] = await db
      .insert(accounts)
      .values({
        name: parsed.name,
        type: parsed.type,
        currency: parsed.currency,
        currentBalance: parsed.current_balance,
        creditLimit: parsed.credit_limit,
        statementCutoffDay: parsed.statement_cutoff_day,
        paymentDueDay: parsed.payment_due_day,
      })
      .returning();

    return NextResponse.json(newAccount, { status: 201 });
  } catch (error: unknown) {
    console.error("Create account failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
