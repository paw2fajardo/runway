import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../db";
import { accounts, projectionSettings, incomeStreams, paycheckOccurrences, billInstances, bills, plannedBudgets } from "../../../../db/schema";
import { calculateRunwayForecast } from "../../../../lib/runway";
import { eq, and } from "drizzle-orm";
import { DateOnlySchema } from "../../../../lib/types";
import { requireOwner } from "../../../../lib/auth/guard";
import { loadPlannedBudgetSpending } from "../../../../lib/planned-budget-spending";
import { projectBillOccurrences } from "../../../../lib/bills/forecast";
import { calculatePaymentPlan } from "../../../../lib/payment-plan";
import { calculatePurchaseScenarios } from "../../../../lib/purchase-scenarios";

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const { searchParams } = new URL(req.url);
    const horizonDays = Number(searchParams.get("horizon_days") || "14");
    const dateParam = searchParams.get("reference_date");
    const paymentPlan = searchParams.get("payment_plan");
    const useGracePeriods = searchParams.get("use_grace_periods");
    const comparisonInputs = searchParams.get("comparison_inputs");
    const purchase = searchParams.get("purchase_cents");
    if (purchase !== null && (!/^[1-9]\d*$/.test(purchase) || !Number.isSafeInteger(Number(purchase)))) {
      return NextResponse.json({ error: "Enter a positive purchase amount in whole centavos." }, { status: 400 });
    }
    if ([paymentPlan, useGracePeriods, comparisonInputs].some(value => value !== null && value !== "true" && value !== "false")) {
      return NextResponse.json({ error: "Use true or false for payment planning options." }, { status: 400 });
    }
    if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366 || (dateParam !== null && !DateOnlySchema.safeParse(dateParam).success)) {
      return NextResponse.json({ error: "Use a valid reference date and a horizon between 1 and 366 days." }, { status: 400 });
    }
    const referenceDate = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

    // 1. Fetch liquid accounts
    const liquidAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.type, "liquid"), eq(accounts.isActive, true)));

    const currentLiquidCash = liquidAccounts.reduce(
      (sum, acc) => sum + acc.currentBalance,
      0
    );

    // 2. Fetch projection settings
    const [proj] = await db.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    if (!proj) return NextResponse.json({ error: "Set up your pay schedule to calculate your runway.", code: "PAY_SCHEDULE_NOT_CONFIGURED" }, { status: 409 });
    const streams = await db.select().from(incomeStreams).where(and(eq(incomeStreams.projectionSettingsId, proj.id), eq(incomeStreams.isEnabled, true)));
    if (!streams.length) return NextResponse.json({ error: "Add or enable an income stream to calculate your runway.", code: "NO_ENABLED_INCOME_STREAMS" }, { status: 409 });
    const occurrences = await db.select({
      id: paycheckOccurrences.id,
      incomeStreamId: paycheckOccurrences.incomeStreamId,
      kind: paycheckOccurrences.kind,
      dueDate: paycheckOccurrences.dueDate,
      retryDate: paycheckOccurrences.retryDate,
      amountCents: paycheckOccurrences.amountSnapshot,
      transactionId: paycheckOccurrences.transactionId,
      status: paycheckOccurrences.status,
      parentOccurrenceId: paycheckOccurrences.parentOccurrenceId,
    }).from(paycheckOccurrences);
    const occurrenceById = new Map(occurrences.map(occurrence => [occurrence.id, occurrence]));
    const forecastOccurrences = occurrences.map(occurrence => ({
      ...occurrence,
      parentStatus: occurrence.parentOccurrenceId
        ? occurrenceById.get(occurrence.parentOccurrenceId)?.status ?? null
        : null,
    }));
    const expectedSalaryAmount = proj.expectedSalaryAmount;
    const salaryCycleDays = proj.salaryCycleDays;
    const dailyDiscretionaryBurn = proj.dailyDiscretionaryBurn;
    const budgetList = await db.select({ id: plannedBudgets.id, name: plannedBudgets.name,
      amountCents: plannedBudgets.amountCents, startDate: plannedBudgets.startDate, cadence: plannedBudgets.cadence })
      .from(plannedBudgets).where(eq(plannedBudgets.isActive, true));

    // 3. Fetch active bills and instances
    const billList = await db
      .select({
        id: billInstances.id,
        billId: bills.id,
        name: bills.name,
        dueDate: billInstances.dueDate,
        originalDueDate: billInstances.originalDueDate,
        amountDue: billInstances.amountDue,
        amount: bills.amount,
        status: billInstances.status,
        gracePeriodDays: bills.gracePeriodDays,
        isAutoPay: bills.isAutoPay,
        frequency: bills.frequency,
        dueDayOfMonth: bills.dueDayOfMonth,
        occurrenceLimit: bills.occurrenceLimit,
      })
      .from(billInstances)
      .innerJoin(bills, eq(billInstances.billId, bills.id))
      .where(eq(bills.isActive, true));

    const through = new Date(referenceDate);
    through.setDate(through.getDate() + horizonDays - 1);
    const throughDate = `${through.getFullYear()}-${String(through.getMonth() + 1).padStart(2, "0")}-${String(through.getDate()).padStart(2, "0")}`;

    // 4. Calculate forward runway forecast
    const forecastParams = {
      currentLiquidCash,
      salaryCycleDays,
      biweeklyPaydayAnchor: proj.biweeklyPaydayAnchor,
      payScheduleKind: proj.payScheduleKind,
      payIntervalDays: proj.payIntervalDays,
      expectedSalaryAmount,
      incomeStreams: streams,
      paycheckOccurrences: forecastOccurrences,
      dailyDiscretionaryBurn,
      bills: projectBillOccurrences(billList, throughDate),
      plannedBudgets: budgetList as import("../../../../lib/runway").PlannedBudget[],
      plannedBudgetSpending: await loadPlannedBudgetSpending(),
      referenceDate,
      horizonDays,
    };
    const forecast = calculateRunwayForecast(forecastParams);
    if (paymentPlan === "true") {
      forecast.payment_plan = calculatePaymentPlan(forecastParams, useGracePeriods === "true");
    }
    if (purchase !== null) forecast.purchase_scenarios = calculatePurchaseScenarios(forecastParams, Number(purchase));
    if (comparisonInputs === "true") {
      forecast.comparison_bills = forecastParams.bills.map(bill => ({ key: `${bill.billId}:${bill.originalDueDate ?? bill.dueDate}`,
        name: bill.name, due_date: bill.dueDate, amount_cents: bill.amountDue, status: bill.status }));
    }

    return NextResponse.json({ ...forecast, forecast_calculated_at: new Date().toISOString() }, { status: 200 });
  } catch (error: unknown) {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && (cause.code === "42703" || cause.code === "42P01")) {
      return NextResponse.json({ error: "Database migrations are required.", code: "DATABASE_MIGRATION_REQUIRED" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unable to calculate the runway forecast." }, { status: 500 });
  }
}
