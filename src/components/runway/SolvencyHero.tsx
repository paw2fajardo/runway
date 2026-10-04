"use client";

import React, { useState } from "react";
import { formatPHP } from "@/lib/currency";
import { Dialog } from "@/components/ui/Dialog";
import { CircleCheck, TriangleAlert } from "lucide-react";

interface SolvencyHeroProps {
  safeToSpend: number;
  dailyAllowance: number;
  liquidCash: number;
  upcomingDues: number;
  daysToPayday: number;
  paydayDateStr?: string;
  isSolvent?: boolean;
}

export function SolvencyHero({
  safeToSpend,
  dailyAllowance,
  liquidCash,
  upcomingDues,
  daysToPayday,
  paydayDateStr = "Unavailable",
  isSolvent = true,
}: SolvencyHeroProps) {
  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);
  return (
    <>
    <section runway-id="runway.solvency-hero" className="forest-panel p-6 flex flex-col gap-6">
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
            allowance
          </span>
        </div>
      </div>

      <button runway-id="runway.view-breakdown" type="button" onClick={() => setIsBreakdownOpen(true)} className="min-h-11 self-start px-5 rounded-full bg-white text-primary text-body-md font-semibold shadow-sm">View breakdown</button>
    </section>
      <Dialog open={isBreakdownOpen} onClose={() => setIsBreakdownOpen(false)} title="Runway breakdown">
      <div className="flex flex-col gap-5 text-on-surface">
        <div className="flex flex-col items-start text-left">
          <span runway-id="runway.breakdown-liquid-cash-label" className="font-label-sm text-label-sm text-on-surface-variant">
            Liquid Cash
          </span>
          <div className="flex items-center space-x-1 mt-0.5">
            <span runway-id="runway.breakdown-liquid-cash" className="font-currency-md text-currency-md font-semibold text-on-surface">
              {formatPHP(liquidCash)}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-start">
          <span runway-id="runway.breakdown-upcoming-dues-label" className="font-label-sm text-label-sm text-on-surface-variant">
            Upcoming Dues
          </span>
          <div className="flex items-center space-x-1 mt-0.5">
            <span runway-id="runway.breakdown-upcoming-dues" className="font-currency-md text-currency-md font-semibold text-error">
              {formatPHP(upcomingDues)}
            </span>
          </div>
        </div>
      </div>
      </Dialog>
    </>
  );
}
