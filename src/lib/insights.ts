import type { RunwayForecastResponse } from "./types";

export const insightDate = (date: string, offset: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
export const merchantKey = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sum = (values: number[]) => values.reduce((total, value) => {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new Error("Insight amount exceeds safe integer cents");
  return next;
}, 0);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const left = sorted[Math.floor((sorted.length - 1) / 2)];
  const right = sorted[Math.floor(sorted.length / 2)];
  return left + Math.round((right - left) / 2);
};

export interface InsightExpense {
  id: string; description: string; date: string; timestamp: number; amount: number;
  accountId: string | null; billPayment: boolean;
  categories: { id: string | null; name: string; amount: number }[];
}
export interface InsightCheckpoint { id: string; accountId: string; date: string; timestamp: number; discrepancy: number }
export interface InsightEvidence { id: string; description: string; amount: number; date: string; accountId: string | null; type: string }
export interface InsightBillHistory { id: string; name: string; isVariable: boolean; samples: { date: string; amount: number }[] }

export function spendingInsights(expenses: InsightExpense[], checkpoints: InsightCheckpoint[], today: string) {
  const currentFrom = insightDate(today, -6);
  const previousFrom = insightDate(today, -13);
  const current = expenses.filter(item => item.date >= currentFrom && item.date <= today);
  const previous = expenses.filter(item => item.date >= previousFrom && item.date < currentFrom);
  const groups = new Map<string, { name: string; current: number; previous: number; transaction_ids: string[] }>();
  for (const [rows, period] of [[previous, "previous"], [current, "current"]] as const) {
    for (const expense of rows) {
      const allocations = [...expense.categories];
      const allocated = sum(allocations.map(item => item.amount));
      if (allocated < expense.amount) allocations.push({ id: null, name: "Unclassified", amount: expense.amount - allocated });
      if (allocated > expense.amount) throw new Error("Expense category allocations exceed its amount");
      for (const allocation of allocations) {
        const key = allocation.id ?? "unclassified";
        const group = groups.get(key) ?? { name: allocation.name, current: 0, previous: 0, transaction_ids: [] };
        group[period] = sum([group[period], allocation.amount]);
        if (period === "current" && !group.transaction_ids.includes(expense.id)) group.transaction_ids.push(expense.id);
        groups.set(key, group);
      }
    }
  }
  const total = sum(current.map(item => item.amount));
  const previousTotal = sum(previous.map(item => item.amount));
  return { from_date: currentFrom, through_date: today, previous_from_date: previousFrom,
    current_cents: total, previous_cents: previousTotal, change_cents: total - previousTotal,
    unclassified_cents: groups.get("unclassified")?.current ?? 0,
    unexplained_decreases_cents: sum(checkpoints.filter(item => item.date >= currentFrom && item.date <= today && item.discrepancy < 0).map(item => -item.discrepancy)),
    categories: [...groups.values()].map(item => ({ ...item, change_cents: item.current - item.previous }))
      .sort((a, b) => b.change_cents - a.change_cents || a.name.localeCompare(b.name)),
  };
}

