import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { accounts, projectionSettings, incomeStreams } from "../../../../db/schema";
import { IncomeStreamCreateSchema } from "../../../../lib/types";
import { incomeStreamResponse } from "../../../../lib/runway";

function localDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function GET() {
  try {
    const [settings] = await db.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    if (!settings) return NextResponse.json({ streams: [] });
    const streams = await db.select().from(incomeStreams).where(eq(incomeStreams.projectionSettingsId, settings.id)).orderBy(incomeStreams.id);
    return NextResponse.json({ streams: streams.map(incomeStreamResponse) });
  } catch {
    return NextResponse.json({ error: "Unable to access income streams. Check that the database update has been applied." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const parsed = IncomeStreamCreateSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Enter a name, positive take-home pay, a valid date and schedule." }, { status: 400 });
  try {
    const saved = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
      if (parsed.data.destination_account_id) {
        const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, parsed.data.destination_account_id), eq(accounts.type, "liquid"), eq(accounts.isActive, true))).limit(1);
        if (!account) return null;
      }
      let [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) [settings] = await tx.insert(projectionSettings).values({ expectedSalaryAmount: parsed.data.net_pay_cents }).returning();
      const [stream] = await tx.insert(incomeStreams).values({
        projectionSettingsId: settings.id, destinationAccountId: parsed.data.destination_account_id ?? null,
        destinationAccountSetDate: parsed.data.destination_account_id ? localDateOnly(new Date()) : null,
        name: parsed.data.name,
        netPayCents: parsed.data.net_pay_cents, paydayAnchor: parsed.data.next_pay_date,
        scheduleKind: parsed.data.schedule_kind,
        intervalDays: parsed.data.schedule_kind === "custom" ? parsed.data.interval_days! : null,
        isEnabled: parsed.data.is_enabled ?? true,
      }).returning();
      return stream;
    });
    if (!saved) return NextResponse.json({ error: "Choose an active liquid destination account." }, { status: 400 });
    return NextResponse.json(incomeStreamResponse(saved), { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save income stream. Your changes have not been saved." }, { status: 503 });
  }
}
