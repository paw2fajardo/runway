import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { plannedBudgetExpenses, transactionLegs } from "../db/schema";

export async function loadPlannedBudgetSpending() {
  return db.select({ budgetId: plannedBudgetExpenses.budgetId, occurrenceDate: plannedBudgetExpenses.occurrenceDate,
    amountCents: transactionLegs.amount, isFinished: plannedBudgetExpenses.isFinished })
    .from(plannedBudgetExpenses).innerJoin(transactionLegs, and(eq(transactionLegs.transactionId, plannedBudgetExpenses.transactionId), isNotNull(transactionLegs.accountId)))
    .then(rows => rows.map(row => ({ ...row, amountCents: -row.amountCents })));
}
