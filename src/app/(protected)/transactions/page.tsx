"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { formatPHP } from "@/lib/currency";

type Leg = { leg: { accountId: string | null; categoryId: string | null; amount: number }; account: { id: string; name: string } | null; category: { id: string; name: string; isSystemFee: boolean } | null };
type Transaction = { id: string; type: "income" | "expense" | "transfer"; description: string; transactedAt: string; legs: Leg[] };
type Account = { id: string; name: string; type: string; currentBalance: number };

function details(transaction: Transaction) {
  const accounts = transaction.legs.filter((item) => item.leg.accountId).map((item) => item.account?.name).filter(Boolean);
  const category = transaction.legs.find((item) => item.leg.categoryId && !item.category?.isSystemFee)?.category?.name;
  const amount = transaction.type === "expense"
    ? -Math.min(...transaction.legs.filter((item) => item.leg.accountId).map((item) => item.leg.amount))
    : transaction.type === "income"
      ? Math.max(...transaction.legs.filter((item) => item.leg.accountId).map((item) => item.leg.amount))
      : -Math.min(...transaction.legs.filter((item) => item.leg.accountId).map((item) => item.leg.amount));
  return { accounts, category, amount };
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [txResponse, accountResponse] = await Promise.all([fetch("/api/transactions"), fetch("/api/accounts")]);
      if (!txResponse.ok || !accountResponse.ok) throw new Error("Activity is unavailable. Try again.");
      const [txData, accountData] = await Promise.all([txResponse.json(), accountResponse.json()]);
      setTransactions(txData.transactions);
      setAccounts(accountData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Activity is unavailable. Try again."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = async () => {
    if (!deleteTarget) return;
    setError("");
    try {
      const response = await fetch(`/api/transactions/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Unable to delete this entry. Try again."); }
      setDeleteTarget(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete this entry. Try again."); }
  };

  return <main className="app-bottom-clearance min-h-screen bg-surface pt-20">
    <Header title="Logged activity" />
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3"><div><h1 className="text-headline-sm font-semibold text-on-surface">Logged activity</h1><p className="mt-1 text-body-sm text-on-surface-variant">Expenses, transfers, and inflows you logged.</p></div><Link href="/" className="rounded-full bg-primary px-4 py-2 text-label-md text-white">Quick log</Link></div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-error-container p-3 text-body-sm text-on-error-container">{error} <button onClick={() => void refresh()} className="underline">Retry</button></p>}
      {loading ? <p className="py-12 text-center text-on-surface-variant">Loading activity…</p> : transactions.length === 0 ? <div className="rounded-2xl bg-surface-container-low p-8 text-center"><p className="font-semibold text-on-surface">No logged activity yet</p><p className="mt-1 text-body-sm text-on-surface-variant">Entries you add with Quick Log will appear here.</p></div> : <ul className="space-y-3">{[...transactions].sort((a, b) => b.transactedAt.localeCompare(a.transactedAt)).map((item) => {
        const info = details(item);
        return <li key={item.id} className="rounded-2xl border border-outline-variant bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-on-surface">{item.description}</p><p className="mt-1 text-body-sm text-on-surface-variant">{new Date(item.transactedAt).toLocaleString()} · {item.type === "income" ? "Inflow" : item.type === "expense" ? "Expense" : "Transfer"}</p><p className="mt-1 text-body-sm text-on-surface-variant">{info.accounts.join(item.type === "transfer" ? " → " : "")}{info.category ? ` · ${info.category}` : ""}</p></div><p className={`shrink-0 font-semibold tabular-nums ${item.type === "expense" ? "text-error" : "text-on-surface"}`}>{item.type === "expense" ? "−" : item.type === "income" ? "+" : ""}{formatPHP(info.amount)}</p></div><div className="mt-3 flex justify-end gap-2"><button onClick={() => setEditing(item)} className="min-h-10 rounded-full px-4 text-label-md text-primary hover:bg-primary/5">Edit</button><button onClick={() => setDeleteTarget(item)} className="min-h-10 rounded-full px-4 text-label-md text-error hover:bg-error/5">Delete</button></div></li>;
      })}</ul>}
    </div>
    <BottomNav onOpenQuickLog={() => { window.location.assign("/"); }} />
    {editing && <RapidExpenseDrawer isOpen onClose={() => setEditing(null)} onSuccess={() => void refresh()} accounts={accounts} editTransaction={editing} onEditSuccess={() => void refresh()} />}
    {deleteTarget && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="presentation"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"><h2 id="delete-title" className="text-lg font-semibold text-on-surface">Delete this entry?</h2><p className="mt-2 text-body-sm text-on-surface-variant">“{deleteTarget.description}” will be removed and its account balances reversed.</p>{error && <p role="alert" className="mt-3 text-body-sm text-error">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button onClick={() => { setDeleteTarget(null); setError(""); }} className="min-h-11 rounded-full px-4 text-label-md">Cancel</button><button onClick={() => void remove()} className="min-h-11 rounded-full bg-error px-4 text-label-md text-white">Delete entry</button></div></section></div>}
  </main>;
}
