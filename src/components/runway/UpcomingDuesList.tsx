"use client";

import React from "react";
import Link from "next/link";
import { formatPHP } from "@/lib/currency";

export interface DueItem {
  id: string;
  name: string;
  dueDate: string;
  amountDue: number;
  status: string;
  isAutoPay?: boolean;
  sourceAccountName?: string | null;
}

interface UpcomingDuesListProps {
  dues: DueItem[];
  onPayClick?: (due: DueItem) => void;
}

export function UpcomingDuesList({ dues, onPayClick }: UpcomingDuesListProps) {
  const getIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("meralco") || lower.includes("electric")) return "bolt";
    if (lower.includes("pldt") || lower.includes("fiber") || lower.includes("wifi"))
      return "wifi";
    if (lower.includes("netflix") || lower.includes("spotify") || lower.includes("sub"))
      return "subscriptions";
    if (lower.includes("water") || lower.includes("maynilad")) return "water_drop";
    return "receipt_long";
  };

  return (
    <section className="flex flex-col space-y-space-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
            Upcoming Dues
          </h2>
          <span className="inline-flex items-center justify-center px-1.5 py-0.2 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm font-bold">
            {dues.length}
          </span>
        </div>
        <span className="font-label-sm text-label-sm text-on-surface-variant font-medium">
          Recorded dues
        </span>
      </div>

      <div className="flex flex-col space-y-space-xs">
        {dues.map((due) => {
          const isGrace = due.status === "grace_period";
          const icon = getIcon(due.name);

          return (
            <div
              key={due.id}
              className="glass-panel p-5 flex flex-wrap gap-4 items-center justify-between"
            >
              <div className="flex items-center space-x-space-sm min-w-0">
                <div className="w-9 h-9 rounded-lg bg-surface-container-low flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined text-[20px]">{icon}</span>
                </div>
                <div className="min-w-0 flex flex-col">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-body-md text-body-md font-semibold text-on-surface truncate">
                      {due.name}
                    </span>
                    {isGrace ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-error-container text-on-error-container">
                        Grace Active
                      </span>
                    ) : due.isAutoPay ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-container text-on-surface-variant">
                        Auto
                      </span>
                    ) : null}
                  </div>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    {isGrace
                      ? `Grace period · Due ${due.dueDate}`
                      : due.isAutoPay
                      ? `Via ${due.sourceAccountName || "Auto-debit"} on ${due.dueDate}`
                      : `Due ${due.dueDate} • Manual`}
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-space-sm shrink-0">
                <span className="font-currency-md text-currency-md font-bold text-on-surface">
                  {formatPHP(due.amountDue)}
                </span>
                {due.isAutoPay ? (
                  <span className="material-symbols-outlined text-secondary text-[18px]">
                    autorenew
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPayClick && onPayClick(due)}
                    className="min-h-11 px-5 py-2 bg-primary text-on-primary rounded-full font-label-sm text-label-sm font-semibold active:scale-95 transition"
                  >
                    Pay
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
