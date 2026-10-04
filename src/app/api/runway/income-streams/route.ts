import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { projectionSettings, incomeStreams } from "../../../../db/schema";
import { IncomeStreamCreateSchema } from "../../../../lib/types";
import { incomeStreamResponse } from "../../../../lib/runway";

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
      let [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) [settings] = await tx.insert(projectionSettings).values({ expectedSalaryAmount: parsed.data.net_pay_cents }).returning();
      const [stream] = await tx.insert(incomeStreams).values({
        projectionSettingsId: settings.id, name: parsed.data.name,
        netPayCents: parsed.data.net_pay_cents, paydayAnchor: parsed.data.next_pay_date,
        scheduleKind: parsed.data.schedule_kind,
        intervalDays: parsed.data.schedule_kind === "custom" ? parsed.data.interval_days! : null,
        isEnabled: parsed.data.is_enabled ?? true,
      }).returning();
      return stream;
    });
    return NextResponse.json(incomeStreamResponse(saved), { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save income stream. Your changes have not been saved." }, { status: 503 });
  }
}
