import { calculateRunwayForecast } from "./runway";

export function calculatePurchaseScenarios(params: Parameters<typeof calculateRunwayForecast>[0], amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("Purchase amount must be positive whole centavos");
  const baseline = calculateRunwayForecast(params);
  const today = baseline.timeline[0].date;
  const through = baseline.timeline.at(-1)!.date;
  const buyOn = (date: string) => calculateRunwayForecast({ ...params, bills: [...params.bills,
    { id: "scenario:purchase", name: "Hypothetical purchase", dueDate: date, amountDue: amountCents, status: "upcoming" }] });
  return { amount_cents: amountCents, now: buyOn(today),
    after_payday: baseline.next_payday_date <= through ? buyOn(baseline.next_payday_date) : null };
}
