import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { accounts, projectionSettings, incomeStreams } from "../../../../db/schema";
import { IncomeStreamCreateSchema } from "../../../../lib/types";
import { incomeStreamResponse } from "../../../../lib/runway";
import { manilaDate } from "../../../../lib/payday/occurrences";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const [settings] = await db.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    if (!settings) return NextResponse.json({ streams: [] });
    const streams = await db.select().from(incomeStreams)
      .where(eq(incomeStreams.projectionSettingsId, settings.id)).orderBy(incomeStreams.id);
    return NextResponse.json({ streams: streams.map(incomeStreamResponse) });
  } catch {
    return NextResponse.json({ error: "Unable to access income streams. Check that the database update has been applied." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const parsed = IncomeStreamCreateSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Enter a name, positive take-home pay, a valid date, schedule and destination account." }, { status: 400 });
  try {
    const saved = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
      const [account] = await tx.select().from(accounts).where(and(
        eq(accounts.id, parsed.data.destination_account_id), eq(accounts.type, "liquid"), eq(accounts.isActive, true),
      )).limit(1);
      if (!account) return { error: "Choose an active liquid destination account.", status: 400 as const };
      let [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) [settings] = await tx.insert(projectionSettings).values({ expectedSalaryAmount: parsed.data.net_pay_cents }).returning();
      const [stream] = await tx.insert(incomeStreams).values({
        projectionSettingsId: settings.id,
        destinationAccountId: account.id,
        destinationAccountSetDate: manilaDate(new Date()),
        name: parsed.data.name,
        netPayCents: parsed.data.net_pay_cents,
        paydayAnchor: parsed.data.next_pay_date,
        scheduleKind: parsed.data.schedule_kind,
        intervalDays: parsed.data.schedule_kind === "custom" ? parsed.data.interval_days! : null,
        isEnabled: parsed.data.is_enabled ?? true,
      }).returning();
      return { stream };
    });
    if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: saved.status });
    return NextResponse.json(incomeStreamResponse(saved.stream), { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save income stream. Your changes have not been saved." }, { status: 503 });
  }
}
