"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { formatPHP } from "@/lib/currency";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import Link from "next/link";
import { ArrowRight, CalendarDays, Check, CirclePlus, CreditCard, Headphones, Repeat2, Wallet, Wifi, Zap, Droplets, TriangleAlert } from "lucide-react";

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
  isVariableAmount: boolean;
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
  const [isBillsLoading, setIsBillsLoading] = useState(true);
  const [billsAvailable, setBillsAvailable] = useState(false);
  const [billsError, setBillsError] = useState<string | null>(null);
  const [nextPaydayDate, setNextPaydayDate] = useState<string | null>(null);
  const [isForecastLoading, setIsForecastLoading] = useState(true);
  const [tab, setTab] = useState<"due" | "all">("due");
  const [isQuickLogOpen, setIsQuickLogOpen] = useState<boolean>(false);
  const [isAddBillOpen, setIsAddBillOpen] = useState<boolean>(false);
  const [detailBill, setDetailBill] = useState<BillItem | null>(null);
  const [editingBill, setEditingBill] = useState<BillItem | null>(null);
  const [billFormError, setBillFormError] = useState<string | null>(null);
  const [isBillSaving, setIsBillSaving] = useState(false);
  const [billActionError, setBillActionError] = useState<string | null>(null);
  const [paymentBill, setPaymentBill] = useState<BillItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaymentSaving, setIsPaymentSaving] = useState(false);

  // Form states for adding new bill
  const [newBillName, setNewBillName] = useState("");
  const [newBillAmount, setNewBillAmount] = useState("");
  const [newBillDay, setNewBillDay] = useState("15");
  const [newBillDayOfWeek, setNewBillDayOfWeek] = useState("1");
  const [newBillFrequency, setNewBillFrequency] = useState("monthly");
  const [newBillOccurrenceLimit, setNewBillOccurrenceLimit] = useState("");
  const [newBillGrace, setNewBillGrace] = useState("3");
  const [newBillAutoPay, setNewBillAutoPay] = useState(false);
  const [newBillVariableAmount, setNewBillVariableAmount] = useState(false);
  const [newBillType, setNewBillType] = useState<
    "fixed_subscription" | "variable_utility" | "credit_card_statement" | "loan_installment"
  >("variable_utility");

  const fetchBills = useCallback(async () => {
    try {
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

  const settleBill = async (bill: BillItem, amount?: number) => {
    setPaymentError(null);
    setIsPaymentSaving(true);
    try {
      const res = await fetch(`/api/bills/${bill.instanceId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(amount === undefined ? {} : { amount }),
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
    if (!bill.isVariableAmount) {
      void settleBill(bill);
      return;
    }
    setPaymentBill(bill);
    setPaymentAmount((bill.amountDue / 100).toFixed(2));
    setPaymentError(null);
  };

  const confirmVariablePayment = () => {
    if (!paymentBill || isPaymentSaving) return;
    const amount = Math.round(Number(paymentAmount) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setPaymentError("Enter a payment amount greater than zero.");
      return;
    }
    void settleBill(paymentBill, amount);
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
          is_variable_amount: newBillVariableAmount,
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

  const activeBills = bills.filter((b) => b.status !== "paid");
  const committedTotal = activeBills.reduce((acc, b) => acc + b.amountDue, 0);
  const utilitiesTotal = activeBills
    .filter((b) => b.type === "variable_utility")
    .reduce((acc, b) => acc + b.amountDue, 0);
  const subsTotal = committedTotal - utilitiesTotal;

  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const visibleBills = tab === "all"
    ? activeBills
    : activeBills.filter((b) => b.dueDate <= todayDate || (nextPaydayDate !== null && b.dueDate <= nextPaydayDate));
  // Groups use the selected list so the tabs filter every rendered obligation.
  const graceBills = visibleBills.filter((b) => b.status === "grace_period");
  const dueThisWeekBills = visibleBills.filter(
    (b) => b.status !== "grace_period" && !b.isAutoPay
  );
  const autoDebitBills = visibleBills.filter((b) => b.isAutoPay);

  return (
    <div className="flex flex-col min-h-screen bg-transparent" runway-id="bills.page">
      <Header title="Bills" />

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] md:max-w-4xl mx-auto min-h-screen" runway-id="bills.main">
        <div className="flex flex-col w-full px-margin pb-6 gap-6">
          {/* View Switcher & Title Block */}
          <section className="flex flex-col gap-space-sm pt-space-xs">
            <h1 runway-id="bills.title" className="font-headline-lg text-headline-lg font-semibold text-on-surface tracking-tight leading-tight">
              Bills and subscriptions
            </h1>
            <p runway-id="bills.description" className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
              Manage recurring costs and payment dates in one place.
            </p>

            {/* Segmented Control */}
            <div className="order-first flex p-1 bg-white/45 backdrop-blur-md border border-white/65 rounded-full gap-1 mb-4 shadow-[inset_0_1px_3px_rgba(7,40,33,0.04)]">
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
                Due by Next Payday
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
                All Bills &amp; Subscriptions
              </button>
            </div>
            {tab === "due" && <p className="text-body-sm text-on-surface-variant" role="status">
              {isForecastLoading
                ? "Finding your next payday…"
                : nextPaydayDate
                  ? `Showing unpaid bills due on or before ${nextPaydayDate}, including past-due bills.`
                  : "Next payday is unavailable. Showing past-due bills only. Choose All Bills & Subscriptions to see every unpaid bill."}
            </p>}
          </section>

          {/* High-Contrast Operational Summary Card */}
          <section className="forest-panel min-h-[244px] p-6 flex flex-col gap-6">
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
            <div className="grid grid-cols-2 gap-6 border-t border-white/15 pt-4">
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
          {isBillsLoading ? <div runway-id="bills.list.loading" className="flex flex-col gap-space-sm" role="status" aria-label="Loading bills"><span className="sr-only">Loading bill cards…</span>{[0, 1, 2].map((item) => <Skeleton key={item} className="h-40 w-full rounded-[28px]" />)}</div> : billsAvailable && <div className="flex flex-col gap-space-lg">
            {visibleBills.length === 0 && <p runway-id="bills.empty" className="text-body-md text-on-surface-variant">
              {tab === "due" && nextPaydayDate
                ? `No unpaid bills are due on or before ${nextPaydayDate}.`
                : tab === "due" && isForecastLoading
                  ? "Finding your next payday…"
                : tab === "due" && !isForecastLoading
                  ? "No past-due bills. A next payday is needed to show bills due this cycle. Choose All Bills & Subscriptions to see every unpaid bill."
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
                    className="min-h-40 rounded-xl border border-amber-200 bg-amber-50/80 p-5 flex flex-col gap-4"
                  >
                    <div className="flex flex-wrap justify-between items-start gap-3">
                      <div className="flex min-w-0 gap-3 items-center">
                        <div className="w-11 h-11 shrink-0 rounded-full bg-amber-100/70 flex items-center justify-center text-amber-900">
                          <Zap size={20} aria-hidden="true" />
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span runway-id={`bills.grace.name.${b.instanceId}`} className="font-body-lg text-body-lg font-semibold text-on-surface break-words">
                            {b.name}
                          </span>
                          <span runway-id={`bills.grace.details.${b.instanceId}`} className="font-body-sm text-body-sm text-on-surface-variant">
                            {b.sourceAccountName || "Source account not specified"} · Due {b.dueDate}
                          </span>
                        </div>
                      </div>
                      <span runway-id={`bills.grace.amount.${b.instanceId}`} className="font-currency-lg text-currency-lg font-semibold text-on-surface break-all">
                        {formatPHP(b.amountDue)}
                      </span>
                    </div>

                    {/* Action Grid */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handlePayBill(b)}
                        runway-id={`bills.grace.pay.${b.instanceId}`} className="min-h-11 px-3 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform"
                      >
                        <Check size={16} aria-hidden="true" />
                        Record payment
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailBill(b)}
                        runway-id={`bills.grace.details-action.${b.instanceId}`} className="min-h-11 px-3 rounded-full bg-white/80 border border-primary/10 text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-1 hover:bg-white active:scale-95 transition-transform"
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
                      Due by Next Payday
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
                    className="min-h-32 border-b border-outline-variant/40 py-4 flex flex-col gap-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap justify-between items-start gap-3">
                      <div className="flex min-w-0 gap-3 items-center">
                        <div className="w-11 h-11 shrink-0 rounded-full bg-secondary-container/60 flex items-center justify-center text-primary">
                          {b.name.toLowerCase().includes("fiber") || b.name.toLowerCase().includes("pldt")
                            ? <Wifi size={20} aria-hidden="true" /> : <Droplets size={20} aria-hidden="true" />}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <div className="flex flex-wrap items-center gap-1.5">
                              <span runway-id={`bills.due.name.${b.instanceId}`} className="font-body-lg text-body-lg font-semibold text-on-surface break-words">
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
                      <span runway-id={`bills.due.amount.${b.instanceId}`} className="font-currency-lg text-currency-lg font-semibold text-on-surface break-all">
                        {formatPHP(b.amountDue)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button runway-id={`bills.due.details-action.${b.instanceId}`} type="button" onClick={() => setDetailBill(b)} className="min-h-11 text-secondary text-body-sm">Details</button>
                      <button
                        type="button"
                        onClick={() => handlePayBill(b)}
                        runway-id={`bills.due.pay.${b.instanceId}`} className="min-h-11 px-4 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform"
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
                    className="min-h-24 border-b border-outline-variant/40 py-4 flex flex-col gap-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap justify-between items-start gap-3">
                      <div className="flex min-w-0 gap-3 items-center">
                        <div className="w-11 h-11 shrink-0 rounded-full bg-secondary-container/60 flex items-center justify-center text-primary">
                          {b.name.toLowerCase().includes("netflix") ? <CreditCard size={20} aria-hidden="true" /> : <Headphones size={20} aria-hidden="true" />}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span runway-id={`bills.autopay.name.${b.instanceId}`} className="font-body-lg text-body-lg font-semibold text-on-surface break-words">
                            {b.name}
                          </span>
                          <span runway-id={`bills.autopay.details.${b.instanceId}`} className="font-body-sm text-body-sm text-on-surface-variant">
                            {b.sourceAccountName || "Source not specified"} · {b.dueDate}
                          </span>
                        </div>
                      </div>
                      <span runway-id={`bills.autopay.amount.${b.instanceId}`} className="font-currency-lg text-currency-lg font-semibold text-on-surface break-all">
                        {formatPHP(b.amountDue)}
                      </span>
                    </div>

                    <button runway-id={`bills.autopay.details-action.${b.instanceId}`} type="button" onClick={() => setDetailBill(b)} className="min-h-11 self-start text-secondary text-body-sm">Auto-pay · Details</button>
                  </div>
                ))}
                </div>
              </section>
            )}
          </div>}

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
      />

      {/* Add Recurring Modal */}
      <Dialog open={isAddBillOpen} onClose={closeBillForm} title={editingBill ? "Edit recurring bill" : "Add a recurring bill"}>
          <form
            onSubmit={handleCreateBill}
              runway-id="bills.add.form" className="flex flex-col space-y-4"
          >
            {editingBill && <p className="text-body-sm text-on-surface-variant" role="status">Schedule changes move only the next unpaid occurrence. Amount changes update all outstanding unpaid bills.</p>}
            {billFormError && <p className="text-body-sm text-red-800" role="alert">{billFormError}</p>}

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

            <div className="flex flex-col space-y-1">
              <label runway-id="bills.add.frequency.label" htmlFor="bill-frequency" className="font-label-sm text-label-sm text-on-surface-variant">
                Frequency
              </label>
              <select
                runway-id="bills.add.frequency.input" id="bill-frequency"
                value={newBillFrequency}
                onChange={(e) => setNewBillFrequency(e.target.value)}
                className="h-11 px-4 rounded-full border border-outline-variant/50 bg-white/70 font-body-md text-body-md"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="every_2_months">Every 2 months</option>
                <option value="every_3_months">Every 3 months</option>
                <option value="every_6_months">Every 6 months</option>
                <option value="annually">Every year</option>
              </select>
            </div>

            <div className="flex flex-col space-y-1">
              <label runway-id="bills.add.occurrence-limit.label" htmlFor="bill-occurrence-limit" className="font-label-sm text-label-sm text-on-surface-variant">
                Stop after this many payments (optional)
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
              <p id="bill-occurrence-limit-hint" className="text-body-sm text-on-surface-variant">Leave blank if it should keep repeating.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col space-y-1">
                <label runway-id="bills.add.due-day.label" htmlFor="bill-day" className="font-label-sm text-label-sm text-on-surface-variant">
                  {newBillFrequency === "weekly" || newBillFrequency === "biweekly" ? "Due day of week" : "Due day of month"}
                </label>
                {newBillFrequency === "weekly" || newBillFrequency === "biweekly" ? (
                  <select
                    runway-id="bills.add.due-day.input" id="bill-day"
                    required
                    value={newBillDayOfWeek}
                    onChange={(e) => setNewBillDayOfWeek(e.target.value)}
                    className="h-11 px-4 rounded-full border border-outline-variant/50 bg-white/70 font-body-md text-body-md"
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
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

            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-outline-variant/50 bg-white/70 px-4 py-3">
              <span className="flex flex-col gap-0.5">
                <span className="font-label-md text-label-md font-semibold text-on-surface">Auto-pay</span>
                <span className="text-body-sm text-on-surface-variant">Show this bill in Auto-Debit Subscriptions.</span>
              </span>
              <input
                runway-id="bills.add.auto-pay.input"
                type="checkbox"
                checked={newBillAutoPay}
                onChange={(event) => setNewBillAutoPay(event.target.checked)}
                className="h-5 w-5 shrink-0 accent-primary"
              />
            </label>

            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-outline-variant/50 bg-white/70 px-4 py-3">
              <span className="flex flex-col gap-0.5">
                <span className="font-label-md text-label-md font-semibold text-on-surface">Variable amount</span>
                <span className="text-body-sm text-on-surface-variant">Ask for the actual amount whenever you record a payment.</span>
              </span>
              <input
                runway-id="bills.add.variable-amount.input"
                type="checkbox"
                checked={newBillVariableAmount}
                onChange={(event) => setNewBillVariableAmount(event.target.checked)}
                className="h-5 w-5 shrink-0 accent-primary"
              />
            </label>

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
      <Dialog open={paymentBill !== null} onClose={() => { if (!isPaymentSaving) { setPaymentBill(null); setPaymentError(null); } }} title="Confirm payment amount">
        {paymentBill && <div className="space-y-4">
          <p className="text-body-md text-on-surface">Enter the amount paid for <span className="font-semibold">{paymentBill.name}</span>. The expected amount is {formatPHP(paymentBill.amountDue)}.</p>
          <label className="flex flex-col gap-1" htmlFor="variable-payment-amount">
            <span className="text-body-sm font-semibold text-on-surface">Amount paid (₱)</span>
            <input id="variable-payment-amount" type="number" inputMode="decimal" min="0.01" step="0.01" autoFocus value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="min-h-11 rounded-xl border border-outline-variant/60 bg-white px-3 text-body-md text-on-surface" />
          </label>
          {paymentError && <p role="alert" className="text-body-sm text-error">{paymentError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={isPaymentSaving} onClick={() => { setPaymentBill(null); setPaymentError(null); }} className="min-h-11 rounded-full px-4 text-label-md font-semibold text-on-surface disabled:opacity-50">Cancel</button>
            <button type="button" disabled={isPaymentSaving} onClick={confirmVariablePayment} className="min-h-11 rounded-full bg-primary px-4 text-label-md font-semibold text-on-primary disabled:opacity-50">{isPaymentSaving ? "Recording…" : "Record payment"}</button>
          </div>
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
