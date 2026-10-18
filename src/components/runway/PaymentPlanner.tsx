"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PaymentPlanResponse, PaymentPlanScenario, RunwayForecastResponse } from "@/lib/types";
import { formatPHP } from "@/lib/currency";
import { todayInManila } from "@/lib/bills/due-date";
import { ForecastBalanceChart } from "./ForecastBalanceChart";

const labels: Record<PaymentPlanScenario["id"], string> = {
  current: "Current dates and spending", spending: "Reduce daily spending",
  grace: "Use grace periods", combined: "Grace periods and reduced spending",
};

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export function PaymentPlanner({ forecast }: { forecast: RunwayForecastResponse }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [useGrace, setUseGrace] = useState(false);
  const [plan, setPlan] = useState<PaymentPlanResponse | null>(null);
  const [selectedId, setSelectedId] = useState<PaymentPlanScenario["id"]>("current");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const explanationRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPlan(null);
    void (async () => {
      try {
        const response = await fetch(`/api/runway/forecast?horizon_days=45&reference_date=${todayInManila()}&payment_plan=true&use_grace_periods=${useGrace}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.payment_plan) throw new Error(data.error || "Payment plan unavailable. Retry to load it.");
        if (!controller.signal.aborted) setPlan(data.payment_plan);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Payment plan unavailable. Retry to load it.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, useGrace, forecast, retry]);

  const selected = plan?.scenarios.find(item => item.id === selectedId) ?? plan?.scenarios[0];
  const cut = plan && selected ? plan.configured_daily_spending_cents - selected.daily_spending_cents : 0;

  useEffect(() => {
    setExplanation(null);
    setExplanationError(null);
    setExplaining(false);
    if (!selected) return;
    // An explanation belongs to this exact loaded scenario, including refreshed balances.
    return () => { explanationRequest.current?.abort(); };
  }, [selected]);

  async function explainPlan() {
    if (!selected) return;
    const controller = new AbortController();
    explanationRequest.current = controller;
    setExplaining(true);
    setExplanationError(null);
    try {
      const response = await fetch("/api/runway/assistant", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          query: "Briefly explain the cash-flow tradeoff, spending change, and any remaining shortfall. State that this is a preview and bill terms need checking.",
          plan_scenario: selected.id, use_grace_periods: useGrace,
        }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI explanation unavailable. Try again.");
      if (!controller.signal.aborted) setExplanation(data.answer);
    } catch (cause) {
      if (!controller.signal.aborted) setExplanationError(cause instanceof Error ? cause.message : "AI explanation unavailable. Try again.");
    } finally {
      if (!controller.signal.aborted) setExplaining(false);
    }
  }

  return <details className="glass-panel p-4 sm:p-6" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer text-headline-sm font-semibold text-on-surface focus-visible:outline-offset-2">Bill payment planner</summary>
    <div className="mt-space-md space-y-space-md">
      <p className="text-body-sm text-on-surface-variant">Compare the next 45 days. Preview only; bill dates, spending settings, and balances stay unchanged.</p>
      <label htmlFor={`${id}-grace`} className="flex min-h-11 cursor-pointer items-start gap-3 text-body-sm text-on-surface">
        <input id={`${id}-grace`} type="checkbox" checked={useGrace} onChange={event => setUseGrace(event.target.checked)}
          aria-describedby={`${id}-terms`} className="mt-1 h-5 w-5 shrink-0 accent-secondary focus-visible:outline-offset-2" />
        <span>Include grace periods. I checked the bill terms and payment processing times.</span>
      </label>
      <p id={`${id}-terms`} className="text-body-sm text-on-surface-variant">Grace days do not confirm fee-free payment or continued service. Autopay bills stay on their current dates. Timing options leave at least one calendar day before the configured grace end; your provider may need longer.</p>
      {loading && <p role="status" className="text-body-md text-on-surface-variant">Comparing payment options…</p>}
      {error && <div role="alert" className="space-y-2">
        <p className="text-body-sm text-error">{error}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 rounded-full border border-outline-variant px-4 text-label-md text-secondary focus-visible:outline-offset-2">Retry payment plan</button>
      </div>}
      {!loading && selected && plan && <>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-body-md font-semibold">Compare options through {dateLabel(plan.through_date)}</legend>
          {plan.scenarios.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-start gap-3 border-b border-outline-variant/50 py-3 text-body-sm">
            <input type="radio" name={`${id}-scenario`} value={item.id} checked={selected.id === item.id}
              onChange={() => setSelectedId(item.id)} className="mt-1 h-5 w-5 shrink-0 accent-secondary focus-visible:outline-offset-2" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block font-semibold text-on-surface">{labels[item.id]}</span>
              <span className="block text-on-surface-variant">Lowest daily closing balance: <span className={`font-mono tabular-nums ${item.minimum_balance_cents < 0 ? "text-error" : "text-on-surface"}`}>{formatPHP(item.minimum_balance_cents)}</span></span>
              <span className="block text-on-surface-variant">{item.shortfall_date ? `First shortfall: ${dateLabel(item.shortfall_date)}` : "No projected shortfall"}</span>
            </span>
          </label>)}
        </fieldset>
        <div aria-live="polite" className="space-y-3">
          <p className="text-body-md text-on-surface">{cut > 0
            ? `Reduce planned daily spending by ${formatPHP(cut)}, to ${formatPHP(selected.daily_spending_cents)} per day.`
            : `Planned daily spending stays at ${formatPHP(selected.daily_spending_cents)}.`}</p>
          {selected.shortfall_date && (selected.id === "spending" || selected.id === "combined") &&
            <p className="text-body-sm text-error">Even eliminating discretionary spending leaves a shortfall. Fixed bills and planned budgets remain included.</p>}
          {selected.changes.length > 0 ? <>
            <p className="text-body-sm text-on-surface-variant">Later payments improve timing, not total savings. These are comparison dates, not confirmed payment deadlines.</p>
            <ul className="divide-y divide-outline-variant/50">
              {selected.changes.map(change => <li key={change.id} className="space-y-1 py-3 text-body-sm">
                <div className="flex flex-wrap justify-between gap-2 font-semibold"><span className="break-words">{change.name}</span><span className="font-mono tabular-nums">{formatPHP(change.amount_cents)}</span></div>
                <p>Due {dateLabel(change.due_date)}. Compare paying {dateLabel(change.payment_date)}.</p>
                <p className="text-on-surface-variant">Configured grace end: {dateLabel(change.grace_end_date)}</p>
              </li>)}
            </ul>
          </> : <p className="text-body-sm text-on-surface-variant">Bill payment dates stay unchanged.</p>}
        </div>
        <ForecastBalanceChart key={selected.id} timeline={selected.timeline} />
        <div className="space-y-2">
          <button type="button" onClick={() => void explainPlan()} disabled={explaining}
            className="min-h-11 rounded-full bg-primary px-5 text-label-md text-on-primary focus-visible:outline-offset-2 disabled:opacity-50">
            {explaining ? "Explaining…" : "Explain this option with AI"}
          </button>
          <p className="text-body-sm text-on-surface-variant">Sends the calculated forecast and bill names to the configured AI provider when you request an explanation.</p>
          {explanationError && <p role="alert" className="text-body-sm text-error">{explanationError}</p>}
          {explanation && <p role="status" className="whitespace-pre-wrap text-body-md text-on-surface">{explanation}</p>}
        </div>
        <p className="text-body-sm text-on-surface-variant">Uses total liquid cash and scheduled income. Daily closing balances assume that day’s income is available for payments; individual account funding and arrival times may differ.</p>
      </>}
    </div>
  </details>;
}
