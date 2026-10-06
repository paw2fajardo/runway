"use client";

import React from "react";
import { formatPHP } from "@/lib/currency";
import { CircleCheck, TriangleAlert } from "lucide-react";

interface SolvencyHeroProps {
  safeToSpend: number;
  dailyAllowance: number;
  liquidCash: number;
  upcomingDues: number;
  plannedSpending: number;
  daysToPayday: number;
  paydayDateStr?: string;
  isSolvent?: boolean;
  revolvingCreditAccounts?: Array<{
    id: string;
    name: string;
    currentBalance: number;
    creditLimit?: number | null;
  }>;
}

export function SolvencyHero({
  safeToSpend,
  dailyAllowance,
  liquidCash,
  upcomingDues,
  plannedSpending,
  daysToPayday,
  paydayDateStr = "Unavailable",
  isSolvent = true,
  revolvingCreditAccounts = [],
}: SolvencyHeroProps) {
  return (
    <section runway-id="runway.solvency-hero" className="forest-panel min-h-[376px] min-[380px]:min-h-[304px] p-6 flex flex-col gap-6">
      {/* Top badge row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 border border-white/15 rounded-full">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isSolvent ? "bg-secondary-fixed" : "bg-rose-300"
            }`}
          />
          <span runway-id="runway.solvency-status" className={`font-label-sm text-label-sm font-medium ${isSolvent ? "text-secondary-fixed" : "text-rose-200"}`}>
            {isSolvent ? "Safe to spend" : "Shortfall Warning"}
          </span>
        </div>
        <span runway-id="runway.next-income" className="font-label-sm text-label-sm font-medium text-secondary-fixed px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
          Next income: {paydayDateStr} ({daysToPayday} days left)
        </span>
      </div>

      {/* Main Solvency Number */}
      <div className="space-y-1">
        <div className="flex items-baseline space-x-1">
          <span runway-id="runway.safe-to-spend"
            className={`font-currency-display text-currency-display break-all font-bold tracking-tight ${
              isSolvent ? "text-white" : "text-rose-200"
            }`}
          >
            {formatPHP(safeToSpend)}
          </span>
        </div>
        <div className="flex items-center space-x-1.5">
          {isSolvent ? <CircleCheck size={17} className="shrink-0 text-secondary-fixed" aria-hidden="true" /> : <TriangleAlert size={17} className="shrink-0 text-rose-200" aria-hidden="true" />}
          <span runway-id="runway.daily-allowance-label" className="font-body-sm text-body-sm text-secondary-fixed font-medium">
            {isSolvent ? "Buffer Safe" : "Impending Deficit"} •{" "}
            <span runway-id="runway.daily-allowance" className="font-currency-sm text-currency-sm font-semibold text-white">
              {formatPHP(dailyAllowance)}/day
            </span>{" "}
            if spread evenly
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-white/15 pt-4 min-[380px]:grid-cols-2 sm:grid-cols-3">
        <div className="min-w-0">
          <span runway-id="runway.breakdown-liquid-cash-label" className="font-label-sm text-label-sm text-white/70">
            Liquid Cash
          </span>
          <div runway-id="runway.breakdown-liquid-cash" className="mt-0.5 font-currency-md text-currency-md font-semibold text-white whitespace-nowrap">
            {formatPHP(liquidCash)}
          </div>
        </div>

        <div className="min-w-0">
          <span runway-id="runway.breakdown-upcoming-dues-label" className="font-label-sm text-label-sm text-white/70">
            Bills due by payday
          </span>
          <div runway-id="runway.breakdown-upcoming-dues" className="mt-0.5 font-currency-md text-currency-md font-semibold text-rose-200 whitespace-nowrap">
            {formatPHP(upcomingDues)}
          </div>
        </div>

        <div className="min-w-0">
          <span runway-id="runway.breakdown-planned-spending-label" className="font-label-sm text-label-sm text-white/70">
            Planned Spending
          </span>
          <div runway-id="runway.breakdown-planned-spending" className="mt-0.5 font-currency-md text-currency-md font-semibold text-rose-200 whitespace-nowrap">
            {formatPHP(plannedSpending)}
          </div>
        </div>
      </div>

      {revolvingCreditAccounts.length > 0 && (
        <details runway-id="runway.solvency-credit-breakdown" className="border-t border-white/15 pt-3">
          <summary runway-id="runway.solvency-credit-breakdown.toggle" className="min-h-11 cursor-pointer list-inside font-label-md text-label-md font-medium text-secondary-fixed marker:text-secondary-fixed">
            Available credit by card
          </summary>
          <ul className="mt-2 divide-y divide-white/10">
            {revolvingCreditAccounts.map((account) => (
              <li key={account.id} runway-id={`runway.solvency-credit-breakdown.account.${account.id}`} className="flex min-w-0 items-center justify-between gap-3 py-2 font-body-sm text-body-sm text-white/85">
                <span className="min-w-0 [overflow-wrap:anywhere]">{account.name}</span>
                <span className="shrink-0 whitespace-nowrap font-currency-sm text-currency-sm font-semibold text-white">
                  {account.creditLimit == null ? "—" : formatPHP(account.creditLimit - account.currentBalance)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
