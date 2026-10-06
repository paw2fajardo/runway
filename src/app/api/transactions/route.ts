import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { accounts, billInstances, categories, paycheckOccurrences, transactionLegs, transactions } from "../../../db/schema";
import { assertSameOrigin, requireOwner } from "../../../lib/auth/guard";
import { isQuickLogEligible } from "../../../lib/transaction-crud";

export async function GET(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  const parents = await db.select().from(transactions).orderBy(transactions.transactedAt);
  if (!parents.length) return NextResponse.json({ transactions: [] });
  const ids = parents.map((item) => item.id);
  const [legs, settlements, paychecks] = await Promise.all([
    db.select().from(transactionLegs).where(inArray(transactionLegs.transactionId, ids)),
    db.select({ id: billInstances.linkedTransactionId }).from(billInstances).where(inArray(billInstances.linkedTransactionId, ids)),
    db.select({ id: paycheckOccurrences.transactionId, reversal: paycheckOccurrences.reversalTransactionId }).from(paycheckOccurrences),
  ]);
  const protectedIds = new Set<string>();
  settlements.forEach((row) => { if (row.id) protectedIds.add(row.id); });
  paychecks.forEach((row) => { if (row.id) protectedIds.add(row.id); if (row.reversal) protectedIds.add(row.reversal); });
  const grouped = new Map<string, typeof legs>();
  legs.forEach((leg) => grouped.set(leg.transactionId, [...(grouped.get(leg.transactionId) ?? []), leg]));
  const eligible = parents.filter((parent) => {
    if (protectedIds.has(parent.id)) return false;
    const parentLegs = grouped.get(parent.id) ?? [];
    return isQuickLogEligible(parent.type, parentLegs);
  });
  if (!eligible.length) return NextResponse.json({ transactions: [] });
  const eligibleIds = eligible.map((item) => item.id);
  const detailLegs = await db.select({ leg: transactionLegs, account: accounts, category: categories })
    .from(transactionLegs)
    .leftJoin(accounts, eq(transactionLegs.accountId, accounts.id))
    .leftJoin(categories, eq(transactionLegs.categoryId, categories.id))
    .where(inArray(transactionLegs.transactionId, eligibleIds));
  const byId = new Map<string, typeof detailLegs>();
  detailLegs.forEach((row) => byId.set(row.leg.transactionId, [...(byId.get(row.leg.transactionId) ?? []), row]));
  return NextResponse.json({ transactions: eligible.map((transaction) => ({ ...transaction, legs: byId.get(transaction.id) ?? [] })) });
}
