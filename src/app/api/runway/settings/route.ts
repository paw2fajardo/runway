import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { projectionSettings, incomeStreams } from "../../../../db/schema";
import { incomeStreamResponse } from "../../../../lib/runway";
import {
  BillReminderTimeSettingsSchema,
  DailyDiscretionaryBurnSchema,
  DEFAULT_BILL_REMINDER_TIME,
  PaySettingsSchema,
} from "../../../../lib/types";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";

function responseFor(stream: typeof incomeStreams.$inferSelect, dailyDiscretionaryBurn: number, billReminderTime: string) {
  return { configured: true, daily_discretionary_burn_cents: dailyDiscretionaryBurn,
    bill_reminder_time: billReminderTime, ...incomeStreamResponse(stream) };
}

function settingsError(error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  if (cause && typeof cause === "object" && "code" in cause && (cause.code === "42703" || cause.code === "42P01")) {
    return NextResponse.json({ error: "Settings database update is required.", code: "SETTINGS_MIGRATION_REQUIRED" }, { status: 503 });
  }
  return NextResponse.json({ error: "Unable to access pay settings." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const [settings] = await db.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    const billReminderTime = settings?.billReminderTime ?? DEFAULT_BILL_REMINDER_TIME;
    if (req.nextUrl.searchParams.get("field") === "daily_discretionary_burn_cents") {
      return NextResponse.json({ daily_discretionary_burn_cents: settings?.dailyDiscretionaryBurn ?? 0 });
    }
    if (req.nextUrl.searchParams.get("field") === "bill_reminder_time") {
      return NextResponse.json({ bill_reminder_time: billReminderTime });
    }
    if (!settings) return NextResponse.json({ configured: false, daily_discretionary_burn_cents: 0, bill_reminder_time: billReminderTime });
    const [stream] = await db.select().from(incomeStreams)
      .where(and(eq(incomeStreams.id, settings.id), eq(incomeStreams.projectionSettingsId, settings.id))).limit(1);
    return NextResponse.json(stream
      ? responseFor(stream, settings.dailyDiscretionaryBurn, billReminderTime)
      : { configured: false, daily_discretionary_burn_cents: settings.dailyDiscretionaryBurn, bill_reminder_time: billReminderTime });
  } catch (error) { return settingsError(error); }
}

export async function PATCH(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const body = await req.json().catch(() => undefined);
  const parsed = DailyDiscretionaryBurnSchema.safeParse(body);
  const parsedReminderTime = BillReminderTimeSettingsSchema.safeParse(body);
  if (!parsed.success && !parsedReminderTime.success) {
    return NextResponse.json({ error: "Enter a nonnegative whole-cent allowance or a valid bill reminder time (HH:MM)." }, { status: 400 });
  }
  try {
    const saved = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
      let [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) [settings] = await tx.insert(projectionSettings).values({ expectedSalaryAmount: 0 }).returning();
      if (parsedReminderTime.success) {
        await tx.update(projectionSettings).set({ billReminderTime: parsedReminderTime.data.bill_reminder_time, updatedAt: new Date() })
          .where(eq(projectionSettings.id, settings.id));
        return { bill_reminder_time: parsedReminderTime.data.bill_reminder_time };
      }
      await tx.update(projectionSettings).set({
        dailyDiscretionaryBurn: parsed.data!.daily_discretionary_burn_cents,
        updatedAt: new Date(),
      }).where(eq(projectionSettings.id, settings.id));
      return { daily_discretionary_burn_cents: parsed.data!.daily_discretionary_burn_cents };
    });
    return NextResponse.json(saved);
  } catch (error) { return settingsError(error); }
}

export async function PUT(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const parsed = PaySettingsSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Enter positive net pay in whole cents and a real YYYY-MM-DD pay date." }, { status: 400 });
  try {
    const saved = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
      let [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) [settings] = await tx.insert(projectionSettings).values({ expectedSalaryAmount: parsed.data.net_pay_cents }).returning();
      const scope = and(eq(incomeStreams.id, settings.id), eq(incomeStreams.projectionSettingsId, settings.id));
      const [existing] = await tx.select().from(incomeStreams).where(scope).limit(1);
      const values = {
        netPayCents: parsed.data.net_pay_cents,
        paydayAnchor: parsed.data.next_pay_date,
        scheduleKind: parsed.data.schedule_kind ?? "biweekly",
        intervalDays: parsed.data.schedule_kind === "custom" ? parsed.data.interval_days! : null,
        updatedAt: new Date(),
      };
      if (parsed.data.daily_discretionary_burn_cents !== undefined) {
        await tx.update(projectionSettings).set({ dailyDiscretionaryBurn: parsed.data.daily_discretionary_burn_cents, updatedAt: new Date() })
          .where(eq(projectionSettings.id, settings.id));
      }
      const [stream] = existing
        ? await tx.update(incomeStreams).set(values).where(scope).returning()
        : await tx.insert(incomeStreams).values({ id: settings.id, projectionSettingsId: settings.id,
            name: "Primary income", salaryCycleDays: settings.salaryCycleDays, ...values }).returning();
      return { stream, dailyDiscretionaryBurn: parsed.data.daily_discretionary_burn_cents ?? settings.dailyDiscretionaryBurn, billReminderTime: settings.billReminderTime ?? DEFAULT_BILL_REMINDER_TIME };
    });
    return NextResponse.json(responseFor(saved.stream, saved.dailyDiscretionaryBurn, saved.billReminderTime));
  } catch (error) { return settingsError(error); }
}
