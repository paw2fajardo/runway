"use client";

import React, { useState } from "react";
import { TimelineDay } from "@/lib/types";
import { formatPHP } from "@/lib/currency";

interface RunwayTimelineProps {
  timeline: TimelineDay[];
  nextCycleDateStr?: string;
}

export function RunwayTimeline({
  timeline,
  nextCycleDateStr = "Unavailable",
}: RunwayTimelineProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const selectedDay = timeline.find((d) => d.date === selectedDate) || timeline[0];

  return (
    <section className="flex flex-col space-y-space-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
            14-Day Runway Calendar
          </h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Next income: {nextCycleDateStr}
          </p>
        </div>
      </div>

      {/* Timeline Scroller */}
      <div className="flex space-x-space-xs overflow-x-auto pb-1 pt-1 -mx-margin px-margin scrollbar-none snap-x snap-mandatory">
        {timeline.map((day, idx) => {
          const dateObj = new Date(`${day.date}T12:00:00`);
          const dayName = dateObj.toLocaleDateString("en-US", { weekday: "short" });
          const dayNum = dateObj.getDate();
          const isSelected = day.date === (selectedDate || timeline[0]?.date);

          if (day.isPayday) {
            return (
              <button
                key={day.date}
                type="button"
                aria-pressed={isSelected} onClick={() => setSelectedDate(day.date)}
                className={`flex flex-col items-center justify-between min-w-[64px] min-h-24 py-3 px-2 bg-secondary-fixed text-on-secondary-fixed rounded-lg border shadow-sm text-center shrink-0 snap-start transition-all ${
                  isSelected ? "border-2 border-secondary ring-2 ring-secondary/30 scale-105" : "border-secondary"
                }`}
              >
                <div className="flex items-center space-x-0.5">
                  <span className="material-symbols-outlined text-[12px] text-secondary">
                    star
                  </span>
                  <span className="font-label-sm text-label-sm font-bold">
                    {dayName}
                  </span>
                </div>
                <span className="font-currency-md text-currency-md font-bold text-on-secondary-fixed my-0.5">
                  {dayNum}
                </span>
                <span className="font-label-sm text-label-sm uppercase font-bold text-secondary tracking-tighter">
                  Income
                </span>
              </button>
            );
          }

          const isFirstDay = idx === 0;

          return (
            <button
              key={day.date}
              type="button"
              aria-pressed={isSelected} onClick={() => setSelectedDate(day.date)}
              className={`flex flex-col items-center justify-between min-w-[64px] min-h-24 py-3 px-2 glass-panel text-center shrink-0 snap-start transition-all ${
                isSelected
                  ? "border-2 border-secondary shadow-md scale-105"
                  : isFirstDay
                  ? "border-2 border-secondary/70 shadow-sm"
                  : "border border-outline-variant/30"
              }`}
            >
              <span
                className={`font-label-sm text-label-sm font-semibold ${
                  isFirstDay || isSelected ? "text-secondary" : "text-on-surface-variant"
                }`}
              >
                {dayName}
              </span>
              <span className="font-currency-md text-currency-md font-bold text-on-surface my-0.5">
                {dayNum}
              </span>
              <div className="flex items-center justify-center h-2">
                {day.isGraceActive ? (
                  <span className="w-2 h-2 rounded-full bg-on-tertiary-container ring-2 ring-error-container" />
                ) : day.hasDues ? (
                  <span className="w-2 h-2 rounded-full bg-error" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Day Forecast Dropdown / Detail Callout */}
      {selectedDay && (
        <div className="bg-surface-container-low p-4 rounded-[24px] flex flex-col gap-3 text-on-surface animate-in fade-in duration-200">
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              {new Date(`${selectedDay.date}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="font-currency-sm text-currency-sm font-semibold">
              Projected Balance: {formatPHP(selectedDay.balance)}
            </span>
          </div>
          {selectedDay.duesDescription && selectedDay.duesDescription.length > 0 && (
            <span className="font-label-sm text-label-sm text-error font-medium">
              Dues: {selectedDay.duesDescription.join(", ")}
            </span>
          )}
          {selectedDay.isPayday && (
            <span className="font-label-sm text-label-sm text-secondary font-bold">
              {selectedDay.incomeDescription?.join(", ") || "Projected income"} (+{formatPHP(selectedDay.inflow)})
            </span>
          )}
          {!selectedDay.isPayday && !selectedDay.duesDescription?.length && (
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              Normal burn (-{formatPHP(selectedDay.outflow)})
            </span>
          )}
        </div>
      )}
    </section>
  );
}
