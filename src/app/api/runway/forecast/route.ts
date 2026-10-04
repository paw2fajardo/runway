import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, projectionSettings, incomeStreams, billInstances, bills } from "@/db/schema";
import { calculateRunwayForecast } from "@/lib/runway";
import { eq, and } from "drizzle-orm";
import { DateOnlySchema } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const horizonDays = Number(searchParams.get("horizon_days") || "14");
    const dateParam = searchParams.get("reference_date");
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
    const expectedSalaryAmount = proj.expectedSalaryAmount;
    const salaryCycleDays = proj.salaryCycleDays;
    const dailyDiscretionaryBurn = proj.dailyDiscretionaryBurn;

    // 3. Fetch active bills and instances
    const billList = await db
      .select({
        id: billInstances.id,
        name: bills.name,
        dueDate: billInstances.dueDate,
        amountDue: billInstances.amountDue,
        status: billInstances.status,
        gracePeriodDays: bills.gracePeriodDays,
      })
      .from(billInstances)
      .innerJoin(bills, eq(billInstances.billId, bills.id))
      .where(eq(bills.isActive, true));

    // 4. Calculate forward runway forecast
    const forecast = calculateRunwayForecast({
      currentLiquidCash,
      salaryCycleDays,
      biweeklyPaydayAnchor: proj.biweeklyPaydayAnchor,
      payScheduleKind: proj.payScheduleKind,
      payIntervalDays: proj.payIntervalDays,
      expectedSalaryAmount,
      incomeStreams: streams,
      dailyDiscretionaryBurn,
      bills: billList,
      referenceDate,
      horizonDays,
    });

    return NextResponse.json(forecast, { status: 200 });
  } catch (error: unknown) {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && (cause.code === "42703" || cause.code === "42P01")) {
      return NextResponse.json({ error: "Pay schedule database update is required.", code: "PAY_SCHEDULE_MIGRATION_REQUIRED" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unable to calculate the runway forecast." }, { status: 500 });
  }
}
