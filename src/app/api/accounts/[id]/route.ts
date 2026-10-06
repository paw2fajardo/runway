import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../db";
import { accounts, incomeStreamDeposits, transactionLegs } from "../../../../db/schema";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";

const AccountPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: z.enum(["liquid", "revolving_credit", "installment_loan"]).optional(),
  credit_limit: z.number().int().nonnegative().nullable().optional(),
  statement_cutoff_day: z.number().int().min(1).max(31).nullable().optional(),
  payment_due_day: z.number().int().min(1).max(31).nullable().optional(),
  initial_balance: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Provide a valid account and changes." }, { status: 400 });
  }
  const parsed = AccountPatchSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide valid account changes." }, { status: 400 });
  }

  try {
    const change = parsed.data;
    const [account] = await db.update(accounts)
      .set({
        ...(change.name !== undefined ? { name: change.name } : {}),
        ...(change.type !== undefined ? { type: change.type } : {}),
        ...(change.credit_limit !== undefined ? { creditLimit: change.credit_limit } : {}),
        ...(change.statement_cutoff_day !== undefined ? { statementCutoffDay: change.statement_cutoff_day } : {}),
        ...(change.payment_due_day !== undefined ? { paymentDueDay: change.payment_due_day } : {}),
        ...(change.initial_balance !== undefined ? {
          initialBalance: change.initial_balance,
          currentBalance: sql`${change.initial_balance} +
            COALESCE((SELECT SUM(${transactionLegs.amount}) FROM ${transactionLegs} WHERE ${transactionLegs.accountId} = ${accounts.id}), 0) +
            COALESCE((SELECT SUM(${incomeStreamDeposits.amountCents}) FROM ${incomeStreamDeposits} WHERE ${incomeStreamDeposits.accountId} = ${accounts.id}), 0)`,
        } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, id), eq(accounts.isActive, true)))
      .returning();
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    return NextResponse.json(account);
  } catch {
    return NextResponse.json({ error: "Unable to update account." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Provide a valid account." }, { status: 400 });
  }

  try {
    const [account] = await db.update(accounts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.isActive, true)))
      .returning();
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    return NextResponse.json({ success: true, account });
  } catch {
    return NextResponse.json({ error: "Unable to deactivate account." }, { status: 500 });
  }
}
