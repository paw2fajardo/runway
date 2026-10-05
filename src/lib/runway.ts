import { DateOnlySchema, PayScheduleKindSchema, type PayScheduleKind, type IncomeStreamResponse, RunwayForecastResponse, TimelineDay } from "./types";

const msPerDay = 86400000;

export interface IncomeStreamSchedule {
  id?: string;
  destinationAccountId?: string | null;
  name: string;
  netPayCents: number;
  scheduleKind?: string | null;
  paydayAnchor?: string | null;
  intervalDays?: number | null;
  salaryCycleDays?: string;
  isEnabled: boolean;
}

export function incomeStreamResponse(stream: IncomeStreamSchedule & { id: string }): IncomeStreamResponse {
  const schedule = resolvePaySchedule(stream.scheduleKind, stream.paydayAnchor, stream.intervalDays);
  return { id: stream.id, name: stream.name, net_pay_cents: stream.netPayCents,
    schedule_kind: schedule.kind, payday_anchor: stream.paydayAnchor ?? null,
    interval_days: schedule.kind === "custom" ? stream.intervalDays! : null,
    salary_cycle_days: stream.salaryCycleDays ?? "15,30", is_enabled: stream.isEnabled,
    destination_account_id: stream.destinationAccountId ?? null,
    next_pay_date: getNextPaydayDate(new Date(), stream.salaryCycleDays, stream.paydayAnchor, stream.scheduleKind, stream.intervalDays) };
}

function safeCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Forecast amount exceeds safe integer cents");
  return value;
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// UTC is used only to number civil dates, never to interpret local instants.
function calendarDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / msPerDay;
}

export function resolvePaySchedule(kind: string | null | undefined, anchor?: string | null, interval?: number | null) {
  const scheduleKind: PayScheduleKind | "calendar" = kind == null ? (anchor ? "biweekly" : "calendar") : PayScheduleKindSchema.parse(kind);
  if (scheduleKind !== "calendar") DateOnlySchema.parse(anchor);
  if (scheduleKind === "custom" && (!Number.isInteger(interval) || interval! < 1 || interval! > 366)) throw new Error("Invalid custom pay interval");
  return { kind: scheduleKind, interval: scheduleKind === "weekly" ? 7 : scheduleKind === "biweekly" ? 14 : scheduleKind === "custom" ? interval! : null };
}

function monthlyPayday(anchor: string, monthIndex: number): string {
  const [year, month, day] = anchor.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1 + monthIndex + 1, 0);
  const lastDay = date.getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function isScheduledPayday(date: string, salaryCycleDays: string, anchor?: string | null, kind?: string | null, interval?: number | null): boolean {
  const schedule = resolvePaySchedule(kind, anchor, interval);
  if (schedule.kind === "calendar") return salaryCycleDays.split(",").map(Number).includes(Number(date.slice(8)));
  if (date < anchor!) return false;
  if (schedule.kind === "monthly") {
    const monthIndex = (Number(date.slice(0, 4)) - Number(anchor!.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(anchor!.slice(5, 7));
    return monthlyPayday(anchor!, monthIndex) === date;
  }
  return (calendarDay(date) - calendarDay(anchor!)) % schedule.interval! === 0;
}

export function getNextPaydayDate(referenceDate: Date, salaryCycleDays = "15,30", biweeklyPaydayAnchor?: string | null, payScheduleKind?: string | null, payIntervalDays?: number | null): string {
  const schedule = resolvePaySchedule(payScheduleKind, biweeklyPaydayAnchor, payIntervalDays);
  if (schedule.kind === "monthly") {
    const reference = formatLocalDate(referenceDate);
    if (reference <= biweeklyPaydayAnchor!) return biweeklyPaydayAnchor!;
    const monthIndex = (referenceDate.getFullYear() - Number(biweeklyPaydayAnchor!.slice(0, 4))) * 12 + referenceDate.getMonth() + 1 - Number(biweeklyPaydayAnchor!.slice(5, 7));
    const candidate = monthlyPayday(biweeklyPaydayAnchor!, monthIndex);
    return candidate >= reference ? candidate : monthlyPayday(biweeklyPaydayAnchor!, monthIndex + 1);
  }
  if (biweeklyPaydayAnchor) {
    DateOnlySchema.parse(biweeklyPaydayAnchor);
    const anchor = calendarDay(biweeklyPaydayAnchor);
    const reference = calendarDay(formatLocalDate(referenceDate));
    const next = anchor + Math.max(0, Math.ceil((reference - anchor) / schedule.interval!)) * schedule.interval!;
    return new Date(next * msPerDay).toISOString().slice(0, 10);
  }
  const cycleDays = salaryCycleDays.split(",").map(day => parseInt(day.trim(), 10))
    .filter(day => !isNaN(day) && day >= 1 && day <= 31).sort((a, b) => a - b);
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  for (const day of cycleDays) {
    if (day > referenceDate.getDate()) {
      return formatLocalDate(new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate())));
    }
  }
  return formatLocalDate(new Date(year, month + 1, Math.min(cycleDays[0] || 15, new Date(year, month + 2, 0).getDate())));
}

