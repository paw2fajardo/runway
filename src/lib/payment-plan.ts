import { calculateRunwayForecast } from "./runway";
import type { PaymentPlanChange, PaymentPlanResponse, PaymentPlanScenario } from "./types";

type ForecastParams = Parameters<typeof calculateRunwayForecast>[0];

export function calculatePaymentPlan(params: ForecastParams, useGracePeriods = false): PaymentPlanResponse {
  const current = calculateRunwayForecast(params);
  const throughDate = current.timeline.at(-1)!.date;
  const today = current.timeline[0].date;

  function scenario(id: PaymentPlanScenario["id"], bills: ForecastParams["bills"],
    dailySpending: number, changes: PaymentPlanChange[]): PaymentPlanScenario {
    const forecast = calculateRunwayForecast({ ...params, bills, dailyDiscretionaryBurn: dailySpending });
    return { id, daily_spending_cents: dailySpending,
      minimum_balance_cents: Math.min(...forecast.timeline.map(day => day.balance)),
      shortfall_date: forecast.shortfall_date, timeline: forecast.timeline, changes };
  }

  function reduceSpending(id: PaymentPlanScenario["id"], bills: ForecastParams["bills"], changes: PaymentPlanChange[]) {
    let low = 0;
    let high = params.dailyDiscretionaryBurn;
    // Find the largest whole-cent daily allowance that avoids a shortfall.
    while (low < high) {
      const mid = low + Math.ceil((high - low) / 2);
      if (calculateRunwayForecast({ ...params, bills, dailyDiscretionaryBurn: mid }).is_solvent) low = mid;
      else high = mid - 1;
    }
    return scenario(id, bills, low, changes);
  }

  const baseline = scenario("current", params.bills, params.dailyDiscretionaryBurn, []);
  const scenarios = [baseline, reduceSpending("spending", params.bills, [])];
  if (useGracePeriods) {
    // shortcut: compares latest eligible dates; use constrained scheduling to minimize individual delays.
    const changes: PaymentPlanChange[] = [];
    const delayedBills = params.bills.map(bill => {
      if (bill.isAutoPay !== false || !["upcoming", "due_today", "grace_period"].includes(bill.status) ||
        !Number.isInteger(bill.gracePeriodDays) || bill.gracePeriodDays! <= 1 || bill.amountDue <= 0) return bill;
      const deadline = new Date(`${bill.originalDueDate ?? bill.dueDate}T00:00:00Z`);
      deadline.setUTCDate(deadline.getUTCDate() + bill.gracePeriodDays!);
      const graceEndDate = deadline.toISOString().slice(0, 10);
      // Leave one calendar day before the configured grace end; payment processing may take longer.
      deadline.setUTCDate(deadline.getUTCDate() - 1);
      const paymentDate = [deadline.toISOString().slice(0, 10), throughDate].sort()[0];
      if (bill.dueDate > throughDate || paymentDate <= bill.dueDate || paymentDate < today) return bill;
      changes.push({ id: bill.id, name: bill.name, amount_cents: bill.amountDue,
        due_date: bill.dueDate, payment_date: paymentDate, grace_end_date: graceEndDate });
      return { ...bill, dueDate: paymentDate };
    });
    const grace = scenario("grace", delayedBills, params.dailyDiscretionaryBurn, changes);
    // Avoid suggesting delays that do not improve the lowest projected daily balance.
    const improves = grace.minimum_balance_cents > baseline.minimum_balance_cents;
    const combined = reduceSpending("combined", delayedBills, changes);
    const spending = scenarios[1];
    const combinedImproves = combined.daily_spending_cents > spending.daily_spending_cents ||
      combined.minimum_balance_cents > spending.minimum_balance_cents;
    scenarios.push(improves ? grace : { ...baseline, id: "grace" },
      combinedImproves ? combined : { ...spending, id: "combined" });
  }
  return { through_date: throughDate, configured_daily_spending_cents: params.dailyDiscretionaryBurn, scenarios };
}
