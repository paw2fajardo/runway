import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../db";
import { accounts, billInstances, categories, paycheckOccurrences, transactionLegs, transactions } from "../../../../db/schema";
import { CompoundTransactionSchema } from "../../../../lib/types";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";
import { accountBalanceAdjustments, isQuickLogEligible } from "../../../../lib/transaction-crud";

const idSchema = z.string().uuid();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function loadEligible(tx: Tx, id: string) {
  const [parent] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  if (!parent) return null;
  const [legs, billRefs, paycheckRefs] = await Promise.all([
    tx.select().from(transactionLegs).where(eq(transactionLegs.transactionId, id)),
    tx.select({ id: billInstances.id }).from(billInstances).where(eq(billInstances.linkedTransactionId, id)).limit(1),
    tx.select({ id: paycheckOccurrences.id }).from(paycheckOccurrences).where(sql`${paycheckOccurrences.transactionId} = ${id} OR ${paycheckOccurrences.reversalTransactionId} = ${id}`).limit(1),
  ]);
  if (billRefs.length || paycheckRefs.length) return null;
  if (!isQuickLogEligible(parent.type, legs)) return null;
  return { parent, legs };
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req); if (originError) return originError;
  const owner = await requireOwner(req); if (owner instanceof Response) return owner;
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid transaction id." }, { status: 400 });
  try {
    const body = await req.json();
    const patch = z.object({ type: z.enum(["income", "expense", "transfer"]).optional(), description: z.string().min(1).optional(), transacted_at: z.string().datetime().optional(), source_account_id: z.string().uuid().nullable().optional(), destination_account_id: z.string().uuid().nullable().optional(), category_id: z.string().uuid().nullable().optional(), gross_outflow: z.number().int().nonnegative().optional(), net_inflow: z.number().int().nonnegative().optional(), fee_amount: z.number().int().nonnegative().optional() }).strict().parse(body);
    const result = await db.transaction(async (tx) => {
    const locked = await tx.select().from(transactions).where(eq(transactions.id, id)).for("update").limit(1);
    if (!locked.length) return null;
    const current = await loadEligible(tx, id);
    if (!current) return null;
    const accountLegs = current.legs.filter((leg) => leg.accountId);
    const categoryLegs = current.legs.filter((leg) => leg.categoryId);
    let feeLeg: (typeof categoryLegs)[number] | undefined;
    for (const leg of categoryLegs) {
      const [cat] = await tx.select().from(categories).where(eq(categories.id, leg.categoryId!)).limit(1);
      if (cat?.isSystemFee) { feeLeg = leg; break; }
    }
    const oldFee = current.parent.type === "expense"
      ? Math.max(0, -accountLegs[0].amount - categoryLegs.filter((leg) => leg.id !== feeLeg?.id).reduce((sum, leg) => sum + leg.amount, 0))
      : current.parent.type === "transfer"
        ? Math.max(0, -Math.min(...accountLegs.map((leg) => leg.amount)) - Math.max(...accountLegs.map((leg) => leg.amount)))
        : 0;
    const derived = current.parent.type === "expense" ? {
      source_account_id: accountLegs[0].accountId, gross_outflow: -accountLegs[0].amount,
      category_id: categoryLegs.find((leg) => leg.id !== feeLeg?.id)?.categoryId ?? null,
      fee_amount: oldFee,
    } : current.parent.type === "income" ? {
      destination_account_id: accountLegs[0].accountId, net_inflow: accountLegs[0].amount,
      category_id: categoryLegs.find((leg) => leg.id !== feeLeg?.id)?.categoryId ?? null,
    } : {
      source_account_id: accountLegs.find((leg) => leg.amount < 0)?.accountId,
      destination_account_id: accountLegs.find((leg) => leg.amount > 0)?.accountId,
      gross_outflow: -Math.min(...accountLegs.map((leg) => leg.amount)),
      net_inflow: Math.max(...accountLegs.map((leg) => leg.amount)), fee_amount: oldFee,
    };
    const parsed = CompoundTransactionSchema.parse({ ...derived, type: current.parent.type, description: current.parent.description, transacted_at: current.parent.transactedAt.toISOString(), ...patch });
    if ((parsed.type === "expense" && !parsed.source_account_id) || (parsed.type === "income" && !parsed.destination_account_id) || (parsed.type === "transfer" && (!parsed.source_account_id || !parsed.destination_account_id || parsed.source_account_id === parsed.destination_account_id))) throw new Error("Select valid account references for this transaction type.");
    const gross = parsed.gross_outflow ?? 0, net = parsed.net_inflow ?? 0, fee = parsed.fee_amount ?? 0;
    if (parsed.type === "expense" && (gross <= 0 || fee >= gross)) throw new Error("Expense amount must be positive and greater than its fee.");
    if (parsed.type === "income" && net <= 0) throw new Error("Income amount must be positive.");
    if (parsed.type === "transfer" && (gross <= 0 || net <= 0 || fee >= gross || gross - fee !== net)) throw new Error("Transfer amounts must have a positive net equal to gross minus fee.");
    if (parsed.category_id) {
      const [category] = await tx.select().from(categories).where(eq(categories.id, parsed.category_id)).limit(1);
      const changedCategory = parsed.category_id !== derived.category_id;
      if (!category || category.isSystemFee || (changedCategory && category.isArchived) || (parsed.type === "income" && !category.isIncome) || (parsed.type === "expense" && category.isIncome)) throw new Error("Selected category is unavailable.");
    }
    const newRefs = [parsed.source_account_id !== derived.source_account_id ? parsed.source_account_id : null, parsed.destination_account_id !== derived.destination_account_id ? parsed.destination_account_id : null].filter((value): value is string => Boolean(value));
    for (const accountId of new Set(newRefs)) {
      const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.isActive, true))).limit(1);
      if (!account) throw new Error("Selected account is unavailable.");
    }
    const feeCategory = parsed.fee_amount ? (await tx.select().from(categories).where(and(eq(categories.isSystemFee, true), eq(categories.isArchived, false))).limit(1))[0] : null;
      for (const [accountId, amount] of accountBalanceAdjustments(current.legs, "reverse")) await tx.update(accounts).set({ currentBalance: sql`${accounts.currentBalance} + ${amount}`, updatedAt: new Date() }).where(eq(accounts.id, accountId));
      await tx.delete(transactionLegs).where(eq(transactionLegs.transactionId, id));
      await tx.update(transactions).set({ type: parsed.type, description: parsed.description, transactedAt: new Date(parsed.transacted_at) }).where(eq(transactions.id, id));
      const newAccountLegs: { accountId: string | null; amount: number }[] = [];
      const add = async (accountId: string | null | undefined, categoryId: string | null | undefined, amount: number) => { await tx.insert(transactionLegs).values({ transactionId: id, accountId: accountId ?? null, categoryId: categoryId ?? null, amount }); if (accountId) newAccountLegs.push({ accountId, amount }); };
      if (parsed.type === "expense") { const gross = parsed.gross_outflow ?? 0, fee = parsed.fee_amount ?? 0; await add(parsed.source_account_id, null, -gross); await add(null, parsed.category_id, gross - fee); if (fee) await add(null, feeCategory?.id, fee); }
      else if (parsed.type === "income") { const net = parsed.net_inflow ?? 0; await add(parsed.destination_account_id, null, net); await add(null, parsed.category_id, -net); }
      else { const gross = parsed.gross_outflow ?? 0, net = parsed.net_inflow ?? gross - (parsed.fee_amount ?? 0), fee = parsed.fee_amount ?? 0; await add(parsed.source_account_id, null, -gross); await add(parsed.destination_account_id, null, net); if (fee) await add(null, feeCategory?.id, fee); }
      for (const [accountId, amount] of accountBalanceAdjustments(newAccountLegs, "apply")) await tx.update(accounts).set({ currentBalance: sql`${accounts.currentBalance} + ${amount}`, updatedAt: new Date() }).where(eq(accounts.id, accountId));
      return { id };
    });
    if (!result) return NextResponse.json({ error: "Transaction not found or cannot be edited." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid transaction." }, { status: 400 }); }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req); if (originError) return originError;
  const owner = await requireOwner(req); if (owner instanceof Response) return owner;
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid transaction id." }, { status: 400 });
  try {
    const deleted = await db.transaction(async (tx) => {
      const locked = await tx.select().from(transactions).where(eq(transactions.id, id)).for("update").limit(1);
      if (!locked.length) return false;
      const record = await loadEligible(tx, id);
      if (!record) return false;
      for (const [accountId, amount] of accountBalanceAdjustments(record.legs, "reverse")) await tx.update(accounts).set({ currentBalance: sql`${accounts.currentBalance} + ${amount}`, updatedAt: new Date() }).where(eq(accounts.id, accountId));
      await tx.delete(transactions).where(eq(transactions.id, id));
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "Transaction not found or cannot be deleted." }, { status: 404 });
    return NextResponse.json({ id, deleted: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete transaction." }, { status: 400 }); }
}