export function getScheduledPayDatesThrough(
  throughDate: string,
  salaryCycleDays: string,
  anchor?: string | null,
  kind?: string | null,
  interval?: number | null,
  fromDate?: string | null,
): string[] {
  const schedule = resolvePaySchedule(kind, anchor, interval);
  const startDate = fromDate ?? anchor ?? throughDate;
  if (schedule.kind === "calendar") {
    const paydayDays = new Set(salaryCycleDays.split(",").map(Number).filter(day => day >= 1 && day <= 31));
    const dates: string[] = [];
    for (let day = calendarDay(startDate); day <= calendarDay(throughDate); day++) {
      const date = new Date(day * msPerDay).toISOString().slice(0, 10);
      if (paydayDays.has(Number(date.slice(8)))) dates.push(date);
    }
    return dates;
  }
  const start = calendarDay(anchor!);
  const end = calendarDay(throughDate);
  if (start > end) return [];
  if (schedule.kind === "monthly") {
    const dates: string[] = [];
    const earliest = Math.max(start, calendarDay(startDate));
    const monthOffset = (Number(startDate.slice(0, 4)) - Number(anchor!.slice(0, 4))) * 12 + Number(startDate.slice(5, 7)) - Number(anchor!.slice(5, 7));
    let index = Math.max(0, monthOffset);
    while (true) {
      const payday = monthlyPayday(anchor!, index++);
      if (payday > throughDate) return dates;
      if (calendarDay(payday) >= earliest) dates.push(payday);
    }
  }
  const dates: string[] = [];
  const earliest = Math.max(start, calendarDay(startDate));
  const first = start + Math.max(0, Math.ceil((earliest - start) / schedule.interval!)) * schedule.interval!;
  for (let day = first; day <= end; day += schedule.interval!) dates.push(new Date(day * msPerDay).toISOString().slice(0, 10));
  return dates;
}

interface BillItem {
  id: string;
  name: string;
  dueDate: string; // YYYY-MM-DD
  amountDue: number; // cents
  status: string;
  gracePeriodDays?: number;
}

interface RunwayCalculationParams {
  currentLiquidCash: number;
  salaryCycleDays?: string; // e.g. "15,30"
  biweeklyPaydayAnchor?: string | null;
  payScheduleKind?: string | null;
  payIntervalDays?: number | null;
  expectedSalaryAmount: number;
  incomeStreams?: IncomeStreamSchedule[];
  paycheckOccurrences?: ForecastPaycheckOccurrence[];
  dailyDiscretionaryBurn: number;
  bills: BillItem[];
  referenceDate?: Date;
  horizonDays?: number;
}

export interface ForecastPaycheckOccurrence {
  id: string;
  incomeStreamId: string;
  kind: "scheduled" | "retry";
  dueDate: string;
  retryDate: string | null;
  amountCents: number;
  transactionId: string | null;
  status: string;
  parentOccurrenceId: string | null;
  parentStatus?: string | null;
}

