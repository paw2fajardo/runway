import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { accounts, incomeStreams, projectionSettings } from "../../../../../db/schema";
import { IncomeStreamPatchSchema, PaySettingsSchema } from "../../../../../lib/types";
import { incomeStreamResponse } from "../../../../../lib/runway";
import { manilaDate } from "../../../../../lib/payday/occurrences";
import { assertSameOrigin, requireOwner } from "../../../../../lib/auth/guard";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await context.params;
  const parsed = IncomeStreamPatchSchema.safeParse(await req.json().catch(() => undefined));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Provide a valid income stream and changes." }, { status: 400 });
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
      const [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) return { status: 404 as const, error: "Income stream not found." };
      const scope = and(eq(incomeStreams.id, id), eq(incomeStreams.projectionSettingsId, settings.id));
      const [existing] = await tx.select().from(incomeStreams).where(scope).limit(1);
      if (!existing) return { status: 404 as const, error: "Income stream not found." };
      const change = parsed.data;
      const destinationAccountId = change.destination_account_id === undefined ? existing.destinationAccountId : change.destination_account_id;
      if (destinationAccountId) {
        const [account] = await tx.select().from(accounts).where(and(
          eq(accounts.id, destinationAccountId), eq(accounts.type, "liquid"), eq(accounts.isActive, true),
        )).limit(1);
        if (!account) return { status: 400 as const, error: "Choose an active liquid destination account." };
      }
      const kind = change.schedule_kind ?? existing.scheduleKind;
      const anchor = change.next_pay_date ?? existing.paydayAnchor;
      const interval = kind === "custom" ? change.interval_days ?? existing.intervalDays : null;
      if (kind == null && (change.next_pay_date !== undefined || change.interval_days !== undefined)) return { status: 400 as const, error: "Choose a schedule when changing a legacy pay date." };
      if (change.interval_days !== undefined && kind !== "custom") return { status: 400 as const, error: "Intervals apply only to custom schedules." };
      if (kind != null && !PaySettingsSchema.safeParse({ net_pay_cents: change.net_pay_cents ?? existing.netPayCents, next_pay_date: anchor,
        schedule_kind: kind, ...(kind === "custom" ? { interval_days: interval } : {}) }).success) return { status: 400 as const, error: "Provide a valid pay date, schedule and custom interval." };
      const destinationChanged = change.destination_account_id !== undefined && change.destination_account_id !== existing.destinationAccountId;
      const resumed = change.is_enabled === true && !existing.isEnabled;
      const [saved] = await tx.update(incomeStreams).set({
        name: change.name ?? existing.name,
        netPayCents: change.net_pay_cents ?? existing.netPayCents,
        destinationAccountId,
        destinationAccountSetDate: !destinationAccountId ? null : destinationChanged || resumed
          ? manilaDate(new Date())
          : existing.destinationAccountSetDate,
        scheduleKind: kind,
        paydayAnchor: anchor,
        intervalDays: interval,
        isEnabled: change.is_enabled ?? existing.isEnabled,
        updatedAt: new Date(),
      }).where(scope).returning();
      return { status: 200 as const, stream: saved };
    });
    return "stream" in result && result.stream
      ? NextResponse.json(incomeStreamResponse(result.stream))
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Unable to update income stream. Your changes have not been saved." }, { status: 503 });
  }
}
