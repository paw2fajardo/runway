import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "../db";
import { accounts, balanceCheckpoints, billInstances, billPaymentEvents, bills, categories, inboxItems, transactionLegs, transactions } from "../db/schema";
import { ParsedInboxItemSchema } from "./types";
import { todayInManila } from "./bills/due-date";
import { insightDate, merchantKey, reconciliationInsights, recurringInsights, spendingInsights, variableBillEstimates,
  type InsightExpense, type InsightEvidence, type InsightsResponse } from "./insights";

export async function loadInsights(): Promise<InsightsResponse> {
  const today = todayInManila();
  const fromDate = insightDate(today, -180);
  const from = new Date(`${fromDate}T00:00:00+08:00`);
  const through = new Date(`${insightDate(today, 1)}T00:00:00+08:00`);
  const [parents, accountList, checkpoints, billList, instances, paymentEvents, pending] = await Promise.all([
    db.select().from(transactions).where(and(gte(transactions.transactedAt, from), lt(transactions.transactedAt, through))).orderBy(desc(transactions.transactedAt)).limit(10001),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.isActive, true)),
    db.select().from(balanceCheckpoints).where(and(gte(balanceCheckpoints.checkpointAt, from), lt(balanceCheckpoints.checkpointAt, through))).orderBy(desc(balanceCheckpoints.checkpointAt)).limit(10001),
    db.select().from(bills).where(eq(bills.isActive, true)),
    db.select().from(billInstances),
    db.select().from(billPaymentEvents),
    db.select().from(inboxItems).where(eq(inboxItems.status, "pending")).limit(1001),
  ]);
  const rows = parents.slice(0, 10000);
  const legs = rows.length ? await db.select({ leg: transactionLegs, category: categories })
    .from(transactionLegs).leftJoin(categories, eq(transactionLegs.categoryId, categories.id))
    .where(inArray(transactionLegs.transactionId, rows.map(item => item.id))) : [];
  const grouped = new Map<string, typeof legs>();
  for (const row of legs) grouped.set(row.leg.transactionId, [...(grouped.get(row.leg.transactionId) ?? []), row]);
  const billTransactions = new Set([...instances.map(item => item.linkedTransactionId), ...paymentEvents.map(item => item.transactionId)]);
  const expenses: InsightExpense[] = [];
  for (const transaction of rows) {
    const detail = grouped.get(transaction.id) ?? [];
    const accountLegs = detail.filter(item => item.leg.accountId !== null);
    if (transaction.description === "Balance Adjustment Drift" && detail.length === 1) continue;
    const allocations = detail.filter(item => item.leg.accountId === null && item.leg.amount > 0 &&
      (transaction.type === "expense" || (transaction.type === "transfer" && item.category?.isSystemFee)))
      .map(item => ({ id: item.leg.categoryId, name: item.category?.name ?? "Unclassified", amount: item.leg.amount }));
    const amount = transaction.type === "expense"
      ? accountLegs.filter(item => item.leg.amount < 0).reduce((total, item) => total - item.leg.amount, 0)
      : transaction.type === "transfer" ? allocations.reduce((total, item) => total + item.amount, 0) : 0;
    if (amount <= 0) continue;
    expenses.push({ id: transaction.id, description: transaction.description, date: todayInManila(transaction.transactedAt),
      timestamp: transaction.transactedAt.getTime(), amount, accountId: accountLegs.find(item => item.leg.amount < 0)?.leg.accountId ?? null,
      billPayment: transaction.type === "transfer" || billTransactions.has(transaction.id), categories: allocations });
  }
  for (const instance of instances) {
    if (!instance.cashPaidAt || instance.status !== "paid" || instance.cashPaidAt < from || instance.cashPaidAt >= through) continue;
    const bill = billList.find(item => item.id === instance.billId);
    expenses.push({ id: `cash:${instance.id}`, description: bill?.name ?? "Cash bill payment", date: todayInManila(instance.cashPaidAt),
      timestamp: instance.cashPaidAt.getTime(), amount: instance.amountDue, accountId: null, billPayment: true, categories: [] });
  }
  const checkpointRows = checkpoints.slice(0, 10000).map(item => ({ id: item.id, accountId: item.accountId,
    date: todayInManila(item.checkpointAt), timestamp: item.checkpointAt.getTime(), discrepancy: item.discrepancyAmount }));
  const evidence: InsightEvidence[] = [];
  for (const item of pending.slice(0, 1000)) {
    const parsed = ParsedInboxItemSchema.safeParse(item.parsedJson);
    if (!parsed.success || !parsed.data.transacted_at) continue;
    const data = parsed.data;
    const matchingAccounts = accountList.filter(account => merchantKey(account.name) === merchantKey(data.source_account_hint ?? ""));
    const date = new Date(data.transacted_at!);
    if (matchingAccounts.length !== 1 || !Number.isFinite(date.getTime())) continue;
    evidence.push({ id: item.id, description: data.merchant, amount: data.amount_cents,
      date: todayInManila(date), accountId: matchingAccounts[0].id, type: data.type });
  }
  return { history_from_date: fromDate, history_truncated: parents.length > 10000 || checkpoints.length > 10000 || pending.length > 1000,
    weekly: spendingInsights(expenses, checkpointRows, today), recurring: recurringInsights(expenses),
    variable_bills: variableBillEstimates(billList.map(bill => ({ id: bill.id, name: bill.name, isVariable: bill.isVariableAmount,
      samples: instances.filter(item => item.billId === bill.id && ["paid", "auto_debited"].includes(item.status) && item.dueDate <= today)
        .map(item => ({ date: item.dueDate, amount: item.amountDue })) }))),
    reconciliation: reconciliationInsights(checkpointRows, evidence), accounts: accountList };
}
