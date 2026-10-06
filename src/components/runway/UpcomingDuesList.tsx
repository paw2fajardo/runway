"use client";

import React from "react";
import { formatPHP } from "@/lib/currency";

export interface DueItem {
  id: string;
  name: string;
  dueDate: string;
  amountDue: number;
  status: string;
  isAutoPay?: boolean;
  isVariableAmount?: boolean;
  sourceAccountName?: string | null;
}

function formatDueDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

interface UpcomingDuesListProps {
  dues: DueItem[];
  onPayClick?: (due: DueItem) => void;
  idPrefix?: string;
  title?: string;
  description?: string;
  emptyMessage?: string;
}

export function UpcomingDuesList({
  dues,
  onPayClick,
  idPrefix = "runway.upcoming-dues",
  title = "Upcoming bills",
  description = "Unpaid bills",
  emptyMessage = "No bills due before the next payday.",
}: UpcomingDuesListProps) {
  return (
    <section runway-id={idPrefix} className="flex flex-col space-y-space-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 runway-id={`${idPrefix}.title`} className="font-headline-sm text-headline-sm text-on-surface font-semibold">
            {title}
          </h2>
          <span runway-id={`${idPrefix}.count`} className="inline-flex items-center justify-center px-1.5 py-0.2 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm font-bold">
            {dues.length}
          </span>
        </div>
        <span runway-id={`${idPrefix}.description`} className="text-right font-label-sm text-label-sm text-on-surface-variant font-medium">
          {description}
        </span>
      </div>

      {dues.length > 0 ? <ul className="divide-y divide-outline-variant/40 border-y border-outline-variant/50">
        {dues.map((due) => {
          const isGrace = due.status === "grace_period";
          const isPastDue = isGrace || due.status === "past_due";
          return <li
            key={due.id}
            runway-id={`${idPrefix}.item.${due.id}`}
            className="flex min-h-[68px] items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span runway-id={`${idPrefix}.item.${due.id}.name`} className="truncate font-body-md text-body-md font-semibold text-on-surface">
                  {due.name}
                </span>
                {isPastDue ? <span runway-id={`${idPrefix}.item.${due.id}.grace-status`} className="rounded px-1.5 py-0.5 text-[10px] font-bold text-error">
                  {isGrace ? "Grace period" : "Past due"}
                </span> : due.isAutoPay ? <span runway-id={`${idPrefix}.item.${due.id}.autopay-status`} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                  Auto-pay
                </span> : null}
              </div>
              <span runway-id={`${idPrefix}.item.${due.id}.schedule`} className={`block truncate text-body-sm ${isPastDue ? "text-error" : "text-on-surface-variant"}`}>
                {isPastDue
                  ? `Due ${formatDueDate(due.dueDate)} · ${isGrace ? "in grace period" : "past due"}`
                  : due.isAutoPay
                    ? `Auto-pay from ${due.sourceAccountName || "linked account"} · ${formatDueDate(due.dueDate)}`
                    : `Due ${formatDueDate(due.dueDate)} · Pay manually`}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span runway-id={`${idPrefix}.item.${due.id}.amount`} className="whitespace-nowrap font-currency-md text-currency-md font-bold tabular-nums text-on-surface">
                {formatPHP(due.amountDue)}
              </span>
              {due.isAutoPay ? <span aria-hidden="true" className="material-symbols-outlined text-secondary text-[18px]">autorenew</span> : <button
                runway-id={`${idPrefix}.item.${due.id}.pay`}
                type="button"
                onClick={() => onPayClick?.(due)}
                className="min-h-10 rounded-full px-3 text-label-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Pay
              </button>}
            </div>
          </li>;
        })}
      </ul> : <p className="border-y border-outline-variant/50 py-4 text-body-sm text-on-surface-variant">{emptyMessage}</p>}
    </section>
  );
}
