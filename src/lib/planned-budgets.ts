import type { PlannedBudget } from "./runway";

const DAY = 86400000;
export function plannedBudgetDates(budget: Pick<PlannedBudget, "startDate" | "cadence">, through: string, from = budget.startDate): string[] {
  if (budget.startDate > through) return [];
  if (budget.cadence === "once") return budget.startDate >= from ? [budget.startDate] : [];
  const dates: string[] = [];
  if (budget.cadence === "monthly") {
    const [year, month, day] = budget.startDate.split("-").map(Number);
    const lower = new Date(`${from}T00:00:00Z`);
    const start = Math.max(0, (lower.getUTCFullYear() - year) * 12 + lower.getUTCMonth() - month);
    for (let index = start; ; index++) {
      const date = new Date(`${budget.startDate}T00:00:00Z`);
      date.setUTCFullYear(year, month - 1 + index, 1);
      const monthEnd = new Date(date);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
      const last = monthEnd.getUTCDate();
      date.setUTCDate(Math.min(day, last));
      if (date.getTime() > Date.parse(`${through}T00:00:00Z`)) break;
      const value = date.toISOString().slice(0, 10);
      if (value >= from) dates.push(value);
    }
    return dates;
  }
  const interval = budget.cadence === "weekly" ? 7 : 14;
  const first = Date.parse(`${budget.startDate}T00:00:00Z`);
  const lower = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${through}T00:00:00Z`);
  for (let value = first + Math.max(0, Math.ceil((lower - first) / DAY / interval)) * interval * DAY; value <= end; value += interval * DAY) {
    dates.push(new Date(value).toISOString().slice(0, 10));
  }
  return dates;
}

export interface PlannedBudgetSpending { budgetId: string; occurrenceDate: string; amountCents: number; isFinished: boolean }
export function remainingBudgetReserve(amount: number, spending: PlannedBudgetSpending[], budgetId: string, date: string) {
  const linked = spending.filter(item => item.budgetId === budgetId && item.occurrenceDate === date);
  return linked.some(item => item.isFinished) ? 0 : Math.max(0, amount - linked.reduce((sum, item) => sum + item.amountCents, 0));
}
