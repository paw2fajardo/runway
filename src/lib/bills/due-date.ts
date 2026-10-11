export function todayInManila(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function billDueState(due: { dueDate: string; status: string }, today: string) {
  if (due.status === "grace_period" || due.status === "past_due" || due.dueDate < today) {
    return "past_due";
  }
  return due.dueDate === today ? "due_today" : "upcoming";
}
