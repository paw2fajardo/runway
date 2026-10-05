import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db";
import { incomeStreams, paycheckOccurrences } from "../../db/schema";
import { getDuePaydayOccurrences } from "./schedule";

export interface DuePaycheck {
  kind: "scheduled" | "retry";
  occurrenceId?: string;
  incomeStreamId: string;
  dueDate: string;
  accountId: string | null;
  amount: number;
  accountNameSnapshot?: string | null;
}

export function manilaDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid current time");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Collect scheduled dates and persisted one-time retries eligible by this instant. */
export async function getDueOccurrences(now: Date): Promise<DuePaycheck[]> {
  const today = manilaDate(now);
  const [streams, occurrences] = await Promise.all([
    db.select().from(incomeStreams).where(eq(incomeStreams.isEnabled, true)),
    db.select().from(paycheckOccurrences),
  ]);

  const scheduled = occurrences.filter(row => row.kind === "scheduled");
  const due: DuePaycheck[] = [];
  for (const stream of streams) {
    // Streams begin automatic deposits only after a destination was linked.
    if (!stream.scheduleKind || !stream.paydayAnchor || !stream.destinationAccountId) continue;
    const alreadyCreated = scheduled
      .filter(row => row.incomeStreamId === stream.id)
      .map(row => row.dueDate)
      .sort()
      .at(-1);
    const linkedOn = stream.destinationAccountSetDate
      ? new Date(`${stream.destinationAccountSetDate}T00:00:00Z`)
      : null;
    const eligibilityStart = linkedOn
      ? new Date(linkedOn.getTime() - 86400000).toISOString().slice(0, 10)
      : undefined;
    const afterDate = [alreadyCreated, eligibilityStart].filter((date): date is string => Boolean(date)).sort().at(-1);
    const dates = getDuePaydayOccurrences({
      scheduleKind: stream.scheduleKind as "weekly" | "biweekly" | "monthly" | "custom",
      anchorDate: stream.paydayAnchor,
      salaryCycleDays: stream.salaryCycleDays,
      intervalDays: stream.intervalDays ?? undefined,
    }, now, afterDate);
    due.push(...dates.map(({ dueDate }) => ({
      kind: "scheduled" as const,
      incomeStreamId: stream.id,
      dueDate,
      accountId: stream.destinationAccountId,
      amount: stream.netPayCents,
    })));
  }

  const dueRetries = await db.select().from(paycheckOccurrences).where(and(
    eq(paycheckOccurrences.kind, "retry"),
    isNull(paycheckOccurrences.transactionId),
    lte(paycheckOccurrences.retryDate, today),
    or(
      eq(paycheckOccurrences.status, "pending_confirmation"),
      eq(paycheckOccurrences.status, "reversed_awaiting_retry"),
    ),
  ));
  const parentIds = [...new Set(dueRetries.map(row => row.parentOccurrenceId).filter((id): id is string => Boolean(id)))];
  const parents = parentIds.length
    ? await db.select().from(paycheckOccurrences).where(eq(paycheckOccurrences.status, "reversed_awaiting_retry"))
    : [];
  const validParents = new Set(parents.filter(parent => parentIds.includes(parent.id)).map(parent => parent.id));
  due.push(...dueRetries
    .filter(row => row.parentOccurrenceId && validParents.has(row.parentOccurrenceId) && row.retryDate)
    .map(row => ({
      kind: "retry" as const,
      occurrenceId: row.id,
      incomeStreamId: row.incomeStreamId,
      dueDate: row.retryDate!,
      accountId: row.accountId,
      amount: row.amountSnapshot,
      accountNameSnapshot: row.accountNameSnapshot,
    })));

  return due.filter(item => item.dueDate <= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
