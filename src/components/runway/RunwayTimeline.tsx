"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TimelineDay } from "@/lib/types";
import { formatPHP } from "@/lib/currency";

interface RunwayTimelineProps {
  timeline: TimelineDay[];
  nextCycleDateStr?: string;
  nextPaydayDate?: string;
}

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function summaryDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

function dayHasDetails(day: TimelineDay) {
  return Boolean(day.inflow > 0 || day.isPayday || day.hasDues || day.duesDescription?.length || day.plannedSpending?.length || day.isGraceActive);
}

export function RunwayTimeline({
  timeline,
  nextCycleDateStr = "Unavailable",
  nextPaydayDate,
}: RunwayTimelineProps) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  if (!timeline.length) return <p runway-id="runway.forecast-empty" className="text-body-md">No forecast days available.</p>;

  const lowestDay = timeline.reduce((lowest, day) => day.balance < lowest.balance ? day : lowest);
  const endingDay = timeline[timeline.length - 1];

  return (
    <section runway-id="runway.forecast-timeline" className="min-w-0 space-y-5 text-on-surface" aria-label="Daily cash forecast">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-body-sm text-on-surface-variant">
        <p runway-id="runway.forecast-date-range">{dateLabel(timeline[0].date)} – {dateLabel(endingDay.date)}</p>
        <p runway-id="runway.forecast-next-income">Next income: {nextCycleDateStr}</p>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-outline-variant/50 border-y border-outline-variant/50 py-3">
        <div className="min-w-0 pr-4">
          <dt runway-id="runway.forecast-lowest-label" className="text-body-sm text-on-surface-variant">Lowest projected balance</dt>
          <dd runway-id="runway.forecast-lowest-balance" className={`mt-1 break-words text-body-md font-semibold tabular-nums ${lowestDay.balance < 0 ? "text-error" : "text-on-surface"}`}>{formatPHP(lowestDay.balance)}</dd>
          <dd runway-id="runway.forecast-lowest-date" className={`mt-0.5 text-body-sm ${lowestDay.balance < 0 ? "font-semibold text-error" : "text-on-surface-variant"}`}>{summaryDate(lowestDay.date)}{lowestDay.balance < 0 ? " · Shortfall" : ""}</dd>
        </div>
        <div className="min-w-0 pl-4">
          <dt runway-id="runway.forecast-ending-label" className="text-body-sm text-on-surface-variant">Balance on {summaryDate(endingDay.date)}</dt>
          <dd runway-id="runway.forecast-ending-balance" className={`mt-1 break-words text-body-md font-semibold tabular-nums ${endingDay.balance < 0 ? "text-error" : "text-on-surface"}`}>{formatPHP(endingDay.balance)}</dd>
          <dd className="mt-0.5 text-body-sm text-on-surface-variant">End of forecast</dd>
        </div>
      </dl>

      <div>
        <h3 runway-id="runway.forecast-daily-title" className="text-label-md font-semibold">Daily cash flow</h3>
        <p runway-id="runway.forecast-daily-description" className="mt-1 text-body-sm text-on-surface-variant">Outflow includes bills, budget plans, and your daily spending estimate. Balances are projected at day’s end.</p>
      </div>

      <div className="min-w-0">
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(5rem,0.85fr)_minmax(5.5rem,0.95fr)_minmax(7rem,1fr)] gap-3 border-y border-outline-variant/50 bg-surface-container-low px-3 py-2 text-label-sm font-semibold text-on-surface-variant sm:grid">
          <span>Date</span><span className="text-right">Income</span><span className="text-right">Outflow</span><span className="text-right">End balance</span>
        </div>
        <ol runway-id="runway.forecast-days" className="divide-y divide-outline-variant/40 border-b border-outline-variant/50">
          {timeline.map((day) => {
            const detailsAvailable = dayHasDetails(day);
            const expanded = expandedDate === day.date;
            const detailsId = `forecast-details-${day.date}`;
            const isNextPayday = Boolean(nextPaydayDate && day.date === nextPaydayDate);
            return <li key={day.date} runway-id={`runway.forecast-day.${day.date}`} className="min-w-0">
              {isNextPayday && <p runway-id={`runway.forecast-day.${day.date}.payday-marker`} className="border-b border-outline-variant/40 bg-surface-container-low px-3 py-2 text-label-sm font-semibold text-secondary">Next payday · {dateLabel(day.date)}</p>}
              <div className="grid grid-cols-2 gap-x-3 px-3 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(5rem,0.85fr)_minmax(5.5rem,0.95fr)_minmax(7rem,1fr)] sm:items-center sm:gap-3 sm:py-2.5">
                <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 sm:col-span-1 sm:block">
                  <div className="flex min-w-0 items-center gap-2">
                    <time runway-id={`runway.forecast-day.${day.date}.date`} dateTime={day.date} className="truncate text-body-sm font-semibold">{dateLabel(day.date)}</time>
                    {day.balance < 0 && <span className="shrink-0 text-label-sm font-semibold text-error">Shortfall</span>}
                  </div>
                  <p runway-id={`runway.forecast-day.${day.date}.balance`} className={`shrink-0 text-right text-body-md font-semibold tabular-nums sm:hidden ${day.balance < 0 ? "text-error" : "text-on-surface"}`}>
                    <span className="sr-only">End balance: </span>{formatPHP(day.balance)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 text-body-sm tabular-nums sm:justify-end"><span className="text-on-surface-variant sm:hidden">Income</span><span runway-id={`runway.forecast-day.${day.date}.income`} className={day.inflow > 0 ? "font-semibold text-secondary" : "text-on-surface"}>{formatPHP(day.inflow)}</span></div>
                <div className="flex items-center justify-between gap-2 text-body-sm tabular-nums sm:justify-end"><span className="text-on-surface-variant sm:hidden">Outflow</span><span runway-id={`runway.forecast-day.${day.date}.spending`}>{formatPHP(day.outflow)}</span></div>
                <span className="hidden text-right text-body-sm font-semibold tabular-nums sm:block">{formatPHP(day.balance)}</span>
                {detailsAvailable && <div className="col-span-2 mt-1 sm:col-span-4 sm:mt-0">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedDate(expanded ? null : day.date)}
                    className="inline-flex min-h-11 items-center gap-1 text-label-sm font-semibold text-secondary focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {day.inflow > 0 || day.isPayday ? "Income" : null}
                    {(day.inflow > 0 || day.isPayday) && (day.hasDues || day.duesDescription?.length || day.plannedSpending?.length) ? " · " : null}
                    {day.hasDues || day.duesDescription?.length ? "Bills" : null}
                    {day.plannedSpending?.length ? `${day.hasDues || day.duesDescription?.length ? " · " : ""}Budget: ${day.plannedSpending.join(", ")}` : null}
                    {day.isGraceActive ? " · Grace period" : null}
                    <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                    <span className="sr-only"> details for {dateLabel(day.date)}</span>
                  </button>
                  {expanded && <div id={detailsId} className="space-y-1 border-t border-outline-variant/30 pb-1 pt-2 text-body-sm [overflow-wrap:anywhere]">
                    {(day.inflow > 0 || day.isPayday) && <p runway-id={`runway.forecast-day.${day.date}.income-description`} className="text-secondary"><span runway-id={`runway.forecast-day.${day.date}.income-description-label`} className="font-semibold">Income: </span>{day.incomeDescription?.join(", ") || "Projected income"}</p>}
                    {(day.hasDues || !!day.duesDescription?.length) && <p runway-id={`runway.forecast-day.${day.date}.bills-description`}><span runway-id={`runway.forecast-day.${day.date}.bills-description-label`} className="font-semibold">Bills: </span>{day.duesDescription?.join(", ") || "Scheduled bills"}</p>}
                    {!!day.plannedSpending?.length && <p runway-id={`runway.forecast-day.${day.date}.planned-spending`}><span className="font-semibold">Budget plans: </span>{day.plannedSpending.join(", ")}</p>}
                    {day.isGraceActive && <p runway-id={`runway.forecast-day.${day.date}.grace-warning`} className="text-error">Bill grace period active</p>}
                  </div>}
                </div>}
                {day.balance < 0 && <p runway-id={`runway.forecast-day.${day.date}.shortfall`} className="col-span-2 mt-1 text-body-sm font-semibold text-error sm:col-span-4">Projected shortfall: {formatPHP(Math.abs(day.balance))}</p>}
              </div>
            </li>;
          })}
        </ol>
      </div>
    </section>
  );
}
