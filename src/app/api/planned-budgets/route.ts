import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { plannedBudgets } from "../../../db/schema";
import { DateOnlySchema } from "../../../lib/types";
import { assertSameOrigin, requireOwner } from "../../../lib/auth/guard";
import { plannedBudgetDates, remainingBudgetReserve } from "../../../lib/planned-budgets";
import { loadPlannedBudgetSpending } from "../../../lib/planned-budget-spending";

const budgetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  start_date: DateOnlySchema,
  cadence: z.enum(["once", "weekly", "biweekly", "monthly"]),
}).strict();

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const around = req.nextUrl.searchParams.get("occurrencesAround");
  if (around !== null && !DateOnlySchema.safeParse(around).success) return NextResponse.json({ error: "Choose a real occurrence date." }, { status: 400 });
  const rows = await db.select().from(plannedBudgets).where(eq(plannedBudgets.isActive, true)).orderBy(plannedBudgets.startDate);
  if (around) {
    const spending = await loadPlannedBudgetSpending();
    const shift = (days: number) => new Date(Math.max(Date.parse("0001-01-01T00:00:00Z"), Math.min(Date.parse("9999-12-31T00:00:00Z"), Date.parse(`${around}T00:00:00Z`) + days * 86400000))).toISOString().slice(0, 10);
    return NextResponse.json(rows.map(budget => ({ ...budget, occurrences: plannedBudgetDates({ ...budget, cadence: budget.cadence as "once" | "weekly" | "biweekly" | "monthly" }, shift(35), shift(-35)).map(date => ({
      date, spentCents: spending.filter(item => item.budgetId === budget.id && item.occurrenceDate === date).reduce((sum, item) => sum + item.amountCents, 0),
      remainingCents: remainingBudgetReserve(budget.amountCents, spending, budget.id, date),
      isFinished: spending.some(item => item.budgetId === budget.id && item.occurrenceDate === date && item.isFinished),
    })) })));
  }
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const parsed = budgetSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a name, positive budget amount, start date, and valid cadence." }, { status: 400 });
  const [row] = await db.insert(plannedBudgets).values({ name: parsed.data.name, amountCents: parsed.data.amount_cents,
    startDate: parsed.data.start_date, cadence: parsed.data.cadence }).returning();
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const body = await req.json().catch(() => null);
  const id = z.string().uuid().safeParse(body?.id);
  if (!id.success) return NextResponse.json({ error: "A valid budget ID is required." }, { status: 400 });
  const [row] = await db.update(plannedBudgets).set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(plannedBudgets.id, id.data), eq(plannedBudgets.isActive, true))).returning();
  if (!row) return NextResponse.json({ error: "Budget not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
