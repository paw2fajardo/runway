"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { formatPHP } from "@/lib/currency";
import { Dialog } from "@/components/ui/Dialog";
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
  dueDayOfMonth: number;
  gracePeriodDays: number;
  sourceAccountId?: string | null;
  sourceAccountName?: string | null;
  sourceAccountBalance?: number | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

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

  // Form states for adding new bill
  const [newBillName, setNewBillName] = useState("");
  const [newBillAmount, setNewBillAmount] = useState("");
  const [newBillDay, setNewBillDay] = useState("15");
  const [newBillGrace, setNewBillGrace] = useState("3");
  const [newBillType, setNewBillType] = useState<
    "fixed_subscription" | "variable_utility" | "credit_card_statement" | "loan_installment"
  >("variable_utility");

  const fetchBills = useCallback(async () => {
    setIsBillsLoading(true);
    try {
      const res = await fetch("/api/bills");
      if (!res.ok) throw new Error("Unable to load obligations.");
      const data = await res.json();
      setBills(data);
      setBillsAvailable(true);
      setBillsError(null);
    } catch (err) {
      console.error("Failed to load bills:", err);
      setBillsAvailable(false);
      setBillsError("Your obligations are unavailable. Please retry.");
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

  const handlePayBill = async (instanceId: string) => {
    try {
      const res = await fetch(`/api/bills/${instanceId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchBills();
      }
    } catch (err) {
      console.error("Failed to pay bill:", err);
    }
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBillName,
          type: newBillType,
          amount: Math.round(parseFloat(newBillAmount) * 100),
          due_day_of_month: parseInt(newBillDay, 10),
          grace_period_days: parseInt(newBillGrace, 10),
        }),
      });
      if (res.ok) {
        setIsAddBillOpen(false);
        setNewBillName("");
        setNewBillAmount("");
        fetchBills();
      }
    } catch (err) {
      console.error("Create bill failed:", err);
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
      <Header />

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] mx-auto min-h-screen" runway-id="bills.main">
        <div className="flex flex-col w-full px-margin pb-6 gap-6">
          {/* View Switcher & Title Block */}
          <section className="flex flex-col gap-space-sm pt-space-xs">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <h1 runway-id="bills.title" className="font-headline-lg text-headline-lg font-semibold text-on-surface tracking-tight leading-tight">
                  Upcoming Obligations
                </h1>
                <span runway-id="bills.summary.count" className="shrink-0 text-label-sm font-medium text-primary bg-primary/5 px-3 py-2 rounded-full">
                  {isBillsLoading ? "Loading…" : billsAvailable ? `${activeBills.length} dues` : "Unavailable"}
                </span>
              </div>
            </div>
            <p runway-id="bills.description" className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
              Contractual dates mapped against grace windows to safeguard operational
              liquidity.
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
                Due This Pay Cycle
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
                All Bills &amp; Subs
              </button>
            </div>
            {tab === "due" && <p className="text-body-sm text-on-surface-variant" role="status">
              {isForecastLoading
                ? "Checking your next payday to define this pay cycle…"
                : nextPaydayDate
                  ? `Showing unpaid obligations due by ${nextPaydayDate}, including overdue items.`
                  : "Next payday is unavailable. Showing overdue unpaid obligations only; all bills remain available in All Bills & Subs."}
            </p>}
          </section>

          {/* High-Contrast Operational Summary Card */}
          <section className="forest-panel p-6 flex flex-col gap-6">
            <div className="flex flex-wrap justify-between items-start gap-3">
              <div className="flex flex-col">
                <span runway-id="bills.summary.committed.label" className="font-label-sm text-label-sm uppercase tracking-wide text-secondary-fixed font-medium">
                  Committed obligations
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span runway-id="bills.summary.committed.value" className="font-currency-display text-currency-display text-white font-semibold break-all">
                    {isBillsLoading ? "Loading…" : billsAvailable ? formatPHP(committedTotal) : "Unavailable"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-secondary-fixed px-3 py-2 rounded-full">
                <CalendarDays size={15} aria-hidden="true" />
                <span runway-id="bills.summary.open-count" className="font-label-sm text-label-sm font-semibold">
                  {isBillsLoading ? "Loading…" : billsAvailable ? `${activeBills.length} open` : "Unavailable"}
                </span>
              </div>
            </div>

            {/* Allocation Stream */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="flex min-w-0 flex-col p-4 rounded-[24px] border border-white/10 bg-white/5">
                <span runway-id="bills.summary.utilities.label" className="font-label-sm text-label-sm text-secondary-fixed">
                  Essential Utilities
                </span>
                <span runway-id="bills.summary.utilities.value" className="font-currency-sm text-currency-sm font-semibold text-white mt-1 break-all">
                  {!isBillsLoading && billsAvailable ? formatPHP(utilitiesTotal) : "—"}
                </span>
              </div>
              <div className="flex min-w-0 flex-col p-4 rounded-[24px] border border-white/10 bg-white/5">
                <span runway-id="bills.summary.subscriptions.label" className="font-label-sm text-label-sm text-secondary-fixed">
                  Subs &amp; Cards
                </span>
                <span runway-id="bills.summary.subscriptions.value" className="font-currency-sm text-currency-sm font-semibold text-white mt-1 break-all">
                  {!isBillsLoading && billsAvailable ? formatPHP(subsTotal) : "—"}
                </span>
              </div>
            </div>

            {/* Runway Diagnostic Line */}
            {isBillsLoading ? <p runway-id="bills.status.loading" className="text-body-sm text-secondary-fixed" role="status">Loading recorded obligations…</p>
              : billsError ? <div>
                <p runway-id="bills.status.error" className="text-body-sm text-secondary-fixed" role="alert">{billsError}</p>
                <button runway-id="bills.action.retry" type="button" onClick={fetchBills} className="min-h-11 mt-2 px-4 rounded-full bg-white text-primary text-label-md font-semibold">Retry</button>
              </div> : <p runway-id="bills.summary.note" className="text-body-sm text-secondary-fixed">Totals reflect your recorded outstanding obligations.</p>}
          </section>

          {/* Obligation Groups Stream */}
          {!isBillsLoading && billsAvailable && <div className="flex flex-col gap-space-lg">
            {visibleBills.length === 0 && <p runway-id="bills.empty" className="text-body-md text-on-surface-variant">
              {tab === "due" && nextPaydayDate
                ? `No outstanding obligations are due by ${nextPaydayDate}.`
                : tab === "due" && isForecastLoading
                  ? "Checking your next payday before listing this pay cycle’s obligations…"
                : tab === "due" && !isForecastLoading
                  ? "No overdue obligations to show. The pay cycle cannot be determined without a next payday."
                  : "No outstanding obligations."}
            </p>}
            {/* Group A: Critical / Grace Window */}
            {graceBills.length > 0 && (
              <section className="flex flex-col gap-space-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <TriangleAlert size={17} className="text-amber-800" aria-hidden="true" />
                    <span runway-id="bills.group.grace.title" className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">
                      Grace Window Active
                    </span>
                  </div>
                  <span runway-id="bills.group.grace.badge" className="font-label-sm text-label-sm font-medium px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                    Critical Attention
                  </span>
                </div>

                {graceBills.map((b) => (
                  <div
                    key={b.instanceId}
                    runway-id={`bills.grace.item.${b.instanceId}`}
                    className="glass-panel p-5 flex flex-col gap-4"
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
                        onClick={() => handlePayBill(b.instanceId)}
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
                    {dueThisWeekBills.length} Obligations
                  </span>
                </div>

                {dueThisWeekBills.map((b) => (
                  <div
                    key={b.instanceId}
                    runway-id={`bills.due.item.${b.instanceId}`}
                    className="glass-panel p-5 flex flex-col gap-4"
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
                        onClick={() => handlePayBill(b.instanceId)}
                        runway-id={`bills.due.pay.${b.instanceId}`} className="min-h-11 px-4 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform"
                      >
                        Record payment
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
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

                {autoDebitBills.map((b) => (
                  <div
                    key={b.instanceId}
                    runway-id={`bills.autopay.item.${b.instanceId}`}
                    className="glass-panel p-5 flex flex-col gap-4"
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
              </section>
            )}
          </div>}

          {/* Operational Buffer Anchor Card */}
          <section className="glass-panel p-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-secondary-container/70 text-primary flex items-center justify-center shrink-0">
                <Wallet size={19} aria-hidden="true" />
              </div>
              <div className="flex flex-col min-w-0">
                  <span runway-id="bills.reserve.title" className="font-label-sm text-label-sm font-semibold text-on-surface">
                  Safe-to-spend reserve
                </span>
                <span runway-id="bills.reserve.description" className="text-body-sm text-on-surface-variant">See your current forecast</span>
              </div>
            </div>
            <Link runway-id="bills.reserve.link" href="/" className="min-h-11 shrink-0 flex items-center rounded-full bg-secondary-container/60 px-3 text-label-sm text-primary font-semibold">Runway <ArrowRight size={14} className="ml-1" aria-hidden="true" /></Link>
          </section>

          {/* Add Recurring Obligation Button */}
          <button
            type="button"
            onClick={() => setIsAddBillOpen(true)}
            runway-id="bills.action.add" className="w-full min-h-12 rounded-full bg-white/85 border border-white shadow-sm text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-2 hover:bg-white active:scale-[0.99] transition-colors"
          >
            <CirclePlus size={18} aria-hidden="true" />
            Add Recurring Obligation
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
      <Dialog open={isAddBillOpen} onClose={() => setIsAddBillOpen(false)} title="New recurring obligation">
          <form
            onSubmit={handleCreateBill}
              runway-id="bills.add.form" className="flex flex-col space-y-4"
          >

            <div className="flex flex-col space-y-1">
              <label runway-id="bills.add.name.label" htmlFor="bill-name" className="font-label-sm text-label-sm text-on-surface-variant">
                Obligation Name
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
                Monthly Amount (₱)
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

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col space-y-1">
                <label runway-id="bills.add.due-day.label" htmlFor="bill-day" className="font-label-sm text-label-sm text-on-surface-variant">
                  Due Day of Month
                </label>
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
              </div>

              <div className="flex flex-col space-y-1">
                <label runway-id="bills.add.grace.label" htmlFor="bill-grace" className="font-label-sm text-label-sm text-on-surface-variant">
                  Grace Period (Days)
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

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAddBillOpen(false)}
                runway-id="bills.add.cancel" className="h-11 rounded-full bg-white/75 border border-primary/10 font-label-md text-label-md font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                runway-id="bills.add.save" className="h-11 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold"
              >
                Save Obligation
              </button>
            </div>
          </form>
      </Dialog>
      <Dialog open={detailBill !== null} onClose={() => setDetailBill(null)} title={detailBill?.name || "Bill details"}>
        {detailBill && <dl runway-id={`bills.details.content.${detailBill.instanceId}`} className="space-y-4 text-body-md">
          <div><dt runway-id={`bills.details.due-date.label.${detailBill.instanceId}`}>Due date</dt><dd runway-id={`bills.details.due-date.value.${detailBill.instanceId}`}>{detailBill.dueDate}</dd></div>
          <div><dt runway-id={`bills.details.grace.label.${detailBill.instanceId}`}>Grace period</dt><dd runway-id={`bills.details.grace.value.${detailBill.instanceId}`}>{detailBill.gracePeriodDays} days</dd></div>
          <div><dt runway-id={`bills.details.source.label.${detailBill.instanceId}`}>Source account</dt><dd runway-id={`bills.details.source.value.${detailBill.instanceId}`}>{detailBill.sourceAccountName || "Not specified"}</dd></div>
          <div><dt runway-id={`bills.details.balance.label.${detailBill.instanceId}`}>Wallet balance</dt><dd runway-id={`bills.details.balance.value.${detailBill.instanceId}`}>{detailBill.sourceAccountBalance == null ? "Not available" : formatPHP(detailBill.sourceAccountBalance)}</dd></div>
          <div><dt runway-id={`bills.details.autopay.label.${detailBill.instanceId}`}>Auto-pay</dt><dd runway-id={`bills.details.autopay.value.${detailBill.instanceId}`}>{detailBill.isAutoPay ? "Enabled" : "Manual payment"}</dd></div>
        </dl>}
      </Dialog>
    </div>
  );
}
