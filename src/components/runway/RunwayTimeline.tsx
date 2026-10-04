"use client";

import type { TimelineDay } from "@/lib/types";
import { formatPHP } from "@/lib/currency";

interface RunwayTimelineProps {
  timeline: TimelineDay[];
  nextCycleDateStr?: string;
}

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

export function RunwayTimeline({ timeline, nextCycleDateStr = "Unavailable" }: RunwayTimelineProps) {
  if (!timeline.length) return <p runway-id="runway.forecast-empty" className="text-body-md">No forecast days available.</p>;

  const lowestDay = timeline.reduce((lowest, day) => day.balance < lowest.balance ? day : lowest);
  const endingDay = timeline[timeline.length - 1];

  return (
    <section runway-id="runway.forecast-timeline" className="min-w-0 space-y-5 text-on-surface" aria-label="Daily cash forecast">
      <div className="text-body-sm text-on-surface-variant">
        <p runway-id="runway.forecast-date-range">{dateLabel(timeline[0].date)} – {dateLabel(endingDay.date)}</p>
        <p runway-id="runway.forecast-next-income" className="mt-1">Next income: {nextCycleDateStr}</p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={`min-w-0 rounded-2xl border p-4 ${lowestDay.balance < 0 ? "border-error/30 bg-error-container/30" : "border-outline-variant/30 bg-surface-container-low"}`}>
          <dt runway-id="runway.forecast-lowest-label" className="text-body-sm text-on-surface-variant">Lowest projected balance</dt>
          <dd runway-id="runway.forecast-lowest-balance" className={`mt-1 break-words text-headline-sm font-semibold tabular-nums ${lowestDay.balance < 0 ? "text-error" : "text-on-surface"}`}>{formatPHP(lowestDay.balance)}</dd>
          <dd runway-id="runway.forecast-lowest-date" className="mt-1 text-body-sm text-on-surface-variant">{dateLabel(lowestDay.date)}{lowestDay.balance < 0 ? " · Shortfall" : ""}</dd>
        </div>
        <div className="min-w-0 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
          <dt runway-id="runway.forecast-ending-label" className="text-body-sm text-on-surface-variant">Ending projected balance</dt>
          <dd runway-id="runway.forecast-ending-balance" className={`mt-1 break-words text-headline-sm font-semibold tabular-nums ${endingDay.balance < 0 ? "text-error" : "text-on-surface"}`}>{formatPHP(endingDay.balance)}</dd>
          <dd runway-id="runway.forecast-ending-date" className="mt-1 text-body-sm text-on-surface-variant">{dateLabel(endingDay.date)}</dd>
        </div>
      </dl>

      <div>
        <h3 runway-id="runway.forecast-daily-title" className="text-body-md font-semibold">Day by day</h3>
        <p runway-id="runway.forecast-daily-description" className="mt-1 text-body-sm text-on-surface-variant">Balances are projected at the end of each day. Spending includes bills and your daily spending estimate.</p>
      </div>
      <ol className="space-y-3">
        {timeline.map((day) => (
          <li key={day.date} runway-id={`runway.forecast-day.${day.date}`} className={`min-w-0 rounded-2xl border p-4 ${day.balance < 0 ? "border-error/30 bg-error-container/20" : "border-outline-variant/30 bg-surface-container-low"}`}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <time runway-id={`runway.forecast-day.${day.date}.date`} dateTime={day.date} className="text-body-md font-semibold">{dateLabel(day.date)}</time>
              <div className="min-w-0">
                <p runway-id={`runway.forecast-day.${day.date}.balance`} className={`break-words text-body-md font-semibold tabular-nums ${day.balance < 0 ? "text-error" : "text-on-surface"}`}>{formatPHP(day.balance)}</p>
                <p runway-id={`runway.forecast-day.${day.date}.balance-label`} className="text-body-sm text-on-surface-variant">End-of-day balance</p>
              </div>
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-body-sm tabular-nums">
              <div className="flex flex-wrap gap-x-2"><dt runway-id={`runway.forecast-day.${day.date}.income-label`} className="text-on-surface-variant">Income</dt><dd runway-id={`runway.forecast-day.${day.date}.income`} className={day.inflow > 0 ? "font-semibold text-secondary" : "text-on-surface"}>{formatPHP(day.inflow)}</dd></div>
              <div className="flex flex-wrap gap-x-2"><dt runway-id={`runway.forecast-day.${day.date}.spending-label`} className="text-on-surface-variant">Spending</dt><dd runway-id={`runway.forecast-day.${day.date}.spending`}>{formatPHP(day.outflow)}</dd></div>
            </dl>
            {(day.inflow > 0 || day.isPayday || day.hasDues || day.duesDescription?.length || day.isGraceActive || day.balance < 0) && (
              <div className="mt-3 space-y-1 border-t border-outline-variant/30 pt-3 text-body-sm [overflow-wrap:anywhere]">
                {(day.inflow > 0 || day.isPayday) && <p runway-id={`runway.forecast-day.${day.date}.income-description`} className="text-secondary"><span runway-id={`runway.forecast-day.${day.date}.income-description-label`} className="font-semibold">Income: </span>{day.incomeDescription?.join(", ") || "Projected income"}</p>}
                {(day.hasDues || !!day.duesDescription?.length) && <p runway-id={`runway.forecast-day.${day.date}.bills-description`}><span runway-id={`runway.forecast-day.${day.date}.bills-description-label`} className="font-semibold">Bills: </span>{day.duesDescription?.join(", ") || "Scheduled bills"}</p>}
                {day.isGraceActive && <p runway-id={`runway.forecast-day.${day.date}.grace-warning`} className="text-error">Bill grace period active</p>}
                {day.balance < 0 && <p runway-id={`runway.forecast-day.${day.date}.shortfall`} className="font-semibold text-error">Projected shortfall: {formatPHP(Math.abs(day.balance))}</p>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
