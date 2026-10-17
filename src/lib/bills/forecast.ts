import { nextBillDueDate, type BillFrequency } from "../bill-schedule";

interface ForecastBillOccurrence {
  id: string;
  billId: string;
  name: string;
  dueDate: string;
  originalDueDate: string | null;
  amountDue: number;
  amount: number;
  status: string;
  gracePeriodDays: number;
  frequency: string;
  dueDayOfMonth: number;
  occurrenceLimit: number | null;
}

/** Extend saved occurrences for forecasting only; payments still create the real records. */
export function projectBillOccurrences(instances: ForecastBillOccurrence[], throughDate: string) {
  const projected = [...instances];
  const byBill = new Map<string, ForecastBillOccurrence[]>();
  for (const instance of instances) {
    const group = byBill.get(instance.billId) ?? [];
    group.push(instance);
    byBill.set(instance.billId, group);
  }
  for (const group of byBill.values()) {
    const latest = group.reduce((last, item) =>
      (item.originalDueDate ?? item.dueDate) > (last.originalDueDate ?? last.dueDate) ? item : last);
    let date = latest.originalDueDate ?? latest.dueDate;
    let count = group.length;
    while (latest.occurrenceLimit === null || count < latest.occurrenceLimit) {
      date = nextBillDueDate(date, latest.frequency as BillFrequency, latest.dueDayOfMonth);
      if (date > throughDate) break;
      projected.push({ ...latest, id: `projected:${latest.billId}:${date}`, dueDate: date,
        originalDueDate: null, amountDue: latest.amount, status: "upcoming" });
      count++;
    }
  }
  return projected;
}
