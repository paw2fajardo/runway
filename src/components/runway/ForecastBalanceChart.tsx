"use client";

import { useId, useState, type PointerEvent } from "react";
import type { TimelineDay } from "@/lib/types";
import { formatCompactPHP, formatPHP } from "@/lib/currency";
import { balanceChartGeometry } from "@/lib/forecast-chart";

function dateLabel(date: string, year = true) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: year ? "numeric" : undefined });
}

export function ForecastBalanceChart({ timeline }: { timeline: TimelineDay[] }) {
  const id = useId();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chart = balanceChartGeometry(timeline);
  if (!chart) return <p className="text-body-md text-on-surface-variant" role="status">No forecast days available.</p>;

  const index = Math.min(selectedIndex ?? timeline.length - 1, timeline.length - 1);
  const selected = timeline[index];
  const point = chart.points[index];
  const selectDay = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setSelectedIndex(Math.round(fraction * (timeline.length - 1)));
  };

  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4" data-swipe-ignore>
    <div>
      <h2 id={`${id}-title`} className="text-headline-sm font-semibold text-on-surface">Daily balance</h2>
      <p className="mt-1 text-body-sm text-on-surface-variant">{dateLabel(timeline[0].date)} – {dateLabel(timeline[timeline.length - 1].date)}</p>
    </div>
    <div className="flex gap-2">
      <div aria-hidden="true" className="flex h-52 w-14 shrink-0 flex-col justify-between py-3 text-right font-mono text-label-sm tabular-nums text-on-surface-variant sm:w-16 sm:text-body-sm">
        <span>{formatCompactPHP(chart.max)}</span>
        <span>{formatCompactPHP((chart.max + chart.min) / 2)}</span>
        <span>{formatCompactPHP(chart.min)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <svg viewBox="0 0 1000 220" preserveAspectRatio="none" role="img" aria-labelledby={`${id}-title ${id}-description`}
          onPointerDown={selectDay} onPointerMove={selectDay} className="block h-52 w-full touch-pan-y overflow-visible">
          <desc id={`${id}-description`}>Projected closing balance each day. The dashed line marks zero pesos. Use the day selector below for exact dates and balances.</desc>
          <defs>
            <clipPath id={`${id}-positive`}><rect width="1000" height={chart.zeroY} /></clipPath>
            <clipPath id={`${id}-negative`}><rect y={chart.zeroY} width="1000" height={220 - chart.zeroY} /></clipPath>
          </defs>
          {[16, 110, 204].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} className="stroke-outline-variant/50" vectorEffect="non-scaling-stroke" />)}
          <line x1="0" x2="1000" y1={chart.zeroY} y2={chart.zeroY} strokeDasharray="4 5" className="stroke-on-surface-variant" vectorEffect="non-scaling-stroke" />
          <path d={chart.path} fill="none" strokeWidth="2.5" strokeLinejoin="round" className="stroke-secondary" clipPath={`url(#${id}-positive)`} vectorEffect="non-scaling-stroke" />
          <path d={chart.path} fill="none" strokeWidth="2.5" strokeLinejoin="round" className="stroke-error" clipPath={`url(#${id}-negative)`} vectorEffect="non-scaling-stroke" />
          <line x1={point.x} x2={point.x} y1="8" y2="212" strokeDasharray="2 4" className="stroke-outline" vectorEffect="non-scaling-stroke" />
          <circle cx={point.x} cy={point.y} r="4" strokeWidth="3" className={`fill-surface ${selected.balance < 0 ? "stroke-error" : "stroke-secondary"}`} vectorEffect="non-scaling-stroke" />
        </svg>
        <div aria-hidden="true" className="mt-1 flex justify-between gap-2 text-label-sm text-on-surface-variant">
          <span>{dateLabel(timeline[0].date, false)}</span><span>{dateLabel(timeline[timeline.length - 1].date, false)}</span>
        </div>
      </div>
    </div>
    <div className="border-t border-outline-variant/50 pt-3">
      <output htmlFor={`${id}-day`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body-sm">
        <span className="text-on-surface-variant">{dateLabel(selected.date)}{selected.balance < 0 ? " · Below zero" : ""}</span>
        <span className={`font-mono text-currency-lg tabular-nums ${selected.balance < 0 ? "text-error" : "text-on-surface"}`}>{formatPHP(selected.balance)}</span>
      </output>
      <label htmlFor={`${id}-day`} className="sr-only">Inspect forecast day</label>
      <input id={`${id}-day`} type="range" min="0" max={timeline.length - 1} step="1" value={index}
        aria-valuetext={`${dateLabel(selected.date)}, closing balance ${formatPHP(selected.balance)}`}
        disabled={timeline.length === 1} onChange={event => setSelectedIndex(Number(event.target.value))}
        className="mt-1 block min-h-11 w-full cursor-pointer accent-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-default" />
      <p className="text-label-sm text-on-surface-variant">End-of-day balance. Dashed line: ₱0. Tap the chart or move the selector to inspect a day.</p>
    </div>
  </section>;
}
