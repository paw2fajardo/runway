"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { formatPHP } from "@/lib/currency";

type Cadence = "once" | "weekly" | "biweekly" | "monthly";
interface Budget { id: string; name: string; amountCents: number; startDate: string; cadence: Cadence }
const cadenceLabel: Record<Cadence, string> = { once: "One time", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export default function BudgetsPage() {
  const [items, setItems] = useState<Budget[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [cadence, setCadence] = useState<Cadence>("once");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/planned-budgets");
    if (response.ok) setItems(await response.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createBudget(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSaving(true);
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) { setError("Enter a valid amount."); setSaving(false); return; }
    try {
      const response = await fetch("/api/planned-budgets", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, amount_cents: amountCents, start_date: startDate, cadence }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not save budget.");
      setName(""); setAmount(""); setCadence("once"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save budget."); }
    finally { setSaving(false); }
  }

  async function deactivate(id: string) {
    const response = await fetch("/api/planned-budgets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (response.ok) await load();
  }

  return <div className="flex min-h-screen flex-col"><Header title="Budget plans" /><main className="app-bottom-clearance mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-margin pt-20 pb-space-xl">
    <div><h1 className="text-headline-lg font-semibold">Budget plans</h1><p className="mt-1 text-body-md text-on-surface-variant">See how planned spending changes your cash runway. These are forecast assumptions, not recorded expenses.</p></div>
    <form onSubmit={createBudget} className="forest-panel flex flex-col gap-4 rounded-2xl p-5 text-white">
      <h2 className="text-title-md font-semibold">Add a budget</h2>
      <label className="flex flex-col gap-1 text-body-sm" htmlFor="budget-name">Name<input required id="budget-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Groceries or Trip" className="min-h-11 rounded-xl border border-outline-variant/60 bg-white px-3 text-on-surface" /></label>
      <label className="flex flex-col gap-1 text-body-sm" htmlFor="budget-amount">Amount (₱)<input required id="budget-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="min-h-11 rounded-xl border border-outline-variant/60 bg-white px-3 text-on-surface" /></label>
      <label className="flex flex-col gap-1 text-body-sm" htmlFor="budget-date">Start date<input required id="budget-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="min-h-11 rounded-xl border border-outline-variant/60 bg-white px-3 text-on-surface" /></label>
      <label className="flex flex-col gap-1 text-body-sm" htmlFor="budget-cadence">Cadence<select id="budget-cadence" value={cadence} onChange={e => setCadence(e.target.value as Cadence)} className="min-h-11 rounded-xl border border-outline-variant/60 bg-white px-3 text-on-surface">{Object.entries(cadenceLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error && <p role="alert" className="text-body-sm text-rose-200">{error}</p>}
      <button disabled={saving} className="min-h-11 rounded-full bg-secondary-fixed px-4 font-semibold text-primary disabled:opacity-50">{saving ? "Saving…" : "Add to forecast"}</button>
    </form>
    <section className="space-y-3" aria-label="Active budget plans"><h2 className="text-title-md font-semibold">Active plans</h2>{items.length ? items.map(item => <article key={item.id} className="flex items-center justify-between gap-3 border-b border-outline-variant/50 py-3"><div><h3 className="font-semibold">{item.name}</h3><p className="text-body-sm text-on-surface-variant">{formatPHP(item.amountCents)} · {cadenceLabel[item.cadence]} · from {item.startDate}</p></div><button type="button" onClick={() => void deactivate(item.id)} className="min-h-11 rounded-full px-3 text-label-md font-semibold text-error">Remove</button></article>) : <p className="text-body-md text-on-surface-variant">No budget plans yet.</p>}</section>
  </main><BottomNav /></div>;
}
