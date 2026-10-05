"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PendingPaycheck = {
  id: string;
  kind: "scheduled" | "retry";
  dueDate: string;
  accountName: string | null;
  amountCents: number;
  streamName: string;
};

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function manilaTomorrow() {
  const [year, month, day] = manilaToday().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function displayDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00+08:00`).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
}

export function PendingPaychecks({ focusId, onComplete }: { focusId?: string; onComplete?: () => void }) {
  const [items, setItems] = useState<PendingPaycheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [retryDates, setRetryDates] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const focusedRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/payday/occurrences", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.occurrences)) throw new Error(data.error ?? "Pending paychecks are unavailable.");
      setItems(data.occurrences);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pending paychecks are unavailable.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!loading && focusId && items.some(item => item.id === focusId)) {
      focusedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      focusedRef.current?.focus();
    }
  }, [focusId, items, loading]);

  const submit = async (item: PendingPaycheck, received: boolean) => {
    if (actionId) return;
    setActionId(item.id); setError(null); setSuccess(null);
    try {
      const retryDate = retryDates[item.id] ?? "";
      if (!received && (!retryDate || retryDate < manilaTomorrow())) throw new Error("Choose an expected date after today.");
      const response = await fetch(`/api/payday/occurrences/${item.id}/${received ? "received" : "missed"}`, {
        method: "POST",
        ...(received ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry_date: retryDate }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to update this paycheck.");
      setSuccess(received ? `${item.streamName} marked received.` : `Paycheck reversed. Retry scheduled for ${displayDate(retryDate)}.`);
      await refresh();
      onComplete?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update this paycheck."); }
    finally { setActionId(null); }
  };

  const visibleItems = focusId ? items.filter(item => item.id === focusId) : items;
  return <section className="glass-panel p-5 space-y-4" aria-labelledby="pending-paychecks-heading">
    <div className="flex items-center justify-between gap-3">
      <h2 id="pending-paychecks-heading" className="text-body-md font-semibold">Paycheck confirmations</h2>
      {!focusId && <span className="text-body-sm text-on-surface-variant">{items.length} pending</span>}
    </div>
    {loading ? <p role="status" className="text-body-sm text-on-surface-variant">Loading pending paychecks…</p>
      : error && !items.length ? <div><p role="alert" className="text-body-sm text-error">{error}</p><button type="button" onClick={() => void refresh()} className="min-h-11 text-secondary">Retry</button></div>
      : focusId && !visibleItems.length ? <p role="status" className="text-body-sm text-on-surface-variant">This paycheck is no longer awaiting confirmation.</p>
      : !visibleItems.length ? <p className="text-body-sm text-on-surface-variant">No paychecks need confirmation.</p>
      : <div className="space-y-3">{visibleItems.map(item => <article key={item.id} ref={focusId === item.id ? focusedRef : undefined} tabIndex={focusId === item.id ? -1 : undefined} className="rounded-2xl bg-white/65 p-4 space-y-3 outline-primary focus:outline">
        <div><p className="font-semibold">{item.streamName}</p><p className="text-body-sm text-on-surface-variant">{item.accountName ?? "Linked account"} · {displayDate(item.dueDate)}</p><p className="text-body-md">₱{(item.amountCents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p></div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={!!actionId} onClick={() => void submit(item, true)} className="min-h-11 rounded-full bg-primary text-white font-semibold disabled:opacity-50">{actionId === item.id ? "Saving…" : "Received"}</button>
          <div className="space-y-2"><label className="block text-body-sm" htmlFor={`retry-${item.id}`}>Expected date</label><input id={`retry-${item.id}`} type="date" min={manilaTomorrow()} value={retryDates[item.id] ?? ""} onChange={e => setRetryDates(old => ({ ...old, [item.id]: e.target.value }))} className="min-h-11 w-full rounded-xl border border-outline-variant bg-white px-2" /><button type="button" disabled={!!actionId} onClick={() => void submit(item, false)} className="min-h-11 w-full rounded-full bg-surface-container-low text-secondary font-semibold disabled:opacity-50">Not received</button></div>
        </div>
      </article>)}</div>}
    {error && items.length > 0 && <p role="alert" className="text-body-sm text-error">{error}</p>}
    {success && <p role="status" className="text-body-sm text-secondary">{success}</p>}
  </section>;
}
