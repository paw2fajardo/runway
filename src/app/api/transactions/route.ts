import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { accounts, billInstances, billPaymentEvents, categories, paycheckOccurrences, transactionLegs, transactions } from "../../../db/schema";
import { assertSameOrigin, requireOwner } from "../../../lib/auth/guard";
import { isQuickLogEligible } from "../../../lib/transaction-crud";

const PAGE_SIZE = 50;
const transactionTypeSchema = z.enum(["income", "expense", "transfer"]);
const uuidSchema = z.string().uuid();

export async function GET(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  const params = req.nextUrl.searchParams;
  const pageValue = Number(params.get("page") ?? "1");
  if (!Number.isInteger(pageValue) || pageValue < 1 || pageValue > 1_000_000) {
    return NextResponse.json({ error: "Page must be a positive whole number." }, { status: 400 });
  }

  const typeValue = params.get("type");
  const type = typeValue ? transactionTypeSchema.safeParse(typeValue) : null;
  if (type?.success === false) return NextResponse.json({ error: "Choose a valid transaction type." }, { status: 400 });

  const accountValue = params.get("account");
  const account = accountValue ? uuidSchema.safeParse(accountValue) : null;
  if (account?.success === false) return NextResponse.json({ error: "Choose a valid account." }, { status: 400 });

  const categoryValue = params.get("category");
  const category = categoryValue ? uuidSchema.safeParse(categoryValue) : null;
  if (category?.success === false) return NextResponse.json({ error: "Choose a valid category." }, { status: 400 });

  const parseDate = (key: "from" | "to") => {
    const value = params.get(key);
    if (!value) return { value: null, invalid: false };
    const date = new Date(value);
    return { value: date, invalid: !Number.isFinite(date.getTime()) };
  };
  const from = parseDate("from");
  const to = parseDate("to");
  if (from.invalid || to.invalid || (from.value && to.value && from.value >= to.value)) {
    return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  }

  const search = (params.get("search") ?? "").trim().slice(0, 100).toLocaleLowerCase();
  const parents = await db.select().from(transactions);
  if (!parents.length) return NextResponse.json({
    transactions: [], page: pageValue, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 1,
    totals: { inflow: 0, outflow: 0, net: 0 },
  });

  const ids = parents.map((item) => item.id);
  const [legs, settlements, billEvents, paychecks] = await Promise.all([
    db.select().from(transactionLegs).where(inArray(transactionLegs.transactionId, ids)),
    db.select({ id: billInstances.linkedTransactionId }).from(billInstances).where(inArray(billInstances.linkedTransactionId, ids)),
    db.select({ id: billPaymentEvents.transactionId }).from(billPaymentEvents).where(inArray(billPaymentEvents.transactionId, ids)),
    db.select({ id: paycheckOccurrences.transactionId, reversal: paycheckOccurrences.reversalTransactionId }).from(paycheckOccurrences),
  ]);
  const billSettlementIds = new Set<string>();
  settlements.forEach((row) => { if (row.id) billSettlementIds.add(row.id); });
  billEvents.forEach((row) => billSettlementIds.add(row.id));
  const protectedIds = new Set<string>();
  paychecks.forEach((row) => { if (row.id) protectedIds.add(row.id); if (row.reversal) protectedIds.add(row.reversal); });

  const grouped = new Map<string, typeof legs>();
  legs.forEach((leg) => grouped.set(leg.transactionId, [...(grouped.get(leg.transactionId) ?? []), leg]));
  const eligible = parents.filter((parent) => {
    if (protectedIds.has(parent.id) || (type?.success && parent.type !== type.data)) return false;
    const parentLegs = grouped.get(parent.id) ?? [];
    return billSettlementIds.has(parent.id) || isQuickLogEligible(parent.type, parentLegs);
  });
  if (!eligible.length) return NextResponse.json({
    transactions: [], page: pageValue, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 1,
    totals: { inflow: 0, outflow: 0, net: 0 },
  });

  const eligibleIds = eligible.map((item) => item.id);
  const detailLegs = await db.select({ leg: transactionLegs, account: accounts, category: categories })
    .from(transactionLegs)
    .leftJoin(accounts, eq(transactionLegs.accountId, accounts.id))
    .leftJoin(categories, eq(transactionLegs.categoryId, categories.id))
    .where(inArray(transactionLegs.transactionId, eligibleIds));
  const byId = new Map<string, typeof detailLegs>();
  detailLegs.forEach((row) => byId.set(row.leg.transactionId, [...(byId.get(row.leg.transactionId) ?? []), row]));

  const filtered = eligible.filter((transaction) => {
    if (from.value && transaction.transactedAt < from.value) return false;
    if (to.value && transaction.transactedAt >= to.value) return false;
    const detail = byId.get(transaction.id) ?? [];
    if (account?.success && !detail.some((item) => item.leg.accountId === account.data)) return false;
    if (category?.success && !detail.some((item) => item.leg.categoryId === category.data)) return false;
    if (search) {
      const searchable = [
        transaction.description,
        ...detail.flatMap((item) => [item.account?.name, item.category?.name]),
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      if (!searchable.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => b.transactedAt.getTime() - a.transactedAt.getTime() || b.id.localeCompare(a.id));

  const amountFor = (transaction: (typeof filtered)[number]) => {
    const accountAmounts = (byId.get(transaction.id) ?? [])
      .filter((item) => item.leg.accountId !== null)
      .map((item) => item.leg.amount);
    if (transaction.type === "income") return Math.max(0, ...accountAmounts);
    if (transaction.type === "transfer") return Math.max(0, ...accountAmounts.filter((amount) => amount < 0).map(Math.abs));
    return Math.max(0, ...accountAmounts.filter((amount) => amount < 0).map(Math.abs));
  };
  const totals = filtered.reduce((summary, transaction) => {
    const amount = amountFor(transaction);
    if (transaction.type === "income") summary.inflow += amount;
    if (transaction.type === "expense") summary.outflow += amount;
    return summary;
  }, { inflow: 0, outflow: 0, net: 0 });
  totals.net = totals.inflow - totals.outflow;

  const offset = (pageValue - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(offset, offset + PAGE_SIZE);
  const transactionDetails = pageRows.map((transaction) => ({
    ...transaction,
    source: billSettlementIds.has(transaction.id) ? "bill_payment" : "quick_log",
    legs: byId.get(transaction.id) ?? [],
  }));
  return NextResponse.json({
    transactions: transactionDetails,
    page: pageValue,
    pageSize: PAGE_SIZE,
    totalCount: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    totals,
  });
}
