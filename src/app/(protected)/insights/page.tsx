"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/layout/BottomNav";
import { ForecastBalanceChart } from "@/components/runway/ForecastBalanceChart";
import { formatPHP } from "@/lib/currency";
import type { InsightsResponse, compareForecasts } from "@/lib/insights";
import type { RunwayForecastResponse } from "@/lib/types";
import { todayInManila } from "@/lib/bills/due-date";
import { PaymentPlanner } from "@/components/runway/PaymentPlanner";

interface Baseline { saved_at: string | null; comparison: ReturnType<typeof compareForecasts> | null }
const metricNames: Record<string, string> = { current_liquid_cash: "Liquid cash", scheduled_bills_total: "Bills through next payday",
  planned_spending_total: "Planned budget reserves", discretionary_burn_total: "Daily spending through next payday", net_projected_buffer: "Projected buffer" };
const button = "inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-label-md text-on-primary focus-visible:outline-offset-2 disabled:opacity-50";
const panel = "glass-panel min-w-0 space-y-space-md p-4 sm:p-6";

async function jsonResponse<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Data unavailable. Retry.");
  return data as T;
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [baselineRevision, setBaselineRevision] = useState(0);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchase, setPurchase] = useState<RunwayForecastResponse["purchase_scenarios"]>(undefined);
  const [purchaseChoice, setPurchaseChoice] = useState<"now" | "after_payday">("now");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [paymentText, setPaymentText] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentStaged, setPaymentStaged] = useState(false);
  const [stagingPayment, setStagingPayment] = useState(false);
  const [question, setQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(null); setInsights(null); setAnswer(null); setAnswerError(null);
    void jsonResponse<InsightsResponse>("/api/runway/insights", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setInsights(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    setBaselineError(null);
    void jsonResponse<Baseline>("/api/runway/baseline", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setBaseline(data); })
      .catch(cause => { if (!controller.signal.aborted) setBaselineError(cause.message); });
    return () => controller.abort();
  }, [baselineRevision]);

  async function saveBaseline() {
    setSavingBaseline(true); setBaselineError(null);
    try { await jsonResponse("/api/runway/baseline", { method: "POST" }); setBaselineRevision(value => value + 1); }
    catch (cause) { setBaselineError(cause instanceof Error ? cause.message : "Baseline could not be saved."); }
    finally { setSavingBaseline(false); }
  }

  async function comparePurchase(event: React.FormEvent) {
    event.preventDefault();
    const [whole, fraction = ""] = purchaseAmount.split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!/^\d+(?:\.\d{1,2})?$/.test(purchaseAmount) || !Number.isSafeInteger(amount) || amount <= 0) {
      setPurchaseError("Enter a positive peso amount with up to two decimal places."); return;
    }
    setCalculating(true); setPurchaseError(null); setPurchase(undefined);
    try {
      const forecast = await jsonResponse<RunwayForecastResponse>(`/api/runway/forecast?horizon_days=45&reference_date=${todayInManila()}&purchase_cents=${amount}`);
      if (!forecast.purchase_scenarios) throw new Error("Purchase comparison unavailable. Retry.");
      setPurchase(forecast.purchase_scenarios); setPurchaseChoice("now");
    } catch (cause) { setPurchaseError(cause instanceof Error ? cause.message : "Purchase comparison unavailable."); }
    finally { setCalculating(false); }
  }

  async function explainReview() {
    setExplaining(true); setAnswerError(null); setAnswer(null);
    try {
      const data = await jsonResponse<{ answer: string }>("/api/runway/assistant", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Explain the weekly spending changes and suggest up to three concrete spending improvements supported by the supplied insights. Mention unclassified spending and incomplete history. Do not invent transactions or savings.", insights: true }) });
      setAnswer(data.answer);
    } catch (cause) { setAnswerError(cause instanceof Error ? cause.message : "AI explanation unavailable."); }
    finally { setExplaining(false); }
  }

  async function stagePayment(event: FormEvent) {
    event.preventDefault();
    setStagingPayment(true); setPaymentError(null); setPaymentStaged(false);
    try {
      await jsonResponse("/api/inbox/parse", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_payload: paymentText.trim(), source_channel: "quick_text" }) });
      setPaymentText(""); setPaymentStaged(true);
    } catch (cause) { setPaymentError(cause instanceof Error ? cause.message : "Entry could not be staged. Retry."); }
    finally { setStagingPayment(false); }
  }

  async function askRunway(event: FormEvent) {
    event.preventDefault();
    setAsking(true); setAiError(null); setAiAnswer(null);
    try {
      const data = await jsonResponse<{ answer?: string }>("/api/runway/assistant", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question.trim() }) });
      if (typeof data.answer !== "string") throw new Error("The Runway AI response was invalid. Retry.");
      setAiAnswer(data.answer);
    } catch (cause) { setAiError(cause instanceof Error ? cause.message : "Unable to answer this Runway question."); }
    finally { setAsking(false); }
  }

  const selectedPurchase = purchase?.[purchaseChoice];
  return <div className="min-h-screen">

    <main className="app-bottom-clearance mx-auto w-full max-w-[480px] space-y-space-lg px-margin pt-20 md:max-w-5xl">
      <div className="space-y-2"><h1 className="text-headline-lg font-semibold">Insights</h1>
        <p className="text-body-md text-on-surface-variant">Spending patterns, payment options, and AI tools for your cash flow.</p>
      </div>
      <section className={panel} aria-labelledby="ai-tools-title">
        <div><h2 id="ai-tools-title" className="text-headline-sm font-semibold">Runway AI</h2>
          <p className="text-body-sm text-on-surface-variant">Ask about your forecast or prepare a payment entry. AI requests may include your forecast, spending data, or the text you submit. AI never changes your ledger.</p></div>
        <form onSubmit={askRunway} className="space-y-2">
          <label htmlFor="runway-ai-question" className="block text-body-sm font-medium">Ask a question</label>
          <input id="runway-ai-question" value={question} onChange={event => { setQuestion(event.target.value); setAiError(null); setAiAnswer(null); }} maxLength={1000} required
            placeholder="Can I afford a ₱12,000 monitor this weekend?" className="min-h-11 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 text-body-md" />
          <button type="submit" disabled={asking || !question.trim()} className={button}>{asking ? "Thinking…" : "Ask Runway"}</button>
          {aiError && <p role="alert" className="text-body-sm text-error">{aiError}</p>}
          {aiAnswer && <p role="status" className="whitespace-pre-wrap text-body-md">{aiAnswer}</p>}
        </form>
        <form onSubmit={stagePayment} className="space-y-2 border-t border-outline-variant/50 pt-space-md">
          <label htmlFor="insights-payment-text" className="block text-body-sm font-medium">Describe a payment</label>
          <textarea id="insights-payment-text" rows={3} maxLength={4000} required value={paymentText}
            onChange={event => { setPaymentText(event.target.value); setPaymentStaged(false); setPaymentError(null); }}
            placeholder="Spent ₱420 on groceries using GCash" className="w-full resize-y rounded-xl border border-outline-variant bg-surface-container-low p-3 text-body-md" />
          <p className="text-body-sm text-on-surface-variant">We prepare a draft. Review every field in Inbox before logging. Text may go to the configured AI provider if the local parser cannot read it.</p>
          <button type="submit" disabled={stagingPayment || !paymentText.trim()} className={button}>{stagingPayment ? "Preparing…" : "Prepare payment entry"}</button>
          {paymentError && <p role="alert" className="text-body-sm text-error">{paymentError}</p>}
          {paymentStaged && <p role="status" className="text-body-sm">Draft ready. <Link href="/inbox" className="text-secondary underline">Review it in Inbox</Link>.</p>}
        </form>
      </section>
      <PaymentPlanner />
      {error ? <div role="alert" className={panel}><p className="text-error">{error}</p><button className={button} onClick={() => setRevision(value => value + 1)}>Retry insights</button></div>
        : !insights ? <p role="status">Loading spending history…</p> : <>
          <section className={panel} aria-labelledby="weekly-title">
            <h2 id="weekly-title" className="text-headline-sm font-semibold">Weekly spending review</h2>
            <p className="text-body-sm text-on-surface-variant">{insights.weekly.from_date} through {insights.weekly.through_date}. Includes today. Compared with the preceding seven calendar days.</p>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><dt className="text-body-sm text-on-surface-variant">Recorded purchases and fees</dt><dd className="font-mono text-currency-lg tabular-nums">{formatPHP(insights.weekly.current_cents)}</dd></div>
              <div><dt className="text-body-sm text-on-surface-variant">Change from previous week</dt><dd className="font-mono text-currency-lg tabular-nums">{formatPHP(insights.weekly.change_cents)}</dd></div></dl>
            <ul className="divide-y divide-outline-variant/50">{insights.weekly.categories.map(category => <li key={category.name} className="flex flex-wrap justify-between gap-2 py-3 text-body-sm"><span>{category.name}</span><span className="font-mono tabular-nums">{formatPHP(category.current)} · change {formatPHP(category.change_cents)}</span></li>)}</ul>
            {insights.weekly.categories.length === 0 && <p className="text-body-sm">No recorded purchases in either week.</p>}
            <p className="text-body-sm text-on-surface-variant">Unclassified purchases: {formatPHP(insights.weekly.unclassified_cents)}. Unexplained balance decreases: {formatPHP(insights.weekly.unexplained_decreases_cents)}, shown separately. Transfers and loan repayments are excluded; their recorded fees are included. Cash bill payments are included.</p>
            <Link href="/transactions" className="inline-flex min-h-11 items-center text-secondary underline">Review recorded activity</Link>
            <div><button type="button" disabled={explaining} onClick={() => void explainReview()} className={button}>{explaining ? "Explaining…" : "Explain spending with AI"}</button>
              <p className="mt-2 text-body-sm text-on-surface-variant">Sends calculated insights, category and merchant names, and the forecast to your configured AI provider when requested.</p></div>
            {answerError && <p role="alert" className="text-body-sm text-error">{answerError}</p>}
            {answer && <p role="status" className="whitespace-pre-wrap text-body-md">{answer}</p>}
          </section>
          <details className={panel}><summary className="min-h-11 cursor-pointer text-headline-sm font-semibold">Recurring charges and possible duplicates</summary>
            <p className="text-body-sm text-on-surface-variant">Candidates from at least three regularly spaced charges on the same account. They are not confirmed subscriptions. Linked bill payments are excluded.</p>
            <ul className="divide-y divide-outline-variant/50">{insights.recurring.recurring.map((item, index) => <li key={index} className="space-y-1 py-3 text-body-sm"><p className="font-semibold">{item.description} · {item.cadence}</p><p>{formatPHP(item.amount_cents)}. Next estimated charge: {item.next_expected_date}.</p>{item.increase_cents > 0 && <p className="text-error">Latest charge is {formatPHP(item.increase_cents)} above the prior median. Check for a price increase.</p>}</li>)}</ul>
            {insights.recurring.recurring.length === 0 && <p className="text-body-sm">No recurring charge candidates found.</p>}
            <ul className="divide-y divide-outline-variant/50">{insights.recurring.duplicates.map((item, index) => <li key={index} className="py-3 text-body-sm">Possible duplicate: {item.description}, {formatPHP(item.amount_cents)}. Same account, amount, and description within 15 minutes. Review History before changing either entry.</li>)}</ul>
            {insights.recurring.duplicates.length === 0 && <p className="text-body-sm">No possible duplicates found.</p>}
          </details>
          <details className={panel}><summary className="min-h-11 cursor-pointer text-headline-sm font-semibold">Variable bill estimates</summary>
            <p className="text-body-sm text-on-surface-variant">Median of up to six paid occurrences. The range is historical, not a guarantee. Estimates do not change saved bills or forecasts.</p>
            <ul className="divide-y divide-outline-variant/50">{insights.variable_bills.map(bill => <li key={bill.id} className="space-y-1 py-3 text-body-sm"><p className="font-semibold">{bill.name}</p>{bill.estimate_cents === null ? <p>Needs at least three paid occurrences; {bill.sample_count} available.</p> : <p>Estimate {formatPHP(bill.estimate_cents)}. Observed range {formatPHP(bill.low_cents!)} to {formatPHP(bill.high_cents!)} across {bill.sample_count} payments.</p>}</li>)}</ul>
            {insights.variable_bills.length === 0 && <p className="text-body-sm">No active variable bills.</p>}
          </details>
          <details className={panel}><summary className="min-h-11 cursor-pointer text-headline-sm font-semibold">Reconciliation evidence</summary>
            <p className="text-body-sm text-on-surface-variant">Matches pending inbox evidence by account, date, direction, and exact amount. A match is a candidate, not proof. No entries are created. Do not debit an account again for a payment already covered by reconciliation.</p>
            {insights.reconciliation.map(item => <div key={item.checkpoint_id} className="space-y-2 border-t border-outline-variant/50 py-3 text-body-sm"><p className="font-semibold">{insights.accounts.find(account => account.id === item.account_id)?.name ?? "Account"} · {item.date}</p><p>Balance adjustment: {formatPHP(item.discrepancy_cents)}.</p>{item.candidates.length ? <ul>{item.candidates.map(candidate => <li key={candidate.id}>{candidate.description}: {formatPHP(candidate.amount_cents)}</li>)}</ul> : <p>No matching dated inbox evidence. Keep the difference unclassified.</p>}</div>)}
            {insights.reconciliation.length === 0 && <p className="text-body-sm">No unexplained differences in the latest checkpoints.</p>}
            <Link href="/inbox" className="inline-flex min-h-11 items-center text-secondary underline">Review inbox evidence</Link>
          </details>
          <p className="text-body-sm text-on-surface-variant">Transaction analysis starts {insights.history_from_date}. {insights.history_truncated ? "The history limit was reached; results are partial." : "Unlogged payments and cash purchases cannot be inferred."}</p>
        </>}
      <details className={panel}><summary className="min-h-11 cursor-pointer text-headline-sm font-semibold">What changed in the forecast?</summary>
        <p className="text-body-sm text-on-surface-variant">Compare today’s forecast with a saved baseline. Saving replaces the previous baseline. Different payday windows can change reserved totals; these differences are not proof of new spending.</p>
        {baselineError && <p role="alert" className="text-body-sm text-error">{baselineError}</p>}
        {baseline?.saved_at ? <p className="text-body-sm">Baseline saved {new Date(baseline.saved_at).toLocaleString("en-PH")}.</p> : <p className="text-body-sm">Save a baseline to start comparing future forecasts.</p>}
        {baseline?.comparison && <><ul className="divide-y divide-outline-variant/50">{baseline.comparison.metrics.map(metric => <li key={metric.field} className="flex flex-wrap justify-between gap-2 py-3 text-body-sm"><span>{metricNames[metric.field]}</span><span className="font-mono tabular-nums">{formatPHP(metric.before_cents)} to {formatPHP(metric.after_cents)}</span></li>)}</ul><p className="text-body-sm">Next payday: {baseline.comparison.previous_payday} to {baseline.comparison.current_payday}. {baseline.comparison.overlapping_days > 0 ? `Changed balances on ${baseline.comparison.changed_days.length} of ${baseline.comparison.overlapping_days} overlapping forecast dates.` : "No forecast dates overlap. Replace the baseline to compare future changes."}</p></>}
        {!!baseline?.comparison?.bill_changes.length && <ul className="divide-y divide-outline-variant/50">{baseline.comparison.bill_changes.map((change, index) => <li key={index} className="space-y-1 py-3 text-body-sm"><p className="font-semibold">{change.name}</p><p>{change.before ? `${change.before.due_date}, ${formatPHP(change.before.amount_cents)}, ${change.before.status}` : "Not in the baseline"} to {change.after ? `${change.after.due_date}, ${formatPHP(change.after.amount_cents)}, ${change.after.status}` : "No longer in the comparison"}.</p></li>)}</ul>}
        <button type="button" disabled={savingBaseline} onClick={() => void saveBaseline()} className={button}>{savingBaseline ? "Saving…" : baseline?.saved_at ? "Replace baseline with today" : "Save today’s baseline"}</button>
      </details>
      <section className={panel} aria-labelledby="purchase-title"><h2 id="purchase-title" className="text-headline-sm font-semibold">Buy now or after payday?</h2>
        <form onSubmit={comparePurchase} className="space-y-3"><label htmlFor="purchase-amount" className="block text-body-sm">Purchase amount (PHP)</label><input id="purchase-amount" inputMode="decimal" required maxLength={20} value={purchaseAmount} onChange={event => { setPurchaseAmount(event.target.value); setPurchase(undefined); }} className="min-h-11 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 text-body-md" /><button disabled={calculating} className={button}>{calculating ? "Calculating…" : "Compare purchase timing"}</button></form>
        {purchaseError && <p role="alert" className="text-body-sm text-error">{purchaseError}</p>}
        {purchase && <><fieldset className="space-y-2"><legend className="text-body-md font-semibold">Recalculated for {formatPHP(purchase.amount_cents)}</legend>{(["now", "after_payday"] as const).map(choice => <label key={choice} className="flex min-h-11 items-start gap-3 text-body-sm"><input type="radio" name="purchase-timing" checked={purchaseChoice === choice} disabled={!purchase[choice]} onChange={() => setPurchaseChoice(choice)} className="mt-1 h-5 w-5 accent-secondary" /><span>{choice === "now" ? "Buy today" : "Buy on the next scheduled payday"}: {purchase[choice] ? `${purchase[choice]!.shortfall_date ? `shortfall on ${purchase[choice]!.shortfall_date}` : "no projected shortfall"}; lowest closing balance ${formatPHP(Math.min(...purchase[choice]!.timeline.map(day => day.balance)))}` : "Payday falls outside this 45-day forecast."}</span></label>)}</fieldset>{selectedPurchase && <ForecastBalanceChart key={purchaseChoice} timeline={selectedPurchase.timeline} />}</>}
        <p className="text-body-sm text-on-surface-variant">Preview only. Recalculates daily balances with existing bills, budgets, spending, and income. Same-day income may arrive after a payment; check the paying account before buying.</p>
      </section>
    </main><BottomNav showNavigation={false} />
  </div>;
}