export function calculateRunwayForecast({
  currentLiquidCash,
  salaryCycleDays = "15,30",
  biweeklyPaydayAnchor,
  payScheduleKind,
  payIntervalDays,
  expectedSalaryAmount,
  incomeStreams,
  paycheckOccurrences = [],
  dailyDiscretionaryBurn,
  bills,
  referenceDate = new Date(),
  horizonDays = 14,
}: RunwayCalculationParams): RunwayForecastResponse {
  const ref = new Date(referenceDate);
  ref.setHours(0, 0, 0, 0);

  // 1. Determine Next Payday Date
  const activeStreams = (incomeStreams ?? [{ name: "Primary income", netPayCents: expectedSalaryAmount,
    scheduleKind: payScheduleKind, paydayAnchor: biweeklyPaydayAnchor, intervalDays: payIntervalDays, salaryCycleDays, isEnabled: true }]).filter(stream => stream.isEnabled);
  if (!activeStreams.length) throw new Error("No enabled income streams");
  for (const stream of activeStreams) {
    if (safeCents(stream.netPayCents) <= 0) throw new Error("Income must be positive");
  }
  const occurrenceById = new Map(paycheckOccurrences.map(occurrence => [occurrence.id, occurrence]));
  const settledScheduledDates = new Set(paycheckOccurrences
    .filter(occurrence => occurrence.kind === "scheduled" &&
      (occurrence.transactionId !== null || occurrence.status === "reversed_awaiting_retry"))
    .map(occurrence => `${occurrence.incomeStreamId}:${occurrence.dueDate}`));
  const forecastRetries = paycheckOccurrences.filter(occurrence => {
    if (occurrence.kind !== "retry" || occurrence.transactionId !== null || !occurrence.retryDate ||
        !occurrence.parentOccurrenceId) return false;
    const parent = occurrenceById.get(occurrence.parentOccurrenceId);
    return (occurrence.parentStatus ?? parent?.status) === "reversed_awaiting_retry";
  });
  const nextPaydayStr = activeStreams.map(stream => getNextPaydayDate(ref, stream.salaryCycleDays, stream.paydayAnchor, stream.scheduleKind, stream.intervalDays)).sort()[0];
  const daysToPayday = Math.max(0,
    calendarDay(nextPaydayStr) - calendarDay(formatLocalDate(ref)));

  // 2. Identify Bills Due Before Next Payday
  const refDateStr = formatLocalDate(ref);

  const prePaydayBills = bills.filter((b) => {
    if (b.status === "paid" || b.status === "auto_debited") return false;
    return b.dueDate >= refDateStr && b.dueDate <= nextPaydayStr;
  });

  const scheduled_bills_total = prePaydayBills.reduce(
    (sum, b) => sum + b.amountDue,
    0
  );

  // 3. Discretionary Burn & Net Buffer
  const discretionary_burn_total = safeCents(dailyDiscretionaryBurn * daysToPayday);
  const net_projected_buffer =
    safeCents(safeCents(currentLiquidCash - safeCents(scheduled_bills_total)) - discretionary_burn_total);

  const daily_allowance = Math.max(
    0,
    Math.floor(net_projected_buffer / Math.max(daysToPayday, 1))
  );

  // 4. Construct 14-Day Timeline
  let runningBalance = currentLiquidCash;
  let shortfallDate: string | null = null;
  let shortfallAmount = 0;
  const timeline: TimelineDay[] = [];
  let confirmed_inflows = 0;
  for (let i = 0; i < horizonDays; i++) {
    const dayDate = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + i);
    const dateStr = formatLocalDate(dayDate);
    let dayInflow = 0;
    const payingStreams = activeStreams.filter(stream => isScheduledPayday(dateStr, stream.salaryCycleDays ?? "15,30", stream.paydayAnchor, stream.scheduleKind, stream.intervalDays) &&
      !(stream.id && settledScheduledDates.has(`${stream.id}:${dateStr}`)));
    const retryOccurrences = forecastRetries.filter(occurrence => occurrence.retryDate === dateStr);
    const isPayday = payingStreams.length > 0 || retryOccurrences.length > 0;
    dayInflow = safeCents(
      payingStreams.reduce((sum, stream) => safeCents(sum + stream.netPayCents), 0) +
      retryOccurrences.reduce((sum, occurrence) => safeCents(sum + occurrence.amountCents), 0),
    );
    confirmed_inflows = safeCents(confirmed_inflows + dayInflow);

    // Bills due on this exact date
    const dayBills = bills.filter(
      (b) =>
        b.dueDate === dateStr &&
        b.status !== "paid" &&
        b.status !== "auto_debited"
    );

    const billsSum = dayBills.reduce((acc, b) => acc + b.amountDue, 0);
    const dayOutflow = safeCents(safeCents(billsSum) + dailyDiscretionaryBurn);

    runningBalance = safeCents(safeCents(runningBalance + dayInflow) - dayOutflow);

    if (runningBalance < 0 && !shortfallDate) {
      shortfallDate = dateStr;
      shortfallAmount = Math.abs(runningBalance);
    }

    timeline.push({
      date: dateStr,
      inflow: dayInflow,
      outflow: dayOutflow,
      balance: runningBalance,
      isPayday,
      hasDues: dayBills.length > 0,
      isGraceActive: dayBills.some((b) => b.status === "grace_period"),
      duesDescription: dayBills.map((b) => b.name),
      incomeDescription: [
        ...payingStreams.map(stream => stream.name),
        ...retryOccurrences.map(occurrence => `${activeStreams.find(stream => stream.id === occurrence.incomeStreamId)?.name ?? "Income"} retry`),
      ],
    });
  }

  const is_solvent = shortfallDate === null;

  return {
    current_liquid_cash: currentLiquidCash,
    confirmed_inflows,
    scheduled_bills_total,
    discretionary_burn_total,
    net_projected_buffer,
    daily_allowance,
    days_to_payday: daysToPayday,
    next_payday_date: nextPaydayStr,
    is_solvent,
    shortfall_date: shortfallDate,
    shortfall_amount: shortfallAmount,
    timeline,
  };
}
