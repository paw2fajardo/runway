import { DateOnlySchema, PayScheduleKindSchema, type PayScheduleKind } from "../types";

const DAY_MS = 86_400_000;
const MANILA_TIME_ZONE = "Asia/Manila";

export type PaydayDueDate =
  | { kind: "scheduled"; dueDate: string }
  | { kind: "retry"; retryDate: string };

export interface PaydaySchedule {
  scheduleKind: PayScheduleKind | "calendar";
  /** First occurrence date, and the original day-of-month anchor for monthly schedules. */
  anchorDate: string;
  /** Used only by calendar schedules, for example "15,30". */
  salaryCycleDays?: string;
  /** Required only for custom schedules. */
  intervalDays?: number;
}

export interface PaydayOccurrence {
  kind: "scheduled";
  dueDate: string;
  dueAt: Date;
}

function dateNumber(date: string): number {
  DateOnlySchema.parse(date);
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}

function dateFromNumber(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

function manilaDateAndTime(now: Date): { date: string; hour: number; minute: number; second: number } {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid current time");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/** A payday starts at 09:00 Asia/Manila (UTC+08:00, no DST). */
export function paydayDueAt(due: PaydayDueDate): Date {
  const date = due.kind === "scheduled" ? due.dueDate : due.retryDate;
  DateOnlySchema.parse(date);
  return new Date(`${date}T01:00:00.000Z`);
}

function validateSchedule(schedule: PaydaySchedule): { interval: number | null; cycleDays: Set<number> } {
  DateOnlySchema.parse(schedule.anchorDate);
  const kind = schedule.scheduleKind;
  if (kind !== "calendar") PayScheduleKindSchema.parse(kind);

  if (kind === "custom") {
    if (!Number.isInteger(schedule.intervalDays) || schedule.intervalDays! < 1 || schedule.intervalDays! > 366) {
      throw new Error("Custom payday interval must be from 1 to 366 days");
    }
  } else if (schedule.intervalDays !== undefined) {
    throw new Error("Only custom schedules accept an interval");
  }

  const cycleDays = new Set<number>();
  if (kind === "calendar") {
    const parts = (schedule.salaryCycleDays ?? "15,30").split(",");
    for (const part of parts) {
      const day = Number(part.trim());
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Calendar payday days must be from 1 to 31");
      cycleDays.add(day);
    }
    if (cycleDays.size === 0) throw new Error("At least one calendar payday day is required");
  }

  return {
    interval: kind === "weekly" ? 7 : kind === "biweekly" ? 14 : kind === "custom" ? schedule.intervalDays! : null,
    cycleDays,
  };
}

function monthlyDate(anchor: string, monthOffset: number): string {
  const [year, month, day] = anchor.split("-").map(Number);
  const lastDate = new Date(Date.UTC(year, month - 1 + monthOffset + 1, 0)).getUTCDate();
  return `${String(year + Math.floor((month - 1 + monthOffset) / 12)).padStart(4, "0")}-${String(((month - 1 + monthOffset) % 12 + 12) % 12 + 1).padStart(2, "0")}-${String(Math.min(day, lastDate)).padStart(2, "0")}`;
}

function isPayday(schedule: PaydaySchedule, dueDate: string, interval: number | null, cycleDays: Set<number>): boolean {
  if (dueDate < schedule.anchorDate) return false;
  if (schedule.scheduleKind === "calendar") {
    const requestedDay = Number(dueDate.slice(8));
    const monthLastDay = new Date(Date.parse(`${dueDate.slice(0, 7)}-01T00:00:00Z`) + 32 * DAY_MS);
    monthLastDay.setUTCDate(0);
    return cycleDays.has(requestedDay) || [...cycleDays].some(day => day > monthLastDay.getUTCDate() && requestedDay === monthLastDay.getUTCDate());
  }
  if (schedule.scheduleKind === "monthly") {
    const [anchorYear, anchorMonth] = schedule.anchorDate.split("-").map(Number);
    const [year, month] = dueDate.split("-").map(Number);
    const offset = (year - anchorYear) * 12 + month - anchorMonth;
    return offset >= 0 && monthlyDate(schedule.anchorDate, offset) === dueDate;
  }
  if (interval === null) return false;
  return (dateNumber(dueDate) - dateNumber(schedule.anchorDate)) % interval === 0;
}

/**
 * Returns scheduled occurrences from the first occurrence (or after `afterDate`)
 * through the latest 09:00 Manila due time. Overdue occurrences are retained for
 * catch-up; occurrences whose due time is still in the future are excluded.
 */
export function getDuePaydayOccurrences(
  schedule: PaydaySchedule,
  now: Date,
  afterDate?: string,
): PaydayOccurrence[] {
  const { interval, cycleDays } = validateSchedule(schedule);
  const local = manilaDateAndTime(now);
  const todayDue = local.hour >= 9;
  const throughDay = dateNumber(local.date) - (todayDue ? 0 : 1);
  const startDay = Math.max(dateNumber(schedule.anchorDate), afterDate ? dateNumber(afterDate) + 1 : dateNumber(schedule.anchorDate));
  const occurrences: PaydayOccurrence[] = [];

  for (let day = startDay; day <= throughDay; day += 1) {
    const dueDate = dateFromNumber(day);
    if (isPayday(schedule, dueDate, interval, cycleDays)) {
      occurrences.push({ kind: "scheduled", dueDate, dueAt: paydayDueAt({ kind: "scheduled", dueDate }) });
    }
  }
  return occurrences;
}
