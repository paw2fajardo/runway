import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { plannedBudgets } from "../../../db/schema";
import { DateOnlySchema } from "../../../lib/types";
import { assertSameOrigin, requireOwner } from "../../../lib/auth/guard";

const budgetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  start_date: DateOnlySchema,
  cadence: z.enum(["once", "weekly", "biweekly", "monthly"]),
}).strict();

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const rows = await db.select().from(plannedBudgets).where(eq(plannedBudgets.isActive, true)).orderBy(plannedBudgets.startDate);
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
