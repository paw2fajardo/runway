export type BillFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "every_2_months"
  | "every_3_months"
  | "every_6_months"
  | "annually";

const intervalMonths: Partial<Record<BillFrequency, number>> = {
  monthly: 1,
  every_2_months: 2,
  every_3_months: 3,
  every_6_months: 6,
  annually: 12,
};

export function nextBillDueDate(
  dueDate: string,
  frequency: BillFrequency,
  dueDayOfMonth: number,
): string {
  const [year, month, day] = dueDate.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));

  if (frequency === "weekly" || frequency === "biweekly") {
    current.setUTCDate(current.getUTCDate() + (frequency === "weekly" ? 7 : 14));
  } else {
    const nextMonth = month - 1 + intervalMonths[frequency]!;
    const nextYear = year + Math.floor(nextMonth / 12);
    const monthIndex = nextMonth % 12;
    const lastDay = new Date(Date.UTC(nextYear, monthIndex + 1, 0)).getUTCDate();
    return `${nextYear}-${String(monthIndex + 1).padStart(2, "0")}-${String(Math.min(dueDayOfMonth, lastDay)).padStart(2, "0")}`;
  }

  return current.toISOString().slice(0, 10);
}
