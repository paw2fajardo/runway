"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import type { ParsedInboxItem } from "@/lib/types";

interface ReviewItem { id: string; createdAt: string; parsedJson: ParsedInboxItem }
interface Account { id: string; name: string; type: string }
interface Category { id: string; name: string; isArchived: boolean; isIncome: boolean; isSystemFee: boolean }
interface Bill { instanceId: string; name: string; amountDue: number; dueDate: string; status: string; isAutoPay: boolean; autoPostFrom: string | null }
const cents = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value)
  ? Number(value.split(".")[0]) * 100 + Number((value.split(".")[1] ?? "").padEnd(2, "0")) : NaN;

export function InboxReview({ item, onClose, onSaved }: { item: ReviewItem | null; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("0.00");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [possibleDuplicate, setPossibleDuplicate] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billId, setBillId] = useState("");

  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    setLoading(true); setError(null); setPossibleDuplicate(false); setConfirmDuplicate(false); setBillId("");
    setAccounts([]); setCategories([]); setBills([]); setSource(""); setDestination(""); setCategory("");
    setAmount((item.parsedJson.amount_cents / 100).toFixed(2));
    setFee((item.parsedJson.fee_cents / 100).toFixed(2));
    setDescription(item.parsedJson.merchant);
    const parsedDate = new Date(item.parsedJson.transacted_at ?? item.createdAt);
    setDate(Number.isFinite(parsedDate.getTime()) ? new Date(parsedDate.getTime() - parsedDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
    void Promise.all([fetch("/api/accounts", { signal: controller.signal }), fetch("/api/categories", { signal: controller.signal }), fetch("/api/bills", { signal: controller.signal })])
      .then(async responses => {
        if (responses.some(response => !response.ok)) throw new Error("Accounts or categories unavailable. Close and retry.");
        const [accountRows, categoryRows, billRows] = await Promise.all(responses.map(response => response.json())) as [Account[], Category[], Bill[]];
        if (controller.signal.aborted) return;
        const eligible = accountRows.filter(account => ["liquid", "revolving_credit"].includes(account.type));
        const usableCategories = categoryRows.filter(value => !value.isArchived && !value.isSystemFee && value.isIncome === (item.parsedJson.type === "income"));
        setAccounts(eligible); setCategories(usableCategories);
        setBills(billRows.filter(bill => !["paid", "auto_debited", "skipped"].includes(bill.status) && (!bill.isAutoPay || !bill.autoPostFrom)));
        const match = (hint?: string) => eligible.find(account => account.name.toLocaleLowerCase() === hint?.toLocaleLowerCase())?.id ?? "";
        setSource(match(item.parsedJson.source_account_hint));
        setDestination(match(item.parsedJson.destination_account_hint ?? (item.parsedJson.type === "income" ? item.parsedJson.source_account_hint : undefined)));
        setCategory(usableCategories.find(value => value.name.toLocaleLowerCase() === item.parsedJson.category_hint?.toLocaleLowerCase())?.id ?? "");
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Review unavailable. Close and retry."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [item]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!item || saving) return;
    const amountCents = cents(amount); const feeCents = cents(fee);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(feeCents) || feeCents < 0 || !date) {
      setError("Enter a positive amount, a non-negative fee, and the payment date."); return;
    }
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/inbox/${item.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: description, amount_cents: amountCents, fee_cents: feeCents,
          source_account_id: item.parsedJson.type !== "income" ? source : undefined,
          destination_account_id: item.parsedJson.type !== "expense" ? destination : undefined,
          category_id: category || null, transacted_at: new Date(date).toISOString(), confirm_duplicate: confirmDuplicate,
          bill_instance_id: billId || undefined }) });
      const data = await response.json();
      if (!response.ok) { setPossibleDuplicate(data.code === "POSSIBLE_DUPLICATE"); throw new Error(data.error || "Entry could not be saved."); }
      onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Entry could not be saved. Retry."); }
    finally { setSaving(false); }
  }

  const fieldClass = "min-h-11 w-full min-w-0 rounded-xl border border-outline-variant bg-surface-container-low px-3 text-body-md text-on-surface focus-visible:outline-offset-2";
  return <Dialog open={!!item} onClose={() => { if (!saving) onClose(); }} title="Review payment">
    <form onSubmit={save} className="space-y-space-md">
      <p className="text-body-sm text-on-surface-variant">Entry type: {item?.parsedJson.type}. Confirm this payment happened. A bill notice is not proof of payment. Unknown categories can stay unclassified.</p>
      {loading && <p role="status">Loading accounts and categories…</p>}
      <label className="block space-y-1" htmlFor={`${id}-description`}>Description<input id={`${id}-description`} required maxLength={120} value={description} onChange={event => setDescription(event.target.value)} className={fieldClass} /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1" htmlFor={`${id}-amount`}>Amount (PHP)<input id={`${id}-amount`} required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className={fieldClass} /></label>
        <label className="space-y-1" htmlFor={`${id}-fee`}>Additional fee (PHP)<input id={`${id}-fee`} required inputMode="decimal" value={fee} onChange={event => setFee(event.target.value)} className={fieldClass} /></label>
      </div>
      {item?.parsedJson.type !== "income" && <div className="space-y-1"><label htmlFor={`${id}-source`}>Paid from</label><select id={`${id}-source`} required value={source} onChange={event => setSource(event.target.value)} className={fieldClass}><option value="">Choose an account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>}
      {item?.parsedJson.type !== "expense" && <div className="space-y-1"><label htmlFor={`${id}-destination`}>Received into</label><select id={`${id}-destination`} required value={destination} onChange={event => setDestination(event.target.value)} className={fieldClass}><option value="">Choose an account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>}
      {item?.parsedJson.type !== "transfer" && <div className="space-y-1"><label htmlFor={`${id}-category`}>Category</label><select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)} className={fieldClass}><option value="">Unclassified</option>{categories.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></div>}
      {item?.parsedJson.type === "expense" && <div className="space-y-1"><label htmlFor={`${id}-bill`}>Pays an existing bill (optional)</label><select id={`${id}-bill`} value={billId} onChange={event => setBillId(event.target.value)} className={fieldClass}><option value="">No bill link</option>{bills.map(bill => <option key={bill.instanceId} value={bill.instanceId}>{bill.name} · due {bill.dueDate}</option>)}</select></div>}
      {billId && <p className="text-body-sm text-on-surface-variant">This uses the bill’s category, marks this occurrence paid, and keeps future recurrence. A separate fee must be logged separately.</p>}
      <label className="block space-y-1" htmlFor={`${id}-date`}>Payment date and time<input id={`${id}-date`} type="datetime-local" required value={date} onChange={event => setDate(event.target.value)} className={fieldClass} /></label>
      {!item?.parsedJson.transacted_at && <p className="text-body-sm text-on-surface-variant">No payment time was supplied. The starting value is the capture time; correct it if the payment happened earlier.</p>}
      {possibleDuplicate && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={confirmDuplicate} onChange={event => setConfirmDuplicate(event.target.checked)} className="h-5 w-5 accent-secondary" />I checked History; this is a separate payment.</label>}
      {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
      <button type="submit" disabled={loading || saving} className="min-h-11 w-full rounded-full bg-primary px-5 text-on-primary disabled:opacity-50">{saving ? "Saving…" : "Confirm and log payment"}</button>
    </form>
  </Dialog>;
}
