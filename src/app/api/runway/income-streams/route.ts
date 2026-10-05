import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { projectionSettings, incomeStreams, accounts } from "../../../../db/schema";
import { IncomeStreamCreateSchema, type IncomeStreamAccountSummary } from "../../../../lib/types";
import { incomeStreamResponse } from "../../../../lib/runway";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";

function streamResponse(stream: typeof incomeStreams.$inferSelect, account: typeof accounts.$inferSelect | null) {
  return { ...incomeStreamResponse(stream), account_id: stream.accountId,
    account_summary: account ? { id: account.id, name: account.name, type: account.type, currency: account.currency } satisfies IncomeStreamAccountSummary : null };
}

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const [settings] = await db.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    if (!settings) return NextResponse.json({ streams: [] });
    const streams = await db.select().from(incomeStreams).where(eq(incomeStreams.projectionSettingsId, settings.id)).orderBy(incomeStreams.id);
    const linkedIds = streams.map(stream => stream.accountId).filter((id): id is string => id !== null);
    const linkedAccounts = linkedIds.length ? await db.select().from(accounts).where(inArray(accounts.id, linkedIds)) : [];
    const byId = new Map(linkedAccounts.map(account => [account.id, account]));
    return NextResponse.json({ streams: streams.map(stream => streamResponse(stream, stream.accountId ? byId.get(stream.accountId) ?? null : null)) });
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
  if (!parsed.success) return NextResponse.json({ error: "Enter a name, positive take-home pay, a valid date and schedule." }, { status: 400 });
  try {
    const saved = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, parsed.data.account_id)).limit(1);
      if (!account || account.type !== "liquid" || !account.isActive) return { error: "Choose an active liquid account.", status: 400 };
      let [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
      if (!settings) [settings] = await tx.insert(projectionSettings).values({ expectedSalaryAmount: parsed.data.net_pay_cents }).returning();
      const [stream] = await tx.insert(incomeStreams).values({
        projectionSettingsId: settings.id, accountId: account.id, name: parsed.data.name,
        netPayCents: parsed.data.net_pay_cents, paydayAnchor: parsed.data.next_pay_date,
        scheduleKind: parsed.data.schedule_kind,
        intervalDays: parsed.data.schedule_kind === "custom" ? parsed.data.interval_days! : null,
        isEnabled: parsed.data.is_enabled ?? true,
      }).returning();
      return { stream, account };
    });
    if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: saved.status });
    return NextResponse.json(streamResponse(saved.stream, saved.account), { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save income stream. Your changes have not been saved." }, { status: 503 });
  }
}
