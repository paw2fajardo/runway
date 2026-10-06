"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatPHP } from "@/lib/currency";

const PAGE_SIZE = 50;
type TransactionType = "income" | "expense" | "transfer";
type Leg = {
  leg: { id: string; accountId: string | null; categoryId: string | null; amount: number };
  account: { id: string; name: string } | null;
  category: { id: string; name: string; isSystemFee: boolean } | null;
};
type Transaction = { id: string; type: TransactionType; description: string; transactedAt: string; legs: Leg[] };
type Account = { id: string; name: string; type: string; currentBalance: number };
type Category = { id: string; name: string; isIncome: boolean; isArchived: boolean; isSystemFee: boolean };
type Totals = { inflow: number; outflow: number; net: number };
type TransactionResponse = {
  transactions: Transaction[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  totals: Totals;
};

const zeroTotals: Totals = { inflow: 0, outflow: 0, net: 0 };

function transactionInfo(transaction: Transaction) {
  const accountLegs = transaction.legs.filter((item) => item.leg.accountId);
  const accounts = accountLegs.map((item) => item.account?.name).filter((name): name is string => Boolean(name));
  const source = accountLegs.find((item) => item.leg.amount < 0)?.account?.name;
  const destination = accountLegs.find((item) => item.leg.amount > 0)?.account?.name;
  const category = transaction.legs.find((item) => item.leg.categoryId && !item.category?.isSystemFee)?.category?.name;
  const fee = transaction.legs.find((item) => item.category?.isSystemFee)?.leg.amount ?? 0;
  const amounts = accountLegs.map((item) => item.leg.amount);
  const amount = transaction.type === "income"
    ? Math.max(0, ...amounts)
    : Math.max(0, ...amounts.filter((value) => value < 0).map(Math.abs));
  const accountLabel = transaction.type === "transfer"
    ? `${source ?? "Unknown account"} → ${destination ?? "Unknown account"}`
    : accounts.join(", ") || "Account unavailable";
  return { accountLabel, category: category ?? "Uncategorized", amount, fee: Math.abs(fee) };
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayHeading(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function typeLabel(type: TransactionType) {
  return type === "income" ? "Inflow" : type === "expense" ? "Expense" : "Transfer";
}

function typeColor(type: TransactionType) {
  return type === "income" ? "text-secondary" : type === "expense" ? "text-error" : "text-on-surface-variant";
}

function amountLabel(transaction: Transaction, amount: number) {
  const sign = transaction.type === "expense" ? "−" : transaction.type === "income" ? "+" : "";
  return `${sign}${formatPHP(amount)}`;
}

function localStartIso(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : "";
}

function localEndExclusiveIso(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totals, setTotals] = useState<Totals>(zeroTotals);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      setSearch((current) => current === nextSearch ? current : nextSearch);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsError("");
    Promise.all([
      fetch("/api/accounts", { signal: controller.signal }),
      fetch("/api/categories", { signal: controller.signal }),
    ]).then(async ([accountResponse, categoryResponse]) => {
      if (!accountResponse.ok || !categoryResponse.ok) throw new Error("Some filter options are unavailable.");
      const [accountData, categoryData] = await Promise.all([accountResponse.json(), categoryResponse.json()]);
      if (controller.signal.aborted) return;
      setAccounts(accountData as Account[]);
      setCategories(categoryData as Category[]);
    }).catch((cause) => {
      if (!controller.signal.aborted) setOptionsError(cause instanceof Error ? cause.message : "Filter options are unavailable.");
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);
    if (invalidDateRange) {
      setError("The start date must be on or before the end date.");
      setRefreshing(false);
      setLoading(false);
      return () => controller.abort();
    }

    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (type) params.set("type", type);
    if (accountId) params.set("account", accountId);
    if (categoryId) params.set("category", categoryId);
    if (fromDate) params.set("from", localStartIso(fromDate));
    if (toDate) params.set("to", localEndExclusiveIso(toDate));

    setRefreshing(true);
    setError("");
    fetch(`/api/transactions?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Activity is unavailable. Try again.");
        return data as TransactionResponse;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (page > data.totalPages) {
          setPage(data.totalPages);
          return;
        }
        setTransactions(data.transactions);
        setTotalCount(data.totalCount);
        setPageCount(data.totalPages);
        setTotals(data.totals);
        setExpandedId(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Activity is unavailable. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [accountId, categoryId, fromDate, page, reloadKey, search, toDate, type]);

  const hasFilters = Boolean(search || type || accountId || categoryId || fromDate || toDate);
  const filterCount = [type, accountId, categoryId, fromDate || toDate].filter(Boolean).length;
  const visibleStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const visibleEnd = Math.min(page * PAGE_SIZE, totalCount);
  const canClear = hasFilters || Boolean(searchInput);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setType("");
    setAccountId("");
    setCategoryId("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const updateFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const remove = async () => {
    if (!deleteTarget || isDeleting) return;
    setDeleteError("");
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/transactions/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to delete this entry. Try again.");
      }
      setDeleteTarget(null);
      if (transactions.length === 1 && page > 1) setPage((current) => current - 1);
      else reload();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Unable to delete this entry. Try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const openDelete = (transaction: Transaction) => {
    setDeleteError("");
    setDeleteTarget(transaction);
  };

  const mobileRow = (item: Transaction) => {
    const info = transactionInfo(item);
    const expanded = expandedId === item.id;
    const detailId = `transaction-mobile-detail-${item.id}`;
    return <li key={item.id} className="border-b border-outline-variant/50 last:border-b-0">
      <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpandedId(expanded ? null : item.id)} className="flex min-h-[68px] w-full items-center justify-between gap-3 py-3 text-left focus-visible:rounded-lg">
        <span className="min-w-0">
          <span className="block truncate font-body-md text-body-md font-semibold text-on-surface">{item.description}</span>
          <span className="mt-1 block truncate text-body-sm text-on-surface-variant">{formatDate(item.transactedAt)} · {typeLabel(item.type)} · {info.accountLabel}</span>
        </span>
        <span className={`shrink-0 whitespace-nowrap text-body-md font-semibold tabular-nums ${typeColor(item.type)}`}>{amountLabel(item, info.amount)}</span>
      </button>
      {expanded && <div id={detailId} className="pb-4 pl-1 pr-1">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-outline-variant/40 py-3 text-body-sm">
          <div><dt className="text-on-surface-variant">Category</dt><dd className="mt-0.5 font-medium text-on-surface">{info.category}</dd></div>
          <div><dt className="text-on-surface-variant">Time</dt><dd className="mt-0.5 font-medium text-on-surface">{formatTime(item.transactedAt)}</dd></div>
          {info.fee > 0 && <div><dt className="text-on-surface-variant">Fee included</dt><dd className="mt-0.5 font-medium text-on-surface">{formatPHP(info.fee)}</dd></div>}
        </dl>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(item)} className="min-h-10 rounded-full px-4 text-label-md font-semibold text-primary hover:bg-primary/5">Edit</button>
          <button type="button" onClick={() => openDelete(item)} className="min-h-10 rounded-full px-4 text-label-md font-semibold text-error hover:bg-error/5">Delete</button>
        </div>
      </div>}
    </li>;
  };

  let previousDesktopDay = "";
  let previousMobileDay = "";

  return <main className="app-bottom-clearance min-h-screen bg-surface pt-20">
    <Header title="Transactions" />
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-sm font-semibold text-on-surface">Transactions</h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">Search and review your logged activity.</p>
        </div>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-label-md font-semibold text-white">Quick log</Link>
      </div>

      <section aria-label="Transaction totals" className="mb-5 border-y border-outline-variant/50 py-3">
        <p className="mb-2 text-label-sm font-semibold text-on-surface-variant">Filtered totals <span className="font-normal">· transfers excluded from net</span></p>
        <dl className="grid grid-cols-3 divide-x divide-outline-variant/50">
          <div className="pr-3"><dt className="text-label-sm text-on-surface-variant">Inflow</dt><dd className="mt-0.5 truncate text-body-md font-semibold tabular-nums text-secondary">{formatPHP(totals.inflow)}</dd></div>
          <div className="px-3"><dt className="text-label-sm text-on-surface-variant">Outflow</dt><dd className="mt-0.5 truncate text-body-md font-semibold tabular-nums text-error">{formatPHP(totals.outflow)}</dd></div>
          <div className="pl-3"><dt className="text-label-sm text-on-surface-variant">Net</dt><dd className="mt-0.5 truncate text-body-md font-semibold tabular-nums text-on-surface">{formatPHP(totals.net)}</dd></div>
        </dl>
      </section>

      <section aria-label="Find transactions" className="mb-4 space-y-3">
        <label className="relative block">
          <span className="sr-only">Search descriptions, accounts, or categories</span>
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search activity, account, or category" className="min-h-11 w-full rounded-xl border border-outline-variant/70 bg-white pl-10 pr-10 text-body-md text-on-surface placeholder:text-on-surface-variant/80 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          {searchInput && <button type="button" aria-label="Clear search" onClick={() => setSearchInput("")} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"><X size={16} aria-hidden="true" /></button>}
        </label>

        <details className="group rounded-xl border border-outline-variant/60 bg-surface-container-low">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-body-sm font-semibold text-on-surface marker:hidden [&::-webkit-details-marker]:hidden">
            <span>Filters{filterCount > 0 ? <span className="ml-2 rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-secondary">{filterCount}</span> : null}</span>
            <ChevronDown size={18} aria-hidden="true" className="text-on-surface-variant transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-2 gap-3 border-t border-outline-variant/50 p-3 md:grid-cols-5">
            <label className="flex flex-col gap-1 text-label-sm font-medium text-on-surface-variant">From
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => updateFilter(setFromDate)(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-outline-variant/70 bg-white px-2 text-body-sm text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </label>
            <label className="flex flex-col gap-1 text-label-sm font-medium text-on-surface-variant">To
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => updateFilter(setToDate)(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-outline-variant/70 bg-white px-2 text-body-sm text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </label>
            <label className="flex flex-col gap-1 text-label-sm font-medium text-on-surface-variant">Type
              <select value={type} onChange={(event) => updateFilter(setType)(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-outline-variant/70 bg-white px-2 text-body-sm text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="">All types</option><option value="expense">Expenses</option><option value="income">Inflows</option><option value="transfer">Transfers</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-sm font-medium text-on-surface-variant">Account
              <select value={accountId} onChange={(event) => updateFilter(setAccountId)(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-outline-variant/70 bg-white px-2 text-body-sm text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-sm font-medium text-on-surface-variant">Category
              <select value={categoryId} onChange={(event) => updateFilter(setCategoryId)(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-outline-variant/70 bg-white px-2 text-body-sm text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isArchived ? " (archived)" : ""}</option>)}
              </select>
            </label>
            {canClear && <button type="button" onClick={clearFilters} className="col-span-2 min-h-10 justify-self-start px-1 text-label-sm font-semibold text-secondary hover:underline md:col-span-5">Clear search and filters</button>}
          </div>
        </details>
        {optionsError && <p className="text-body-sm text-error" role="status">{optionsError} Account and category filters may be incomplete.</p>}
      </section>

      <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2 text-body-sm text-on-surface-variant" aria-live="polite">
        <p>{loading ? "Loading transactions…" : `Showing ${visibleStart}–${visibleEnd} of ${totalCount}`}</p>
        {refreshing && !loading && <p>Updating results…</p>}
      </div>
      {error && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"><span>{error}</span><button type="button" onClick={reload} className="min-h-9 px-2 font-semibold underline underline-offset-2">Retry</button></div>}

      <div aria-busy={refreshing} className="min-w-0">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[800px] border-collapse text-left text-body-sm">
            <thead className="sticky top-0 z-10 bg-surface-container-low text-label-sm font-semibold text-on-surface-variant">
              <tr className="border-y border-outline-variant/60"><th scope="col" className="px-3 py-3">Date</th><th scope="col" className="px-3 py-3">Activity</th><th scope="col" className="px-3 py-3">Type</th><th scope="col" className="px-3 py-3">Account</th><th scope="col" className="px-3 py-3">Category</th><th scope="col" className="px-3 py-3 text-right">Amount</th></tr>
            </thead>
            <tbody>
              {loading ? [0, 1, 2, 3, 4, 5].map((row) => <tr key={row} className="border-b border-outline-variant/40"><td className="px-3 py-4"><Skeleton className="h-4 w-24" /></td><td className="px-3 py-4"><Skeleton className="h-4 w-40" /></td><td className="px-3 py-4"><Skeleton className="h-4 w-16" /></td><td className="px-3 py-4"><Skeleton className="h-4 w-24" /></td><td className="px-3 py-4"><Skeleton className="h-4 w-20" /></td><td className="px-3 py-4"><Skeleton className="ml-auto h-4 w-24" /></td></tr>) : transactions.map((item) => {
                const info = transactionInfo(item);
                const expanded = expandedId === item.id;
                const currentDay = localDateKey(item.transactedAt);
                const showDay = previousDesktopDay !== currentDay;
                previousDesktopDay = currentDay;
                return (
                <Fragment key={item.id}>
                  {showDay ? <tr><th scope="colgroup" colSpan={6} className="border-b border-outline-variant/40 bg-surface-container-low/70 px-3 py-2 text-left text-label-sm font-semibold text-on-surface-variant">{dayHeading(item.transactedAt)}</th></tr> : null}
                  <tr key={item.id} className="border-b border-outline-variant/40 hover:bg-surface-container-low/50">
                    <td className="whitespace-nowrap px-3 py-3 text-on-surface-variant"><span className="block text-on-surface">{formatDate(item.transactedAt)}</span><span className="mt-0.5 block text-label-sm">{formatTime(item.transactedAt)}</span></td>
                    <td className="max-w-[250px] px-3 py-3"><button type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : item.id)} className="max-w-full truncate text-left font-semibold text-on-surface underline-offset-2 hover:underline focus-visible:rounded-sm">{item.description}</button></td>
                    <td className={`whitespace-nowrap px-3 py-3 font-medium ${typeColor(item.type)}`}>{typeLabel(item.type)}</td>
                    <td className="max-w-[190px] truncate px-3 py-3 text-on-surface">{info.accountLabel}</td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-on-surface-variant">{info.category}</td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${typeColor(item.type)}`}>{amountLabel(item, info.amount)}</td>
                  </tr>
                  {expanded ? <tr className="border-b border-outline-variant/40 bg-surface-container-low/50"><td colSpan={6} className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm"><span><span className="text-on-surface-variant">Category: </span>{info.category}</span>{info.fee > 0 && <span><span className="text-on-surface-variant">Fee included: </span>{formatPHP(info.fee)}</span>}<span><span className="text-on-surface-variant">Recorded: </span>{new Date(item.transactedAt).toLocaleString()}</span></div><div className="flex gap-1"><button type="button" onClick={() => setEditing(item)} className="min-h-9 rounded-full px-3 text-label-sm font-semibold text-primary hover:bg-primary/5">Edit</button><button type="button" onClick={() => openDelete(item)} className="min-h-9 rounded-full px-3 text-label-sm font-semibold text-error hover:bg-error/5">Delete</button></div></div></td></tr> : null}
                </Fragment>
                );
              })}
              {!loading && transactions.length === 0 && <tr><td colSpan={6} className="py-12 text-center">
                <p className="font-semibold text-on-surface">{hasFilters ? "No matching transactions" : "No logged activity yet"}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{hasFilters ? "Try widening the date range or clearing a filter." : "Entries you add with Quick Log will appear here."}</p>
                {hasFilters ? <button type="button" onClick={clearFilters} className="mt-3 min-h-10 px-3 text-label-sm font-semibold text-secondary">Clear filters</button> : <Link href="/" className="mt-3 inline-flex min-h-10 items-center px-3 text-label-sm font-semibold text-secondary">Open Quick Log</Link>}
              </td></tr>}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {loading ? <ul aria-label="Loading transactions" className="divide-y divide-outline-variant/40">{[0, 1, 2, 3, 4].map((row) => <li key={row} className="flex min-h-[68px] items-center justify-between gap-3 py-3"><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-52" /></div><Skeleton className="h-4 w-20" /></li>)}</ul> : transactions.length > 0 ? <ul className="border-y border-outline-variant/50">
            {transactions.map((item) => {
              const currentDay = localDateKey(item.transactedAt);
              const showDay = previousMobileDay !== currentDay;
              previousMobileDay = currentDay;
              return <Fragment key={item.id}>{showDay && <li className="border-b border-outline-variant/30 bg-surface-container-low/60 py-2 text-label-sm font-semibold text-on-surface-variant">{dayHeading(item.transactedAt)}</li>}{mobileRow(item)}</Fragment>;
            })}
          </ul> : <div className="border-y border-outline-variant/50 py-12 text-center">
            <p className="font-semibold text-on-surface">{hasFilters ? "No matching transactions" : "No logged activity yet"}</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{hasFilters ? "Try widening the date range or clearing a filter." : "Entries you add with Quick Log will appear here."}</p>
            {hasFilters ? <button type="button" onClick={clearFilters} className="mt-3 min-h-10 px-3 text-label-sm font-semibold text-secondary">Clear filters</button> : <Link href="/" className="mt-3 inline-flex min-h-10 items-center px-3 text-label-sm font-semibold text-secondary">Open Quick Log</Link>}
          </div>}
        </div>
      </div>

      {totalCount > 0 && <nav aria-label="Transaction pages" className="mt-4 flex items-center justify-between border-t border-outline-variant/50 pt-3">
        <p className="text-body-sm text-on-surface-variant">Page {page} of {pageCount}</p>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1 || refreshing} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-outline-variant/60 px-3 text-label-sm font-semibold text-on-surface disabled:cursor-not-allowed disabled:opacity-45"><ChevronLeft size={16} aria-hidden="true" />Previous</button>
          <button type="button" disabled={page >= pageCount || refreshing} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-outline-variant/60 px-3 text-label-sm font-semibold text-on-surface disabled:cursor-not-allowed disabled:opacity-45">Next<ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </nav>}
    </div>

    <BottomNav onOpenQuickLog={() => { window.location.assign("/"); }} />
    {editing && <RapidExpenseDrawer isOpen onClose={() => setEditing(null)} onSuccess={reload} accounts={accounts} editTransaction={editing} onEditSuccess={reload} />}
    <Dialog open={deleteTarget !== null} onClose={() => { if (!isDeleting) { setDeleteTarget(null); setDeleteError(""); } }} title="Delete this entry?">
      {deleteTarget && <div>
        <p className="text-body-sm text-on-surface-variant">“{deleteTarget.description}” will be removed and its account balances reversed.</p>
        {deleteError && <p role="alert" className="mt-3 text-body-sm text-error">{deleteError}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={isDeleting} onClick={() => { setDeleteTarget(null); setDeleteError(""); }} className="min-h-11 rounded-full px-4 text-label-md disabled:opacity-50">Cancel</button><button type="button" disabled={isDeleting} onClick={() => void remove()} className="min-h-11 rounded-full bg-error px-4 text-label-md text-white disabled:opacity-50">{isDeleting ? "Deleting…" : "Delete entry"}</button></div>
      </div>}
    </Dialog>
  </main>;
}
