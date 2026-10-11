import { lockIncomeSettings } from "../db/locking";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { accounts, incomeStreamDeposits, incomeStreams, projectionSettings } from "../db/schema";
import { getScheduledPayDatesThrough } from "./runway";

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

function localDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Applies every due, enabled income occurrence that has a live liquid destination. */
export async function applyDueIncomeStreamDeposits(asOf = new Date()): Promise<number> {
  const today = localDateOnly(asOf);
  return db.transaction(async (tx) => {
    await lockIncomeSettings(tx);
    const [settings] = await tx.select().from(projectionSettings).orderBy(projectionSettings.id).limit(1);
    if (!settings) return 0;
    const streams = await tx.select().from(incomeStreams).where(and(
      eq(incomeStreams.projectionSettingsId, settings.id),
      eq(incomeStreams.isEnabled, true),
    ));
    let depositedCount = 0;

    for (const stream of streams) {
      if (!stream.destinationAccountId || !stream.destinationAccountSetDate) continue;
      const dueDates = getScheduledPayDatesThrough(today, stream.salaryCycleDays, stream.paydayAnchor, stream.scheduleKind, stream.intervalDays, stream.destinationAccountSetDate);
      for (const scheduledDate of dueDates) {
        const [destination] = await tx.select({ id: accounts.id }).from(accounts).where(and(
          eq(accounts.id, stream.destinationAccountId),
          eq(accounts.type, "liquid"),
          eq(accounts.isActive, true),
        )).limit(1);
        if (!destination) continue;

        const [occurrence] = await tx.insert(incomeStreamDeposits).values({
          incomeStreamId: stream.id,
          scheduledDate,
          accountId: stream.destinationAccountId,
          amountCents: stream.netPayCents,
        }).onConflictDoNothing().returning({ id: incomeStreamDeposits.id });
        if (!occurrence) continue;

        const [credited] = await tx.update(accounts).set({
          currentBalance: sql`${accounts.currentBalance} + ${stream.netPayCents}`,
          updatedAt: new Date(),
        }).where(and(
          eq(accounts.id, stream.destinationAccountId),
          eq(accounts.type, "liquid"),
          eq(accounts.isActive, true),
          sql`${accounts.currentBalance} <= ${MAX_SAFE_CENTS - stream.netPayCents}`,
        )).returning({ id: accounts.id });
        if (!credited) throw new Error("Income deposit could not be credited safely; transaction was rolled back.");
        depositedCount += 1;
      }
    }
    return depositedCount;
  });
}