export function recurringInsights(expenses: InsightExpense[]) {
  const groups = new Map<string, InsightExpense[]>();
  const duplicates: { description: string; amount_cents: number; transaction_ids: string[] }[] = [];
  for (const item of expenses) {
    if (!item.accountId || item.billPayment || !merchantKey(item.description) || item.amount <= 0) continue;
    const key = `${item.accountId}:${merchantKey(item.description)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const recurring: { description: string; cadence: string; amount_cents: number; previous_amount_cents: number;
    increase_cents: number; next_expected_date: string; transaction_ids: string[] }[] = [];
  for (const rows of groups.values()) {
    const ordered = [...rows].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    const distinct: InsightExpense[] = [];
    for (const item of ordered) {
      const prior = distinct.at(-1);
      if (prior && item.amount === prior.amount && item.timestamp - prior.timestamp <= 15 * 60_000) {
        duplicates.push({ description: item.description, amount_cents: item.amount, transaction_ids: [prior.id, item.id] });
      } else distinct.push(item);
    }
    if (distinct.length < 3) continue;
    const recent = distinct.slice(-6);
    const gaps = recent.slice(1).map((item, index) =>
      Math.round((Date.parse(item.date) - Date.parse(recent[index].date)) / 86_400_000));
    const cadence = gaps.every(gap => gap >= 5 && gap <= 9) ? "weekly"
      : gaps.every(gap => gap >= 12 && gap <= 16) ? "biweekly"
      : gaps.every(gap => gap >= 26 && gap <= 35) ? "monthly" : null;
    if (!cadence) continue;
    const latest = recent.at(-1)!;
    const previous = median(recent.slice(0, -1).map(item => item.amount));
    recurring.push({ description: latest.description, cadence, amount_cents: latest.amount, previous_amount_cents: previous,
      increase_cents: Math.max(0, latest.amount - previous), next_expected_date: insightDate(latest.date, median(gaps)),
      transaction_ids: recent.map(item => item.id) });
  }
  return { recurring, duplicates };
}

export function variableBillEstimates(history: InsightBillHistory[]) {
  return history.filter(bill => bill.isVariable).map(bill => {
    const samples = [...bill.samples].filter(item => Number.isSafeInteger(item.amount) && item.amount > 0)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    return { id: bill.id, name: bill.name, sample_count: samples.length,
      estimate_cents: samples.length >= 3 ? median(samples.map(item => item.amount)) : null,
      low_cents: samples.length >= 3 ? Math.min(...samples.map(item => item.amount)) : null,
      high_cents: samples.length >= 3 ? Math.max(...samples.map(item => item.amount)) : null };
  });
}

export function reconciliationInsights(checkpoints: InsightCheckpoint[], evidence: InsightEvidence[]) {
  const ordered = [...checkpoints].sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Set<string>();
  return ordered.filter(item => { if (seen.has(item.accountId)) return false; seen.add(item.accountId); return item.discrepancy !== 0; })
    .map(checkpoint => {
      const previous = ordered.find(item => item.accountId === checkpoint.accountId && item.timestamp < checkpoint.timestamp);
      const candidates = evidence.filter(item => item.accountId === checkpoint.accountId && item.date <= checkpoint.date &&
        item.date > (previous?.date ?? insightDate(checkpoint.date, -30)) && item.amount === Math.abs(checkpoint.discrepancy) &&
        (checkpoint.discrepancy < 0 ? item.type === "expense" : item.type === "income"));
      return { checkpoint_id: checkpoint.id, account_id: checkpoint.accountId, date: checkpoint.date,
        discrepancy_cents: checkpoint.discrepancy, candidates: candidates.map(item => ({ id: item.id, description: item.description, amount_cents: item.amount })) };
    });
}

export function compareForecasts(previous: RunwayForecastResponse, current: RunwayForecastResponse) {
  const fields = ["current_liquid_cash", "scheduled_bills_total", "planned_spending_total", "discretionary_burn_total", "net_projected_buffer"] as const;
  const overlap = new Map(previous.timeline.map(day => [day.date, day.balance]));
  const beforeBills = new Map((previous.comparison_bills ?? []).map(bill => [bill.key, bill]));
  const afterBills = new Map((current.comparison_bills ?? []).map(bill => [bill.key, bill]));
  const unpaid = (status?: string) => status !== undefined && !["paid", "auto_debited", "skipped"].includes(status);
  const billChanges = previous.comparison_bills && current.comparison_bills
    ? [...new Set([...beforeBills.keys(), ...afterBills.keys()])].flatMap(key => {
      const before = beforeBills.get(key); const after = afterBills.get(key);
      if (!unpaid(before?.status) && !unpaid(after?.status)) return [];
      if (before && after && before.due_date === after.due_date && before.amount_cents === after.amount_cents && before.status === after.status) return [];
      return [{ name: after?.name ?? before!.name, before: before ?? null, after: after ?? null }];
    }) : [];
  return { metrics: fields.map(field => ({ field, before_cents: previous[field], after_cents: current[field], change_cents: current[field] - previous[field] })),
    previous_payday: previous.next_payday_date, current_payday: current.next_payday_date,
    overlapping_days: current.timeline.filter(day => overlap.has(day.date)).length,
    bill_changes: billChanges,
    changed_days: current.timeline.filter(day => overlap.has(day.date) && overlap.get(day.date) !== day.balance)
      .map(day => ({ date: day.date, before_cents: overlap.get(day.date)!, after_cents: day.balance })),
  };
}

export interface InsightsResponse {
  history_from_date: string; history_truncated: boolean;
  weekly: ReturnType<typeof spendingInsights>;
  recurring: ReturnType<typeof recurringInsights>;
  variable_bills: ReturnType<typeof variableBillEstimates>;
  reconciliation: ReturnType<typeof reconciliationInsights>;
  accounts: { id: string; name: string }[];
}
