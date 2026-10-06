import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../db";
import { accounts, billInstances, bills, categories } from "../../../../db/schema";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";

const idSchema = z.string().uuid();
const frequencySchema = z.enum(["weekly", "biweekly", "monthly", "every_2_months", "every_3_months", "every_6_months", "annually"]);
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["fixed_subscription", "variable_utility", "credit_card_statement", "loan_installment"]).optional(),
  source_account_id: z.string().uuid().nullable().optional(),
  target_account_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  amount: z.number().int().positive().optional(),
  is_estimate: z.boolean().optional(),
  is_auto_pay: z.boolean().optional(),
  is_variable_amount: z.boolean().optional(),
  due_day_of_month: z.number().int().min(1).max(31).optional(),
  due_day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  frequency: frequencySchema.optional(),
  occurrence_limit: z.number().int().min(1).max(600).nullable().optional(),
  grace_period_days: z.number().int().min(0).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const unpaidStatuses = new Set(["upcoming", "due_today", "grace_period", "past_due"]);
const weeklyFrequencies = new Set(["weekly", "biweekly"]);

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function firstDueDate(frequency: string, dayOfMonth: number, dayOfWeek: number | null, now: Date) {
  if (weeklyFrequencies.has(frequency)) {
    const offset = ((dayOfWeek ?? 0) - now.getDay() + 7) % 7;
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return date;
  }
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let due = new Date(now.getFullYear(), now.getMonth(), Math.min(dayOfMonth, lastDay));
  if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    const months = frequency === "every_2_months" ? 2 : frequency === "every_3_months" ? 3 : frequency === "every_6_months" ? 6 : frequency === "annually" ? 12 : 1;
    const monthStart = new Date(now.getFullYear(), now.getMonth() + months, 1);
    const nextLastDay = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    due = new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(dayOfMonth, nextLastDay));
  }
  return due;
}

function nextDueDate(date: Date, frequency: string, dayOfMonth: number, dayOfWeek: number | null) {
  if (frequency === "weekly" || frequency === "biweekly") {
    const next = new Date(date);
    next.setDate(next.getDate() + (frequency === "weekly" ? 7 : 14));
    return next;
  }
  const months = frequency === "every_2_months" ? 2 : frequency === "every_3_months" ? 3 : frequency === "every_6_months" ? 6 : frequency === "annually" ? 12 : 1;
  const monthStart = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  return new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(dayOfMonth, lastDay));
}

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: Context) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid bill identifier." }, { status: 400 });

  let parsed: z.infer<typeof updateSchema>;
  try {
    parsed = updateSchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(bills).where(and(eq(bills.id, id), eq(bills.isActive, true))).limit(1);
      if (!current) return null;

      if (parsed.category_id) {
        const [category] = await tx.select().from(categories).where(eq(categories.id, parsed.category_id)).limit(1);
        if (!category || category.isArchived) throw new Error("Selected category is unavailable.");
      }
      for (const accountId of [parsed.source_account_id, parsed.target_account_id]) {
        if (accountId) {
          const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.isActive, true))).limit(1);
          if (!account) throw new Error("Selected account is unavailable.");
        }
      }

      const updated = {
        ...current,
        frequency: parsed.frequency ?? current.frequency,
        dueDayOfMonth: parsed.due_day_of_month ?? current.dueDayOfMonth,
        dueDayOfWeek: parsed.due_day_of_week !== undefined ? parsed.due_day_of_week : current.dueDayOfWeek,
      };
      const weekly = weeklyFrequencies.has(updated.frequency);
      if ((weekly && updated.dueDayOfWeek == null) || (!weekly && updated.dueDayOfMonth == null)) {
        throw new Error(weekly ? "A due day of week is required for weekly bills." : "A due day of month is required for this frequency.");
      }
      const changedSchedule = parsed.frequency !== undefined || parsed.due_day_of_week !== undefined || parsed.due_day_of_month !== undefined;
      const now = new Date();
      const [bill] = await tx.update(bills).set({
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.type !== undefined && { type: parsed.type }),
        ...(parsed.source_account_id !== undefined && { sourceAccountId: parsed.source_account_id }),
        ...(parsed.target_account_id !== undefined && { targetAccountId: parsed.target_account_id }),
        ...(parsed.category_id !== undefined && { categoryId: parsed.category_id }),
        ...(parsed.amount !== undefined && { amount: parsed.amount }),
        ...(parsed.is_estimate !== undefined && { isEstimate: parsed.is_estimate }),
        ...(parsed.is_auto_pay !== undefined && { isAutoPay: parsed.is_auto_pay }),
        ...(parsed.is_variable_amount !== undefined && { isVariableAmount: parsed.is_variable_amount }),
        ...(parsed.due_day_of_month !== undefined && { dueDayOfMonth: parsed.due_day_of_month }),
        ...(parsed.due_day_of_week !== undefined && { dueDayOfWeek: parsed.due_day_of_week }),
        ...(parsed.frequency !== undefined && { frequency: parsed.frequency }),
        ...(parsed.occurrence_limit !== undefined && { occurrenceLimit: parsed.occurrence_limit }),
        ...(parsed.grace_period_days !== undefined && { gracePeriodDays: parsed.grace_period_days }),
        updatedAt: now,
      }).where(eq(bills.id, id)).returning();

      const allInstances = await tx.select().from(billInstances).where(eq(billInstances.billId, id));
      const instances = allInstances.filter((instance) => unpaidStatuses.has(instance.status));
      const occupiedPeriods = new Set(allInstances.filter((instance) => !unpaidStatuses.has(instance.status)).map((instance) => instance.periodIdentifier));
      let due = firstDueDate(updated.frequency, updated.dueDayOfMonth, updated.dueDayOfWeek, now);
      const ordered = [...instances].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      for (const [index, instance] of ordered.entries()) {
        const moveToNewSchedule = changedSchedule && index === 0;
        let dueDate = instance.dueDate;
        if (moveToNewSchedule) {
          dueDate = dateString(due);
          while (occupiedPeriods.has(dueDate)) {
            due = nextDueDate(due, updated.frequency, updated.dueDayOfMonth, updated.dueDayOfWeek);
            dueDate = dateString(due);
          }
          occupiedPeriods.add(dueDate);
        }
        await tx.update(billInstances).set({
          ...(moveToNewSchedule && { dueDate, targetSettlementDate: dueDate, periodIdentifier: dueDate }),
          ...(parsed.amount !== undefined && { amountDue: parsed.amount }),
          updatedAt: now,
        }).where(eq(billInstances.id, instance.id));
      }
      return { bill, instances: ordered.length };
    });
    if (!result) return NextResponse.json({ error: "Bill not found." }, { status: 404 });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update bill.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid bill identifier." }, { status: 400 });
  const [bill] = await db.update(bills).set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(bills.id, id), eq(bills.isActive, true))).returning();
  if (!bill) return NextResponse.json({ error: "Bill not found." }, { status: 404 });
  return NextResponse.json({ success: true, bill }, { status: 200 });
}
