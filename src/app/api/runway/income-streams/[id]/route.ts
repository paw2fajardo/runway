import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { incomeStreams, projectionSettings } from "../../../../../db/schema";
import { IncomeStreamPatchSchema, PaySettingsSchema } from "../../../../../lib/types";
import { incomeStreamResponse } from "../../../../../lib/runway";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = IncomeStreamPatchSchema.safeParse(await req.json().catch(() => undefined));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Provide a valid income stream and changes." }, { status: 400 });
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
      const [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) return { status: 404, error: "Income stream not found." };
      const scope = and(eq(incomeStreams.id, id), eq(incomeStreams.projectionSettingsId, settings.id));
      const [existing] = await tx.select().from(incomeStreams).where(scope).limit(1);
      if (!existing) return { status: 404, error: "Income stream not found." };
      const change = parsed.data;
      const kind = change.schedule_kind ?? existing.scheduleKind;
      const anchor = change.next_pay_date ?? existing.paydayAnchor;
      const interval = kind === "custom" ? change.interval_days ?? existing.intervalDays : null;
      // Legacy schedules support name/amount/pause edits without converting their recurrence.
      if (kind == null && (change.next_pay_date !== undefined || change.interval_days !== undefined)) return { status: 400, error: "Choose a schedule when changing a legacy pay date." };
      if (change.interval_days !== undefined && kind !== "custom") return { status: 400, error: "Intervals apply only to custom schedules." };
      if (kind != null && !PaySettingsSchema.safeParse({ net_pay_cents: change.net_pay_cents ?? existing.netPayCents, next_pay_date: anchor,
        schedule_kind: kind, ...(kind === "custom" ? { interval_days: interval } : {}) }).success) return { status: 400, error: "Provide a valid pay date, schedule and custom interval." };
      const [saved] = await tx.update(incomeStreams).set({
        name: change.name ?? existing.name, netPayCents: change.net_pay_cents ?? existing.netPayCents,
        scheduleKind: kind, paydayAnchor: anchor, intervalDays: interval,
        isEnabled: change.is_enabled ?? existing.isEnabled, updatedAt: new Date(),
      }).where(scope).returning();
      return { status: 200, stream: saved };
    });
    return "stream" in result && result.stream
      ? NextResponse.json(incomeStreamResponse(result.stream))
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Unable to update income stream. Your changes have not been saved." }, { status: 503 });
  }
}
