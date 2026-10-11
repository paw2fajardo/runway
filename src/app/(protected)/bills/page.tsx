"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { formatPHP } from "@/lib/currency";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import Link from "next/link";
import { ArrowRight, CalendarDays, Check, ChevronDown, CirclePlus, CreditCard, Headphones, Repeat2, Search, Wallet, Wifi, X, Zap, Droplets, TriangleAlert } from "lucide-react";

interface BillItem {
  instanceId: string;
  billId: string;
  name: string;
  type: string;
  amount: number;
  amountDue: number;
  dueDate: string;
  status: string;
  isEstimate: boolean;
  isAutoPay: boolean;
  autoPostFrom?: string | null;
  isVariableAmount: boolean;
  hasCorrection?: boolean;
  dueDayOfMonth: number;
  dueDayOfWeek?: number | null;
  gracePeriodDays: number;
  frequency: "weekly" | "biweekly" | "monthly" | "every_2_months" | "every_3_months" | "every_6_months" | "annually";
  occurrenceLimit: number | null;
  sourceAccountId?: string | null;
  sourceAccountName?: string | null;
  sourceAccountBalance?: number | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

const billFrequencyLabels: Record<BillItem["frequency"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  every_2_months: "Every 2 months",
  every_3_months: "Every 3 months",
  every_6_months: "Every 6 months",
  annually: "Every year",
};

export default function BillsPage() {
  const [bills, setBills] = useState<BillItem[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<Array<{ id: string; name: string; type: string; currentBalance: number }>>([]);
  const [isBillsLoading, setIsBillsLoading] = useState(true);
  const [billsAvailable, setBillsAvailable] = useState(false);
  const [billsError, setBillsError] = useState<string | null>(null);
  const [nextPaydayDate, setNextPaydayDate] = useState<string | null>(null);
  const [isForecastLoading, setIsForecastLoading] = useState(true);
  const [tab, setTab] = useState<"due" | "all">("due");
  const [billSearch, setBillSearch] = useState("");
  const [isQuickLogOpen, setIsQuickLogOpen] = useState<boolean>(false);
  const [isAddBillOpen, setIsAddBillOpen] = useState<boolean>(false);
  const [detailBill, setDetailBill] = useState<BillItem | null>(null);
  const [editingBill, setEditingBill] = useState<BillItem | null>(null);
  const [billFormError, setBillFormError] = useState<string | null>(null);
  const [isBillSaving, setIsBillSaving] = useState(false);
  const [billActionError, setBillActionError] = useState<string | null>(null);
  const [paymentBill, setPaymentBill] = useState<BillItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSourceAccountId, setPaymentSourceAccountId] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaymentSaving, setIsPaymentSaving] = useState(false);
  const [adjustingBill, setAdjustingBill] = useState<BillItem | null>(null);
  const [adjustedAmount, setAdjustedAmount] = useState("");
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);

  // Form states for adding new bill
  const [newBillName, setNewBillName] = useState("");
  const [newBillAmount, setNewBillAmount] = useState("");
  const [newBillDay, setNewBillDay] = useState("15");
  const [newBillDayOfWeek, setNewBillDayOfWeek] = useState("1");
  const [newBillFrequency, setNewBillFrequency] = useState("monthly");
  const [newBillOccurrenceLimit, setNewBillOccurrenceLimit] = useState("");
  const [newBillGrace, setNewBillGrace] = useState("3");
  const [newBillAutoPay, setNewBillAutoPay] = useState(false);
  const [newBillSourceAccountId, setNewBillSourceAccountId] = useState("");
  const [firstOccurrencePaid, setFirstOccurrencePaid] = useState<boolean | null>(null);
  const [existingPaymentId, setExistingPaymentId] = useState("");
  const [recentExpenses, setRecentExpenses] = useState<Array<{ id: string; description: string; transactedAt: string; source: string; legs: Array<{ leg: { accountId: string | null; amount: number } }> }>>([]);
  const [newBillVariableAmount, setNewBillVariableAmount] = useState(false);
  const [newBillType, setNewBillType] = useState<
    "fixed_subscription" | "variable_utility" | "credit_card_statement" | "loan_installment"
  >("variable_utility");

  const fetchBills = useCallback(async () => {
    try {
      await fetch("/api/bills/auto-post", { method: "POST" });
      const res = await fetch("/api/bills");
      if (!res.ok) throw new Error("Unable to load bills.");
      const data = await res.json();
      setBills(data);
      setBillsAvailable(true);
      setBillsError(null);
    } catch (err) {
      console.error("Failed to load bills:", err);
      setBillsAvailable(false);
      setBillsError("Your bills could not be loaded. Please retry.");
    } finally {
      setIsBillsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  useEffect(() => {
    fetch("/api/accounts").then(async (response) => {
      if (!response.ok) throw new Error("Accounts unavailable");
      return response.json();
    }).then((items: Array<{ id: string; name: string; type: string; currentBalance: number }>) => {
      setPaymentAccounts(items.filter((account) => account.type === "liquid" || account.type === "revolving_credit"));
    }).catch(() => setPaymentAccounts([]));
  }, []);

  useEffect(() => {
    if (!isAddBillOpen) return;
    fetch("/api/transactions?type=expense").then(async (response) => response.ok ? response.json() : null)
      .then((data) => setRecentExpenses(data?.transactions ?? []))
      .catch(() => setRecentExpenses([]));
  }, [isAddBillOpen]);

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/runway/forecast")
      .then(async (res) => {
        if (!res.ok) throw new Error("Forecast unavailable");
        return res.json();
      })
      .then((data: { next_payday_date?: string }) => {
        if (!isCurrent) return;
        const date = data.next_payday_date?.slice(0, 10);
        setNextPaydayDate(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null);
      })
      .catch(() => {
        if (isCurrent) setNextPaydayDate(null);
      })
      .finally(() => {
        if (isCurrent) setIsForecastLoading(false);
      });
    return () => { isCurrent = false; };
  }, []);

  const settleBill = async (bill: BillItem, amount?: number, sourceAccountId?: string) => {
    setPaymentError(null);
    setIsPaymentSaving(true);
    try {
      const res = await fetch(`/api/bills/${bill.instanceId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(amount !== undefined && { amount }),
          ...(sourceAccountId && { source_account_id: sourceAccountId }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Unable to record this payment.");
      }
      setPaymentBill(null);
      await fetchBills();
    } catch (err) {
      console.error("Failed to pay bill:", err);
      setPaymentError(err instanceof Error ? err.message : "Unable to record this payment.");
    } finally {
      setIsPaymentSaving(false);
    }
  };

  const handlePayBill = (bill: BillItem) => {
    setPaymentBill(bill);
    setPaymentAmount((bill.amountDue / 100).toFixed(2));
    setPaymentSourceAccountId(bill.sourceAccountId ?? "");
    setPaymentError(null);
  };

  const confirmVariablePayment = () => {
    if (!paymentBill || isPaymentSaving) return;
    const amount = Math.round(Number(paymentAmount) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setPaymentError("Enter a payment amount greater than zero.");
      return;
    }
    if (!paymentSourceAccountId) {
      setPaymentError("Choose the account that paid this bill.");
      return;
    }
    void settleBill(paymentBill, paymentBill.isVariableAmount ? amount : undefined, paymentSourceAccountId);
  };

  const adjustAutoPay = async (bill: BillItem, kind: "correct" | "undo", amount?: number) => {
    setAdjustmentError(null);
    setIsAdjusting(true);
    try {
      const response = await fetch(`/api/bills/${bill.instanceId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "correct" ? { kind, amount } : { kind }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Unable to change this payment.");
      }
      setAdjustingBill(null);
      await fetchBills();
    } catch (error) {
      setAdjustmentError(error instanceof Error ? error.message : "Unable to change this payment.");
    } finally {
      setIsAdjusting(false);
    }
  };

  const resetBillForm = () => {
    setNewBillName("");
    setNewBillAmount("");
    setNewBillDay("15");
    setNewBillDayOfWeek("1");
    setNewBillFrequency("monthly");
    setNewBillOccurrenceLimit("");
    setNewBillGrace("3");
    setNewBillAutoPay(false);
    setNewBillSourceAccountId("");
    setFirstOccurrencePaid(null);
    setExistingPaymentId("");
    setNewBillVariableAmount(false);
    setNewBillType("variable_utility");
    setBillFormError(null);
  };

  const closeBillForm = () => {
    setIsAddBillOpen(false);
    setEditingBill(null);
    resetBillForm();
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setBillFormError(null);
    setIsBillSaving(true);
    try {
      const res = await fetch(editingBill ? `/api/bills/${editingBill.billId}` : "/api/bills", {
        method: editingBill ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBillName,
          amount: Math.round(parseFloat(newBillAmount) * 100),
          ...(newBillFrequency === "weekly" || newBillFrequency === "biweekly"
            ? { due_day_of_week: parseInt(newBillDayOfWeek, 10) }
            : { due_day_of_month: parseInt(newBillDay, 10) }),
          frequency: newBillFrequency,
          occurrence_limit: newBillOccurrenceLimit ? Number(newBillOccurrenceLimit) : null,
          grace_period_days: parseInt(newBillGrace, 10),
          is_auto_pay: newBillAutoPay,
          source_account_id: newBillSourceAccountId || null,
          is_variable_amount: newBillVariableAmount,
          ...(firstOccurrencePaid !== null && { first_occurrence_paid: firstOccurrencePaid }),
          ...(existingPaymentId && { first_occurrence_transaction_id: existingPaymentId }),
          ...(!editingBill && { type: newBillType }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Unable to ${editingBill ? "update" : "create"} bill.`);
      }
      closeBillForm();
      await fetchBills();
    } catch (err) {
      console.error("Create bill failed:", err);
      setBillFormError(err instanceof Error ? err.message : "Unable to save bill. Please try again.");
    } finally {
      setIsBillSaving(false);
    }
  };

  const openBillEditor = (bill: BillItem) => {
    setEditingBill(bill);
    setNewBillName(bill.name);
    setNewBillAmount((bill.amount / 100).toFixed(2));
    setNewBillFrequency(bill.frequency);
    setNewBillOccurrenceLimit(bill.occurrenceLimit == null ? "" : String(bill.occurrenceLimit));
    setNewBillGrace(String(bill.gracePeriodDays));
    setNewBillAutoPay(bill.isAutoPay);
    setNewBillSourceAccountId(bill.sourceAccountId ?? "");
    setFirstOccurrencePaid(null);
    setExistingPaymentId("");
    setNewBillVariableAmount(bill.isVariableAmount);
    setNewBillDay(String(bill.dueDayOfMonth));
    setNewBillDayOfWeek(String(bill.dueDayOfWeek ?? new Date(`${bill.dueDate}T00:00:00`).getDay()));
    setBillFormError(null);
    setDetailBill(null);
    setIsAddBillOpen(true);
  };

  const handleDeactivateBill = async (bill: BillItem) => {
    if (!window.confirm(`Deactivate “${bill.name}”? Its payment history will be kept.`)) return;
    setBillActionError(null);
    try {
      const res = await fetch(`/api/bills/${bill.billId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Unable to deactivate bill.");
      }
      setDetailBill(null);
      await fetchBills();
    } catch (err) {
      console.error("Deactivate bill failed:", err);
      setBillActionError(err instanceof Error ? err.message : "Unable to deactivate bill. Please try again.");
    }
  };

  const activeBills = bills.filter((b) => b.status !== "paid" && b.status !== "auto_debited");
  const postedAutoBills = bills.filter((b) => b.status === "auto_debited").slice(-5).reverse();
  const committedTotal = activeBills.reduce((acc, b) => acc + b.amountDue, 0);
  const utilitiesTotal = activeBills
    .filter((b) => b.type === "variable_utility")
    .reduce((acc, b) => acc + b.amountDue, 0);
  const subsTotal = committedTotal - utilitiesTotal;

  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const scheduledDayThisMonth = Math.min(Number(newBillDay), new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
  const asksAboutFirstPayment = newBillAutoPay && (!editingBill || !editingBill.autoPostFrom) &&
    (newBillFrequency === "weekly" || newBillFrequency === "biweekly"
      ? Boolean(editingBill && editingBill.dueDate < todayDate)
      : scheduledDayThisMonth < today.getDate());
  const matchingLoggedExpenses = recentExpenses.filter((entry) => entry.source !== "bill_payment" &&
    Math.abs(Date.now() - Date.parse(entry.transactedAt)) <= 31 * 86_400_000 &&
    entry.legs.some(({ leg }) => leg.accountId === newBillSourceAccountId && leg.amount === -Math.round(Number(newBillAmount) * 100)))
    .slice(0, 5);
  const searchTerm = billSearch.trim().toLocaleLowerCase();
  const visibleBills = (searchTerm || tab === "all"
    ? activeBills
    : activeBills.filter((b) => b.dueDate <= todayDate || (nextPaydayDate !== null && b.dueDate <= nextPaydayDate)))
    .filter((b) => !searchTerm || b.name.toLocaleLowerCase().includes(searchTerm));
  const matchingPaidBills = searchTerm
    ? bills.filter((b) => (b.status === "paid" || b.status === "auto_debited") && b.name.toLocaleLowerCase().includes(searchTerm))
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    : postedAutoBills;
  const searchResultCount = visibleBills.length + (searchTerm ? matchingPaidBills.length : 0);
  // Groups use the selected list so the tabs filter every rendered obligation.
  const graceBills = visibleBills.filter((b) => b.status === "grace_period" && !b.isAutoPay);
  const dueThisWeekBills = visibleBills.filter(
    (b) => b.status !== "grace_period" && !b.isAutoPay
  );
  const autoDebitBills = visibleBills.filter((b) => b.isAutoPay);

  return (
    <div className="flex flex-col min-h-screen bg-transparent" runway-id="bills.page">
      <Header title="Bills" />

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] md:max-w-4xl mx-auto min-h-screen" runway-id="bills.main">
        <div className="flex flex-col w-full px-margin pb-6 gap-6 lg:gap-5">
          {/* View Switcher & Title Block */}
          <section className="flex flex-col gap-space-sm pt-space-xs lg:gap-2">
            <h1 runway-id="bills.title" className="font-headline-lg text-headline-lg font-semibold text-on-surface tracking-tight leading-tight">
              Bills and subscriptions
            </h1>
            <p runway-id="bills.description" className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
              Manage recurring costs and payment dates in one place.
            </p>

            <div className="relative mt-2">
              <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                runway-id="bills.search.input"
                type="search"
                aria-label="Search bills by name"
                placeholder="Search bills by name"
                value={billSearch}
                onChange={(event) => setBillSearch(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-outline-variant/60 bg-white/80 pl-11 pr-11 text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
              />
              {billSearch && <button
                type="button"
                runway-id="bills.search.clear"
                aria-label="Clear bill search"
                onClick={() => setBillSearch("")}
                className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:outline-offset-0"
              ><X size={16} aria-hidden="true" /></button>}
            </div>

            {/* Segmented Control */}
            <div className="mt-1 flex gap-1 rounded-xl border border-white/65 bg-white/45 p-1">
              <button
                type="button"
                onClick={() => setTab("due")}
                aria-pressed={tab === "due"}
                runway-id="bills.tab.due" className={`flex-1 min-h-11 px-3 text-center rounded-full font-label-md text-label-md font-semibold transition-colors ${
                  tab === "due"
                    ? "bg-white text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                Due by payday
              </button>
              <button
                type="button"
                onClick={() => setTab("all")}
                aria-pressed={tab === "all"}
                runway-id="bills.tab.all" className={`flex-1 min-h-11 px-3 text-center rounded-full font-label-md text-label-md transition-colors ${
                  tab === "all"
                    ? "bg-white text-primary shadow-sm font-semibold"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                All bills
              </button>
            </div>
            {searchTerm ? <p runway-id="bills.search.status" className="text-body-sm text-on-surface-variant" role="status">
              {isBillsLoading ? "Searching bills…" : !billsAvailable ? "Bills unavailable" : `${searchResultCount} ${searchResultCount === 1 ? "result" : "results"} across all bills`}
            </p> : tab === "due" && <p className="text-body-sm text-on-surface-variant" role="status">
              {isForecastLoading
                ? "Finding your next payday…"
                : nextPaydayDate
                  ? `Showing unpaid bills due on or before ${nextPaydayDate}, including past-due bills.`
                  : "Next payday is unavailable. Showing past-due bills only. Choose All bills to see every unpaid bill."}
            </p>}
          </section>

          {/* High-Contrast Operational Summary Card */}
          <section className="forest-panel flex min-h-[244px] flex-col gap-6 p-6 lg:min-h-0 lg:gap-3 lg:p-4">
            <div className="flex flex-wrap justify-between items-start gap-3">
              <div className="flex flex-col">
                <span runway-id="bills.summary.committed.label" className="font-label-sm text-label-sm uppercase tracking-wide text-secondary-fixed font-medium">
                  Unpaid bills total
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span runway-id="bills.summary.committed.value" className="font-currency-display text-currency-display text-white font-semibold break-all min-h-[36px]">
                    {isBillsLoading ? <Skeleton className="h-9 w-40 bg-white/15" /> : billsAvailable ? formatPHP(committedTotal) : "Unavailable"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-secondary-fixed px-3 py-2 rounded-full">
                <CalendarDays size={15} aria-hidden="true" />
                  <span runway-id="bills.summary.count" className="font-label-sm text-label-sm font-semibold min-w-[92px] min-h-5">
                  {isBillsLoading ? <Skeleton className="h-4 w-20 bg-white/15" /> : billsAvailable ? `${activeBills.length} unpaid ${activeBills.length === 1 ? "item" : "items"}` : "Unavailable"}
                </span>
              </div>
            </div>

            {/* Allocation Stream */}
            <div className="grid grid-cols-2 gap-6 border-t border-white/15 pt-4 lg:gap-4 lg:pt-3">
              <div className="flex min-w-0 flex-col">
                <span runway-id="bills.summary.utilities.label" className="font-label-sm text-label-sm text-secondary-fixed">
                  Utilities
                </span>
                <span runway-id="bills.summary.utilities.value" className="font-currency-sm text-currency-sm font-semibold text-white mt-1 break-all min-h-5">
                  {isBillsLoading ? <Skeleton className="h-5 w-24 bg-white/15" /> : billsAvailable ? formatPHP(utilitiesTotal) : "—"}
                </span>
              </div>
              <div className="flex min-w-0 flex-col">
                <span runway-id="bills.summary.subscriptions.label" className="font-label-sm text-label-sm text-secondary-fixed">
                  Other bills
                </span>
                <span runway-id="bills.summary.subscriptions.value" className="font-currency-sm text-currency-sm font-semibold text-white mt-1 break-all min-h-5">
                  {isBillsLoading ? <Skeleton className="h-5 w-24 bg-white/15" /> : billsAvailable ? formatPHP(subsTotal) : "—"}
                </span>
              </div>
            </div>

            {/* Runway Diagnostic Line */}
            {isBillsLoading ? <div runway-id="bills.status.loading" className="min-h-5" role="status" aria-label="Loading bills"><span className="sr-only">Loading bills…</span><Skeleton className="h-4 w-36 bg-white/15" /></div>
              : billsError ? <div>
                <p runway-id="bills.status.error" className="text-body-sm text-secondary-fixed" role="alert">{billsError}</p>
                <button runway-id="bills.action.retry" type="button" onClick={fetchBills} className="min-h-11 mt-2 px-4 rounded-full bg-white text-primary text-label-md font-semibold">Retry</button>
              </div> : <p runway-id="bills.summary.note" className="text-body-sm text-secondary-fixed">This total includes unpaid items outside the selected pay cycle.</p>}
          </section>

          {/* Obligation Groups Stream */}
          {isBillsLoading ? <div runway-id="bills.list.loading" className="flex flex-col gap-space-sm" role="status" aria-label="Loading bills"><span className="sr-only">Loading bill cards…</span>{[0, 1, 2].map((item) => <Skeleton key={item} className="h-40 w-full rounded-xl lg:h-16" />)}</div> : billsAvailable && <div className="flex flex-col gap-space-lg lg:gap-5">
            {paymentError && <p runway-id="bills.payment.error" className="text-body-sm text-error" role="alert">{paymentError}</p>}
            {(searchTerm ? searchResultCount === 0 : visibleBills.length === 0) && <p runway-id="bills.empty" className="text-body-md text-on-surface-variant">
              {searchTerm ? `No bills match “${billSearch.trim()}”.`
                : tab === "due" && nextPaydayDate
                ? `No unpaid bills are due on or before ${nextPaydayDate}.`
                : tab === "due" && isForecastLoading
                  ? "Finding your next payday…"
                : tab === "due" && !isForecastLoading
                  ? "No past-due bills. A next payday is needed to show bills due this cycle. Choose All bills to see every unpaid bill."
                  : "No unpaid bills."}
            </p>}
            {/* Group A: Critical / Grace Window */}
            {graceBills.length > 0 && (
              <section className="flex flex-col gap-space-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <TriangleAlert size={17} className="text-amber-800" aria-hidden="true" />
                    <span runway-id="bills.group.grace.title" className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">
                      In grace period
                    </span>
                  </div>
                  <span runway-id="bills.group.grace.badge" className="font-label-sm text-label-sm font-medium px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                    Past due
                  </span>
                </div>

                {graceBills.map((b) => (
                  <div
                    key={b.instanceId}
                    runway-id={`bills.grace.item.${b.instanceId}`}
                    className="min-h-0 rounded-xl border border-amber-200 bg-amber-50/80 p-4 flex flex-col gap-3 lg:min-h-0 lg:flex-row lg:items-center lg:gap-3 lg:p-3"
                  >
                    <div className="flex flex-wrap justify-between items-start gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
                      <div className="flex min-w-0 gap-3 items-center lg:flex-1 lg:gap-2">
                        <div className="w-11 h-11 shrink-0 rounded-full bg-amber-100/70 flex items-center justify-center text-amber-900 lg:h-8 lg:w-8">
                          <Zap size={18} aria-hidden="true" />
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span runway-id={`bills.grace.name.${b.instanceId}`} className="font-body-lg text-body-lg font-semibold text-on-surface break-words lg:text-sm lg:leading-5">
                            {b.name}
                          </span>
                          <span runway-id={`bills.grace.details.${b.instanceId}`} className="font-body-sm text-body-sm text-on-surface-variant">
                            {b.sourceAccountName || "Source account not specified"} · Due {b.dueDate}
                          </span>
                        </div>
                      </div>
                      <span runway-id={`bills.grace.amount.${b.instanceId}`} className="font-currency-lg text-currency-lg font-semibold text-on-surface break-all lg:whitespace-nowrap lg:text-[15px]">
                        {formatPHP(b.amountDue)}
                      </span>
                    </div>

                    {/* Action Grid */}
                    <div className="grid grid-cols-2 gap-2 pt-1 lg:flex lg:shrink-0 lg:pt-0">
                      <button
                        type="button"
                        onClick={() => handlePayBill(b)}
                        runway-id={`bills.grace.pay.${b.instanceId}`} className="min-h-11 px-3 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform lg:min-h-9"
                      >
                        <Check size={16} aria-hidden="true" />
                        Record payment
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailBill(b)}
                        runway-id={`bills.grace.details-action.${b.instanceId}`} className="min-h-11 px-3 rounded-full bg-white/80 border border-primary/10 text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-1 hover:bg-white active:scale-95 transition-transform lg:min-h-9"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Group B: Due Today & This Week */}
            {dueThisWeekBills.length > 0 && (
              <section className="flex flex-col gap-space-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays size={17} className="text-secondary" aria-hidden="true" />
                    <span runway-id="bills.group.due.title" className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">
                      {searchTerm || tab === "all" ? "Other unpaid bills" : "Due by next payday"}
                    </span>
                  </div>
                  <span runway-id="bills.group.due.count" className="font-label-sm text-label-sm font-medium text-on-surface-variant">
                    {dueThisWeekBills.length} {dueThisWeekBills.length === 1 ? "item" : "items"}
                  </span>
                </div>

                <div className="border-y border-outline-variant/50">
                {dueThisWeekBills.map((b) => (
                  <div
                    key={b.instanceId}
                    runway-id={`bills.due.item.${b.instanceId}`}
                    className="min-h-0 border-b border-outline-variant/40 py-3 flex flex-col gap-2 last:border-b-0 lg:min-h-0 lg:flex-row lg:items-center lg:gap-4 lg:py-2.5"
                  >
                    <div className="flex flex-wrap justify-between items-start gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
                      <div className="flex min-w-0 gap-3 items-center lg:flex-1 lg:gap-2">
                        <div className="w-11 h-11 shrink-0 rounded-full bg-secondary-container/60 flex items-center justify-center text-primary lg:h-8 lg:w-8">
                          {b.name.toLowerCase().includes("fiber") || b.name.toLowerCase().includes("pldt")
                            ? <Wifi size={20} aria-hidden="true" /> : <Droplets size={20} aria-hidden="true" />}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <div className="flex flex-wrap items-center gap-1.5">
                              <span runway-id={`bills.due.name.${b.instanceId}`} className="font-body-lg text-body-lg font-semibold text-on-surface break-words lg:text-sm lg:leading-5">
                              {b.name}
                            </span>
                            <span runway-id={`bills.due.status.${b.instanceId}`} className="px-2 py-0.5 font-label-sm text-label-sm rounded-full bg-secondary-container/70 text-primary font-medium">
                              {b.dueDate < todayDate ? "Past due" : b.dueDate === todayDate ? "Today" : "Upcoming"}
                            </span>
                          </div>
                          <span runway-id={`bills.due.details.${b.instanceId}`} className="font-body-sm text-body-sm text-on-surface-variant">
                            Due {b.dueDate} · {b.sourceAccountName || "Source not specified"}
                          </span>
                        </div>
                      </div>
                      <span runway-id={`bills.due.amount.${b.instanceId}`} className="font-currency-lg text-currency-lg font-semibold text-on-surface break-all lg:whitespace-nowrap lg:text-[15px]">
                        {formatPHP(b.amountDue)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 lg:shrink-0 lg:gap-3 lg:pt-0">
                      <button runway-id={`bills.due.details-action.${b.instanceId}`} type="button" onClick={() => setDetailBill(b)} className="min-h-11 text-secondary text-body-sm lg:min-h-9">Details</button>
                      <button
                        type="button"
                        onClick={() => handlePayBill(b)}
                        runway-id={`bills.due.pay.${b.instanceId}`} className="min-h-11 px-4 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform lg:min-h-9 lg:px-3"
                      >
                        Record payment
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
                </div>
              </section>
            )}

            {/* Group C: Auto-Debit Subscriptions */}
            {autoDebitBills.length > 0 && (
              <section className="flex flex-col gap-space-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Repeat2 size={17} className="text-secondary" aria-hidden="true" />
                    <span runway-id="bills.group.autopay.title" className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">
                      Auto-Debit Subscriptions
                    </span>
                  </div>
                  <span runway-id="bills.group.autopay.badge" className="font-label-sm text-label-sm text-on-surface-variant">
                    Auto-pay enabled
                  </span>
                </div>

                <div className="border-y border-outline-variant/50">
                {autoDebitBills.map((b) => (
                  <div
                    key={b.instanceId}
                    runway-id={`bills.autopay.item.${b.instanceId}`}
                    className="min-h-24 border-b border-outline-variant/40 py-4 flex flex-col gap-3 last:border-b-0 lg:min-h-0 lg:flex-row lg:items-center lg:gap-4 lg:py-2.5"
                  >
                    <div className="flex flex-wrap justify-between items-start gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
                      <div className="flex min-w-0 gap-3 items-center lg:flex-1 lg:gap-2">
                        <div className="w-11 h-11 shrink-0 rounded-full bg-secondary-container/60 flex items-center justify-center text-primary lg:h-8 lg:w-8">
                          {b.name.toLowerCase().includes("netflix") ? <CreditCard size={20} aria-hidden="true" /> : <Headphones size={20} aria-hidden="true" />}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span runway-id={`bills.autopay.name.${b.instanceId}`} className="font-body-lg text-body-lg font-semibold text-on-surface break-words lg:text-sm lg:leading-5">
                            {b.name}
                          </span>
                          <span runway-id={`bills.autopay.details.${b.instanceId}`} className="font-body-sm text-body-sm text-on-surface-variant">
                            {b.sourceAccountName || "Source not specified"} · {b.dueDate}
                          </span>
                        </div>
                      </div>
                      <span runway-id={`bills.autopay.amount.${b.instanceId}`} className="font-currency-lg text-currency-lg font-semibold text-on-surface break-all lg:whitespace-nowrap lg:text-[15px]">
                        {formatPHP(b.amountDue)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1 lg:shrink-0 lg:pt-0">
                      <button runway-id={`bills.autopay.details-action.${b.instanceId}`} type="button" onClick={() => setDetailBill(b)} className="min-h-11 self-start text-secondary text-body-sm lg:min-h-9">Details</button>
                      {!b.autoPostFrom ? <button type="button" onClick={() => openBillEditor(b)} className="min-h-11 px-4 rounded-full bg-primary text-on-primary font-label-md font-semibold lg:min-h-9 lg:px-3">Set up auto-pay</button>
                        : b.dueDate < todayDate ? <button type="button" onClick={() => handlePayBill(b)} className="min-h-11 px-4 rounded-full bg-primary text-on-primary font-label-md font-semibold lg:min-h-9 lg:px-3">Needs attention · Record payment</button>
                        : <span className="text-body-sm text-on-surface-variant">Posts automatically on {b.dueDate}</span>}
                    </div>
                  </div>
                ))}
                </div>
              </section>
            )}
          </div>}

          {matchingPaidBills.length > 0 && <section className="space-y-2 border-t border-outline-variant/50 pt-4" aria-label={searchTerm ? "Paid bills" : "Recent auto-pay"}>
            <h2 className="font-label-md text-label-md font-semibold text-on-surface">{searchTerm ? "Paid bills" : "Recently posted in Runway"}</h2>
            {matchingPaidBills.map((bill) => <div key={bill.instanceId} className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/40 py-2 text-body-sm last:border-b-0">
              <span><span className="font-semibold text-on-surface">{bill.name}</span> · {bill.dueDate} · {formatPHP(bill.amountDue)}{bill.isVariableAmount && !bill.hasCorrection ? " estimated" : ""}</span>
              <div className="flex items-center gap-2">
                {searchTerm && <button type="button" onClick={() => setDetailBill(bill)} className="min-h-11 px-2 font-semibold text-primary lg:min-h-10">Details</button>}
                {bill.status === "auto_debited" && <>
                {bill.isVariableAmount && <button type="button" onClick={() => { setAdjustingBill(bill); setAdjustedAmount((bill.amountDue / 100).toFixed(2)); setAdjustmentError(null); }} className="min-h-11 px-2 font-semibold text-primary lg:min-h-10">Correct amount</button>}
                <button type="button" onClick={() => { if (window.confirm(`Reverse the Runway payment for ${bill.name}?`)) void adjustAutoPay(bill, "undo"); }} disabled={isAdjusting} className="min-h-11 px-2 font-semibold text-primary disabled:opacity-50 lg:min-h-10">Didn’t happen</button>
                </>}
              </div>
            </div>)}
            {adjustmentError && <p role="alert" className="text-body-sm text-error">{adjustmentError}</p>}
          </section>}

          {/* Operational Buffer Anchor Card */}
          <section className="flex items-center justify-between gap-3 border-t border-outline-variant/50 pt-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-secondary-container/70 text-primary flex items-center justify-center shrink-0">
                <Wallet size={19} aria-hidden="true" />
              </div>
              <div className="flex flex-col min-w-0">
                  <span runway-id="bills.reserve.title" className="font-label-sm text-label-sm font-semibold text-on-surface">
                  Safe to spend
                </span>
                <span runway-id="bills.reserve.description" className="text-body-sm text-on-surface-variant">See your cash forecast</span>
              </div>
            </div>
            <Link runway-id="bills.reserve.link" href="/" className="min-h-11 shrink-0 flex items-center text-label-sm text-secondary font-semibold underline decoration-secondary/30 underline-offset-4">Runway <ArrowRight size={14} className="ml-1" aria-hidden="true" /></Link>
          </section>

          {/* Add Recurring Obligation Button */}
          <button
            type="button"
            onClick={() => { setEditingBill(null); resetBillForm(); setIsAddBillOpen(true); }}
            runway-id="bills.action.add" className="w-full min-h-12 rounded-xl border border-outline-variant/60 bg-white/60 text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-2 hover:bg-white active:scale-[0.99] transition-colors"
          >
            <CirclePlus size={18} aria-hidden="true" />
            Add a recurring bill
          </button>
        </div>
      </main>

      <BottomNav onOpenQuickLog={() => setIsQuickLogOpen(true)} />

      <RapidExpenseDrawer
        isOpen={isQuickLogOpen}
        onClose={() => setIsQuickLogOpen(false)}
        onSuccess={fetchBills}
        accounts={paymentAccounts}
      />

      {/* Add Recurring Modal */}
      <Dialog open={isAddBillOpen} onClose={closeBillForm} title={editingBill ? "Edit recurring bill" : "Add a recurring bill"}>
          <form
            onSubmit={handleCreateBill}
              runway-id="bills.add.form" className="flex flex-col space-y-4"
          >
            {editingBill && <p className="text-body-sm text-on-surface-variant" role="status">Schedule changes move only the next unpaid occurrence. Amount changes update all outstanding unpaid bills.</p>}
            {billFormError && <p className="text-body-sm text-red-800" role="alert">{billFormError}</p>}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col space-y-1">
              <label runway-id="bills.add.name.label" htmlFor="bill-name" className="font-label-sm text-label-sm text-on-surface-variant">
                Bill or subscription name
              </label>
              <input
                runway-id="bills.add.name.input" id="bill-name"
                type="text"
                required
                placeholder="e.g. Converge ICT"
                value={newBillName}
                onChange={(e) => setNewBillName(e.target.value)}
                className="h-11 px-4 rounded-full border border-outline-variant/50 bg-white/70 font-body-md text-body-md"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label runway-id="bills.add.amount.label" htmlFor="bill-amount" className="font-label-sm text-label-sm text-on-surface-variant">
                Amount due each time (₱)
              </label>
              <input
                runway-id="bills.add.amount.input" id="bill-amount"
                type="number"
                step="0.01"
                required
                placeholder="1500.00"
                value={newBillAmount}
                onChange={(e) => setNewBillAmount(e.target.value)}
                className="h-11 px-4 rounded-full border border-outline-variant/50 bg-white/70 font-currency-md text-currency-md"
              />
            </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col space-y-1">
              <label runway-id="bills.add.frequency.label" htmlFor="bill-frequency" className="font-label-sm text-label-sm text-on-surface-variant">
                Frequency
              </label>
              <div className="relative">
                <select
                  runway-id="bills.add.frequency.input" id="bill-frequency"
                  value={newBillFrequency}
                  onChange={(e) => setNewBillFrequency(e.target.value)}
                  className="h-11 w-full appearance-none rounded-full border border-outline-variant/50 bg-white/70 px-4 pr-11 font-body-md text-body-md"
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                  <option value="every_2_months">Every 2 months</option>
                  <option value="every_3_months">Every 3 months</option>
                  <option value="every_6_months">Every 6 months</option>
                  <option value="annually">Every year</option>
                </select>
                <ChevronDown aria-hidden="true" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              </div>
            </div>

            <div className="flex flex-col space-y-1">
              <label runway-id="bills.add.occurrence-limit.label" htmlFor="bill-occurrence-limit" className="font-label-sm text-label-sm text-on-surface-variant">
                Payment limit (optional)
              </label>
              <input
                runway-id="bills.add.occurrence-limit.input" id="bill-occurrence-limit"
                type="number" inputMode="numeric" min="1" max="600" step="1"
                placeholder="Ongoing"
                value={newBillOccurrenceLimit}
                onChange={(e) => setNewBillOccurrenceLimit(e.target.value)}
                aria-describedby="bill-occurrence-limit-hint"
                className="h-11 px-4 rounded-full border border-outline-variant/50 bg-white/70 font-body-md text-body-md"
              />
              <p id="bill-occurrence-limit-hint" className="text-body-sm text-on-surface-variant">Leave blank to keep repeating.</p>
            </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col space-y-1">
                <label runway-id="bills.add.due-day.label" htmlFor="bill-day" className="font-label-sm text-label-sm text-on-surface-variant">
                  {newBillFrequency === "weekly" || newBillFrequency === "biweekly" ? "Due day of week" : "Due day of month"}
                </label>
                {newBillFrequency === "weekly" || newBillFrequency === "biweekly" ? (
                  <div className="relative">
                    <select
                      runway-id="bills.add.due-day.input" id="bill-day"
                      required
                      value={newBillDayOfWeek}
                      onChange={(e) => setNewBillDayOfWeek(e.target.value)}
                      className="h-11 w-full appearance-none rounded-full border border-outline-variant/50 bg-white/70 px-4 pr-11 font-body-md text-body-md"
                    >
                      <option value="0">Sunday</option>
                      <option value="1">Monday</option>
                      <option value="2">Tuesday</option>
                      <option value="3">Wednesday</option>
                      <option value="4">Thursday</option>
                      <option value="5">Friday</option>
                      <option value="6">Saturday</option>
                    </select>
                    <ChevronDown aria-hidden="true" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  </div>
                ) : (
                  <input
                    runway-id="bills.add.due-day.input" id="bill-day"
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={newBillDay}
                    onChange={(e) => setNewBillDay(e.target.value)}
                    className="h-11 px-4 rounded-full border border-outline-variant/50 bg-white/70 font-body-md text-body-md"
                  />
                )}
              </div>

              <div className="flex flex-col space-y-1">
                <label runway-id="bills.add.grace.label" htmlFor="bill-grace" className="font-label-sm text-label-sm text-on-surface-variant">
                  Grace period after due date (days)
                </label>
                <input
                  runway-id="bills.add.grace.input" id="bill-grace"
                  type="number"
                  min="0"
                  max="30"
                  required
                  value={newBillGrace}
                  onChange={(e) => setNewBillGrace(e.target.value)}
                  className="h-11 px-4 rounded-full border border-outline-variant/50 bg-white/70 font-body-md text-body-md"
                />
              </div>
            </div>

            <div className="divide-y divide-outline-variant/50 border-y border-outline-variant/50">
              <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-3">
                <span className="flex flex-col gap-0.5">
                  <span className="font-label-md text-label-md font-semibold text-on-surface">Auto-pay</span>
                  <span className="text-body-sm text-on-surface-variant">Record this bill from its account on the due date.</span>
                </span>
                <input
                  runway-id="bills.add.auto-pay.input"
                  type="checkbox"
                  checked={newBillAutoPay}
                  onChange={(event) => { setNewBillAutoPay(event.target.checked); if (!event.target.checked) { setFirstOccurrencePaid(null); setExistingPaymentId(""); } }}
                  className="h-5 w-5 shrink-0 accent-primary"
                />
              </label>

              <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-3">
                <span className="flex flex-col gap-0.5">
                  <span className="font-label-md text-label-md font-semibold text-on-surface">Variable amount</span>
                  <span className="text-body-sm text-on-surface-variant">Auto-pay uses this estimate; you can correct it later.</span>
                </span>
                <input
                  runway-id="bills.add.variable-amount.input"
                  type="checkbox"
                  checked={newBillVariableAmount}
                  onChange={(event) => setNewBillVariableAmount(event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-primary"
                />
              </label>
            </div>

            <div className="flex flex-col space-y-1">
              <label htmlFor="bill-source-account" className="font-label-sm text-label-sm text-on-surface-variant">
                Pays from {newBillAutoPay ? "(required)" : "(optional)"}
              </label>
              <div className="relative">
                <select id="bill-source-account" runway-id="bills.add.source-account.input" value={newBillSourceAccountId}
                  required={newBillAutoPay} onChange={(event) => setNewBillSourceAccountId(event.target.value)}
                  className="h-11 w-full appearance-none rounded-full border border-outline-variant/50 bg-white/70 px-4 pr-11 font-body-md text-body-md">
                  <option value="">Choose account</option>
                  {paymentAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
                <ChevronDown aria-hidden="true" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              </div>
            </div>

            {asksAboutFirstPayment && <fieldset className="min-w-0">
              <legend className="font-label-md text-label-md font-semibold text-on-surface">Was this month’s bill already paid?</legend>
              <div className="mt-2 space-y-3 rounded-xl bg-surface-container-low p-4">
                <p className="text-body-sm text-on-surface-variant">Answer once for the date that has passed. Future payments will post automatically.</p>
                <div className="space-y-1">
                  <label className="flex min-h-11 items-center gap-3 text-body-sm"><input type="radio" name="first-occurrence-paid" checked={firstOccurrencePaid === true} onChange={() => setFirstOccurrencePaid(true)} /> Yes, record it from this account</label>
                  <label className="flex min-h-11 items-center gap-3 text-body-sm"><input type="radio" name="first-occurrence-paid" checked={firstOccurrencePaid === false} onChange={() => { setFirstOccurrencePaid(false); setExistingPaymentId(""); }} /> No, leave it unpaid</label>
                </div>
                {firstOccurrencePaid === true && <div className="border-t border-outline-variant/50 pt-3 text-body-sm">
                  <label className="mb-2 block font-medium text-on-surface" htmlFor="existing-bill-payment">Already logged this expense in Runway?</label>
                  <div className="relative">
                    <select id="existing-bill-payment" value={existingPaymentId} onChange={(event) => setExistingPaymentId(event.target.value)}
                      aria-describedby="existing-bill-payment-hint"
                      className="block h-11 w-full min-w-0 appearance-none rounded-xl border border-outline-variant/60 bg-white px-3 pr-11 text-on-surface focus-visible:outline-offset-2">
                      <option value="">No — record it now from this account</option>
                      {matchingLoggedExpenses.map((entry) => <option key={entry.id} value={entry.id}>{entry.description} · {entry.transactedAt.slice(0, 10)}</option>)}
                    </select>
                    <ChevronDown aria-hidden="true" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  </div>
                  <p id="existing-bill-payment-hint" className="mt-2 text-on-surface-variant">Selecting a logged expense clears the bill without another debit.</p>
                </div>}
              </div>
            </fieldset>}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={closeBillForm}
                runway-id="bills.add.cancel" className="h-11 rounded-full bg-white/75 border border-primary/10 font-label-md text-label-md font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                runway-id="bills.add.save" disabled={isBillSaving} className="h-11 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold disabled:opacity-60"
              >
                {isBillSaving ? "Saving…" : editingBill ? "Save changes" : "Save bill"}
              </button>
            </div>
          </form>
      </Dialog>
      <Dialog open={paymentBill !== null} onClose={() => { if (!isPaymentSaving) { setPaymentBill(null); setPaymentError(null); } }} title="Record bill payment">
        {paymentBill && <div className="space-y-4">
          <p className="text-body-md text-on-surface">Record <span className="font-semibold">{paymentBill.name}</span> from the account that paid it.</p>
          <label className="flex flex-col gap-1" htmlFor="payment-source-account">
            <span className="text-body-sm font-semibold text-on-surface">Paid from</span>
            <span className="relative block">
              <select id="payment-source-account" value={paymentSourceAccountId} onChange={(event) => setPaymentSourceAccountId(event.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-outline-variant/60 bg-white px-3 pr-11 text-body-md text-on-surface">
                <option value="">Choose account</option>
                {paymentAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            </span>
          </label>
          {paymentBill.isVariableAmount && <label className="flex flex-col gap-1" htmlFor="variable-payment-amount">
            <span className="text-body-sm font-semibold text-on-surface">Amount paid (₱)</span>
            <input id="variable-payment-amount" type="number" inputMode="decimal" min="0.01" step="0.01" autoFocus value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="min-h-11 rounded-xl border border-outline-variant/60 bg-white px-3 text-body-md text-on-surface" />
          </label>}
          {paymentError && <p role="alert" className="text-body-sm text-error">{paymentError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={isPaymentSaving} onClick={() => { setPaymentBill(null); setPaymentError(null); }} className="min-h-11 rounded-full px-4 text-label-md font-semibold text-on-surface disabled:opacity-50">Cancel</button>
            <button type="button" disabled={isPaymentSaving} onClick={confirmVariablePayment} className="min-h-11 rounded-full bg-primary px-4 text-label-md font-semibold text-on-primary disabled:opacity-50">{isPaymentSaving ? "Recording…" : "Record payment"}</button>
          </div>
        </div>}
      </Dialog>
      <Dialog open={adjustingBill !== null} onClose={() => { if (!isAdjusting) setAdjustingBill(null); }} title="Correct auto-pay amount">
        {adjustingBill && <div className="space-y-4">
          <p className="text-body-sm text-on-surface-variant">Runway posted {formatPHP(adjustingBill.amountDue)} for {adjustingBill.name}. Enter the amount that actually left the account.</p>
          <label className="flex flex-col gap-1" htmlFor="corrected-auto-pay-amount"><span className="text-body-sm font-semibold">Actual amount (₱)</span>
            <input id="corrected-auto-pay-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={adjustedAmount} onChange={(event) => setAdjustedAmount(event.target.value)} className="min-h-11 rounded-xl border border-outline-variant/60 bg-white px-3" />
          </label>
          {adjustmentError && <p role="alert" className="text-body-sm text-error">{adjustmentError}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setAdjustingBill(null)} disabled={isAdjusting} className="min-h-11 px-4">Cancel</button>
            <button type="button" disabled={isAdjusting} onClick={() => {
              const amount = Math.round(Number(adjustedAmount) * 100);
              if (!Number.isSafeInteger(amount) || amount <= 0) { setAdjustmentError("Enter an amount greater than zero."); return; }
              void adjustAutoPay(adjustingBill, "correct", amount);
            }} className="min-h-11 rounded-full bg-primary px-4 font-semibold text-on-primary disabled:opacity-50">{isAdjusting ? "Saving…" : "Save correction"}</button></div>
        </div>}
      </Dialog>
      <Dialog open={detailBill !== null} onClose={() => setDetailBill(null)} title={detailBill?.name || "Bill details"}>
        {detailBill && <div className="space-y-4">
        {billActionError && <p className="text-body-sm text-red-800" role="alert">{billActionError}</p>}
        <dl runway-id={`bills.details.content.${detailBill.instanceId}`} className="space-y-4 text-body-md">
          <div><dt runway-id={`bills.details.due-date.label.${detailBill.instanceId}`}>Due date</dt><dd runway-id={`bills.details.due-date.value.${detailBill.instanceId}`}>{detailBill.dueDate}</dd></div>
          <div><dt runway-id={`bills.details.grace.label.${detailBill.instanceId}`}>Grace period after due date</dt><dd runway-id={`bills.details.grace.value.${detailBill.instanceId}`}>{detailBill.gracePeriodDays} days</dd></div>
          <div><dt runway-id={`bills.details.frequency.label.${detailBill.instanceId}`}>Frequency</dt><dd runway-id={`bills.details.frequency.value.${detailBill.instanceId}`}>{billFrequencyLabels[detailBill.frequency]}</dd></div>
          {detailBill.occurrenceLimit !== null && <div><dt runway-id={`bills.details.occurrence-limit.label.${detailBill.instanceId}`}>Total payments</dt><dd runway-id={`bills.details.occurrence-limit.value.${detailBill.instanceId}`}>{detailBill.occurrenceLimit}</dd></div>}
          <div><dt runway-id={`bills.details.source.label.${detailBill.instanceId}`}>Source account</dt><dd runway-id={`bills.details.source.value.${detailBill.instanceId}`}>{detailBill.sourceAccountName || "Not specified"}</dd></div>
          <div><dt runway-id={`bills.details.balance.label.${detailBill.instanceId}`}>Wallet balance</dt><dd runway-id={`bills.details.balance.value.${detailBill.instanceId}`}>{detailBill.sourceAccountBalance == null ? "Not available" : formatPHP(detailBill.sourceAccountBalance)}</dd></div>
          <div><dt runway-id={`bills.details.autopay.label.${detailBill.instanceId}`}>Auto-pay</dt><dd runway-id={`bills.details.autopay.value.${detailBill.instanceId}`}>{detailBill.isAutoPay ? "Enabled" : "Manual payment"}</dd></div>
          <div><dt runway-id={`bills.details.variable-amount.label.${detailBill.instanceId}`}>Amount</dt><dd runway-id={`bills.details.variable-amount.value.${detailBill.instanceId}`}>{detailBill.isVariableAmount ? "Confirm when recording payment" : "Fixed"}</dd></div>
        </dl>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button type="button" onClick={() => openBillEditor(detailBill)} className="min-h-11 rounded-full bg-primary text-on-primary font-label-md font-semibold">Edit bill</button>
          <button type="button" onClick={() => handleDeactivateBill(detailBill)} className="min-h-11 rounded-full border border-red-300 bg-white text-red-800 font-label-md font-semibold">Deactivate</button>
        </div>
        </div>}
      </Dialog>
    </div>
  );
}
