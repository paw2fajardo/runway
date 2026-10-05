"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { SolvencyHero } from "@/components/runway/SolvencyHero";
import { RunwayTimeline } from "@/components/runway/RunwayTimeline";
import { LiquidAccountsStrip } from "@/components/runway/LiquidAccountsStrip";
import { UpcomingDuesList, DueItem } from "@/components/runway/UpcomingDuesList";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { ReconcileModal } from "@/components/accounts/ReconcileModal";
import { IncomeStreamCreateSchema, IncomeStreamPatchSchema, MAX_DAILY_DISCRETIONARY_BURN_CENTS, type PayScheduleKind, type IncomeStreamResponse, type IncomeStreamsResponse, type RunwayForecastResponse } from "@/lib/types";
import { Dialog } from "@/components/ui/Dialog";
import { formatPHP } from "@/lib/currency";
import { PendingPaychecks } from "@/components/payday/PendingPaychecks";

interface AccountData {
  id: string;
  name: string;
  type: string;
  currentBalance: number;
  creditLimit?: number | null;
  statementCutoffDay?: number | null;
}

export default function RunwayDashboard() {
  const [forecast, setForecast] = useState<RunwayForecastResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [dues, setDues] = useState<DueItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState<boolean>(false);
  const [reconcileAccount, setReconcileAccount] = useState<AccountData | null>(null);
  const [isForecastOpen, setIsForecastOpen] = useState(false);
  const [isBalancesOpen, setIsBalancesOpen] = useState(false);
  const [isDuesOpen, setIsDuesOpen] = useState(false);
  const [accountsAvailable, setAccountsAvailable] = useState(false);
  const [duesAvailable, setDuesAvailable] = useState(false);
  const balancesTrigger = useRef<HTMLButtonElement>(null);
  const [incomeStreams, setIncomeStreams] = useState<IncomeStreamResponse[] | null>(null);
  const [isPaySettingsLoading, setIsPaySettingsLoading] = useState(true);
  const [paySettingsError, setPaySettingsError] = useState<string | null>(null);
  const [incomeDialog, setIncomeDialog] = useState<"manage" | "form" | null>(null);
  const [editingStream, setEditingStream] = useState<IncomeStreamResponse | null>(null);
  const [streamNameInput, setStreamNameInput] = useState("");
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
  const [streamActionId, setStreamActionId] = useState<string | null>(null);
  const incomeDialogFrame = useRef<number | null>(null);
  const [netPayInput, setNetPayInput] = useState("");
  const [payDestinationAccountId, setPayDestinationAccountId] = useState("");
  const [payDateInput, setPayDateInput] = useState("");
  const [payScheduleKind, setPayScheduleKind] = useState<PayScheduleKind | "calendar">("biweekly");
  const [payIntervalInput, setPayIntervalInput] = useState("14");
  const [isPaySaving, setIsPaySaving] = useState(false);
  const [payFormError, setPayFormError] = useState<string | null>(null);
  const [plannedSpendingInput, setPlannedSpendingInput] = useState("");
  const [isPlannedSpendingLoading, setIsPlannedSpendingLoading] = useState(true);
  const [isPlannedSpendingSaving, setIsPlannedSpendingSaving] = useState(false);
  const [plannedSpendingError, setPlannedSpendingError] = useState<string | null>(null);
  const [plannedSpendingWarning, setPlannedSpendingWarning] = useState<string | null>(null);

  const fetchPlannedSpending = useCallback(async () => {
    setIsPlannedSpendingLoading(true);
    try {
      const response = await fetch("/api/runway/settings");
      const data = await response.json();
      if (!response.ok || !Number.isSafeInteger(data.daily_discretionary_burn_cents) || data.daily_discretionary_burn_cents < 0) {
        throw new Error("Planned spending is unavailable. Please retry.");
      }
      const cents = String(data.daily_discretionary_burn_cents).padStart(3, "0");
      setPlannedSpendingInput(`${cents.slice(0, -2)}.${cents.slice(-2)}`);
      setPlannedSpendingWarning(data.daily_discretionary_burn_cents > MAX_DAILY_DISCRETIONARY_BURN_CENTS
        ? `This saved amount is above the current limit of ${formatPHP(MAX_DAILY_DISCRETIONARY_BURN_CENTS)} per day. Edit it to an allowed amount before saving.`
        : null);
      setPlannedSpendingError(null);
    } catch (error) {
      setPlannedSpendingError(error instanceof Error ? error.message : "Planned spending is unavailable. Please retry.");
    } finally {
      setIsPlannedSpendingLoading(false);
    }
  }, []);

  const fetchPaySettings = useCallback(async () => {
    setIsPaySettingsLoading(true);
    try {
      const response = await fetch("/api/runway/income-streams");
      const data = await response.json();
      if (!response.ok) throw new Error(data.code === "PAY_SCHEDULE_MIGRATION_REQUIRED"
        ? "Income streams need a database update before they can be saved."
        : "Income streams are unavailable. Please retry.");
      setIncomeStreams((data as IncomeStreamsResponse).streams);
      setPaySettingsError(null);
    } catch (error) {
      setPaySettingsError(error instanceof Error ? error.message : "Income streams are unavailable. Please retry.");
    } finally {
      setIsPaySettingsLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    // Settings failures are isolated from the existing account/bill/forecast data.
    const settingsRequest = fetchPaySettings();
    const plannedSpendingRequest = fetchPlannedSpending();
    try {
      const [forecastRes, accountsRes, billsRes] = await Promise.all([
        fetch("/api/runway/forecast"),
        fetch("/api/accounts"),
        fetch("/api/bills"),
      ]);

      if (forecastRes.ok) {
        const fData = await forecastRes.json();
        setForecast(fData);
      } else setForecast(null);
      if (accountsRes.ok) {
        const aData = await accountsRes.json();
        setAccounts(aData);
        setAccountsAvailable(true);
      } else setAccountsAvailable(false);
      if (billsRes.ok) {
        const bData = await billsRes.json();
        const mappedDues: DueItem[] = bData.map((b: {
          instanceId: string;
          name: string;
          dueDate: string;
          amountDue: number;
          status: string;
          isAutoPay?: boolean;
          sourceAccountName?: string | null;
        }) => ({
          id: b.instanceId,
          name: b.name,
          dueDate: b.dueDate,
          amountDue: b.amountDue,
          status: b.status,
          isAutoPay: b.isAutoPay,
          sourceAccountName: b.sourceAccountName,
        }));
        setDues(mappedDues);
        setDuesAvailable(true);
      } else setDuesAvailable(false);
    } catch (err) {
      console.error("Dashboard data fetch failed:", err);
      setForecast(null);
      setAccountsAvailable(false);
      setDuesAvailable(false);
    } finally {
      setIsLoading(false);
      await settingsRequest;
      await plannedSpendingRequest;
    }
  }, [fetchPaySettings, fetchPlannedSpending]);

  const transitionIncomeDialog = (next: "manage" | "form") => {
    setIncomeDialog(null);
    if (incomeDialogFrame.current !== null) cancelAnimationFrame(incomeDialogFrame.current);
    incomeDialogFrame.current = requestAnimationFrame(() => {
      incomeDialogFrame.current = requestAnimationFrame(() => { setIncomeDialog(next); incomeDialogFrame.current = null; });
    });
  };
  useEffect(() => () => { if (incomeDialogFrame.current !== null) cancelAnimationFrame(incomeDialogFrame.current); }, []);

  const openPaySettings = (stream: IncomeStreamResponse | null = null) => {
    setEditingStream(stream);
    setStreamNameInput(stream?.name ?? "");
    const cents = stream ? String(stream.net_pay_cents).padStart(3, "0") : null;
    setNetPayInput(cents ? `${cents.slice(0, -2)}.${cents.slice(-2)}` : "");
    setPayDateInput(stream ? stream.payday_anchor ?? stream.next_pay_date : "");
    setPayScheduleKind(stream?.schedule_kind ?? "biweekly");
    setPayIntervalInput(String(stream?.interval_days ?? 14));
    setPayDestinationAccountId(stream?.destination_account_id ?? "");
    setPayFormError(null);
    transitionIncomeDialog("form");
  };

  const scheduleDescription = (stream: IncomeStreamResponse) => stream.schedule_kind === "weekly" ? "Weekly"
    : stream.schedule_kind === "biweekly" ? "Every 2 weeks"
    : stream.schedule_kind === "monthly" ? "Monthly"
    : stream.schedule_kind === "custom" ? `Every ${stream.interval_days} days`
    : `Calendar days ${stream.salary_cycle_days}`;

  const handleToggleStream = async (stream: IncomeStreamResponse) => {
    if (streamActionId || isPaySaving) return;
    setStreamActionId(stream.id); setStreamActionError(null);
    try {
      const response = await fetch(`/api/runway/income-streams/${stream.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_enabled: !stream.is_enabled }) });
      if (!response.ok) throw new Error("Unable to change this income stream. Please retry.");
      const saved = await response.json() as IncomeStreamResponse;
      setIncomeStreams(current => current?.map(item => item.id === saved.id ? saved : item) ?? [saved]);
      await fetchData();
    } catch (error) { setStreamActionError(error instanceof Error ? error.message : "Unable to update income stream."); }
    finally { setStreamActionId(null); }
  };

  const handleSavePay = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPaySaving) return;
    if (!payDestinationAccountId || !accounts.some(account => account.id === payDestinationAccountId && account.type === "liquid")) {
      setPayFormError("Choose an active liquid destination account.");
      return;
    }
    const amount = netPayInput.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    const cents = amount ? Number(`${amount[1]}${(amount[2] || "").padEnd(2, "0")}`) : NaN;
    const values = { name: streamNameInput, net_pay_cents: cents, destination_account_id: payDestinationAccountId,
      ...(payScheduleKind !== "calendar" ? { next_pay_date: payDateInput, schedule_kind: payScheduleKind,
        ...(payScheduleKind === "custom" ? { interval_days: /^\d+$/.test(payIntervalInput) ? Number(payIntervalInput) : NaN } : {}) } : {}),
    };
    const parsed = editingStream ? IncomeStreamPatchSchema.safeParse(values) : IncomeStreamCreateSchema.safeParse(values);
    if (!parsed.success) {
      setPayFormError("Enter a name, positive take-home pay with up to two decimal places, a valid date, and 1–366 whole days for a custom interval.");
      return;
    }
    setIsPaySaving(true);
    setPayFormError(null);
    try {
      const response = await fetch(editingStream ? `/api/runway/income-streams/${editingStream.id}` : "/api/runway/income-streams", {
        method: editingStream ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code === "PAY_SCHEDULE_MIGRATION_REQUIRED"
        ? "Income streams need a database update before they can be saved. Your changes have not been saved."
        : "Unable to save this income stream. Please retry.");
      const saved = data as IncomeStreamResponse;
      setIncomeStreams(current => editingStream ? current?.map(item => item.id === saved.id ? saved : item) ?? [saved] : [...(current ?? []), saved]);
      setPaySettingsError(null);
      transitionIncomeDialog("manage");
      await fetchData();
    } catch (error) {
      setPayFormError(error instanceof Error ? error.message : "Unable to save this income stream. Please retry.");
    } finally {
      setIsPaySaving(false);
    }
  };

  const handleSavePlannedSpending = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPlannedSpendingSaving || isPlannedSpendingLoading) return;
    const amount = plannedSpendingInput.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    const cents = amount ? Number(`${amount[1]}${(amount[2] || "").padEnd(2, "0")}`) : NaN;
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_DAILY_DISCRETIONARY_BURN_CENTS) {
      setPlannedSpendingError(`Enter a nonnegative amount in PHP with up to two decimal places, no more than ${formatPHP(MAX_DAILY_DISCRETIONARY_BURN_CENTS)} per day.`);
      return;
    }
    setIsPlannedSpendingSaving(true);
    setPlannedSpendingError(null);
    try {
      const response = await fetch("/api/runway/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_discretionary_burn_cents: cents }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to save planned spending. Please retry.");
      await fetchData();
    } catch (error) {
      setPlannedSpendingError(error instanceof Error ? error.message : "Unable to save planned spending. Please retry.");
    } finally {
      setIsPlannedSpendingSaving(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePayBill = async (due: DueItem) => {
    try {
      const res = await fetch(`/api/bills/${due.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Payment failed:", err);
    }
  };

  const handleReconcileClick = (accountId: string) => {
    const acc = accounts.find((a) => a.id === accountId);
    if (acc) {
      setIsBalancesOpen(false);
      setReconcileAccount(acc);
    }
  };

  const unpaidDues = dues.filter((due) => due.status !== "paid" && due.status !== "auto_debited");
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const warningDues = unpaidDues.filter((due) =>
    due.status === "grace_period" || due.status === "past_due" || due.status === "due_today" ||
    (/^\d{4}-\d{2}-\d{2}$/.test(due.dueDate) && due.dueDate <= todayDate)
  );
  const ordinaryDues = unpaidDues.filter((due) => !warningDues.includes(due)).slice(0, 2);
  const negativeDay = forecast?.timeline.find((day) => day.balance < 0);
  const enabledIncomeStreams = incomeStreams?.filter(stream => stream.is_enabled) ?? [];
  const activeLiquidAccounts = accounts.filter(account => account.type === "liquid");
  const destinationAccountName = (id: string | null) => activeLiquidAccounts.find(account => account.id === id)?.name ?? (id ? "Unavailable account" : "No account selected");
  const nextIncomeDate = enabledIncomeStreams.map(stream => stream.next_pay_date).sort()[0];
  const paydayDateStr = forecast?.next_payday_date
    ? new Date(`${forecast.next_payday_date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "Unavailable";

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <Header />

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] mx-auto min-h-screen">
        <div className="flex flex-col w-full px-margin gap-6 pb-space-xl">
          <div className="space-y-2 pt-2">
            <h1 runway-id="runway.dashboard.title" className="text-headline-lg font-semibold tracking-tight">Cash Runway</h1>
            <p runway-id="runway.dashboard.description" className="text-body-md text-on-surface-variant">Your liquidity overview, before the next income.</p>
          </div>
          {/* Solvency Hero Card */}
          {forecast ? <SolvencyHero
            safeToSpend={forecast.net_projected_buffer}
            dailyAllowance={forecast.daily_allowance}
            liquidCash={forecast.current_liquid_cash}
            upcomingDues={forecast.scheduled_bills_total}
            plannedSpending={forecast.discretionary_burn_total}
            daysToPayday={forecast.days_to_payday}
            paydayDateStr={paydayDateStr}
            isSolvent={forecast.is_solvent}
          /> : <div runway-id="runway.dashboard.forecast-status" className="forest-panel p-6 text-body-md" role="status">
            {isLoading ? "Loading your runway…" : "Runway forecast unavailable."}
            {!isLoading && <button runway-id="runway.dashboard.forecast-retry" type="button" onClick={fetchData} className="block min-h-11 mt-4 px-5 rounded-full bg-white text-primary font-semibold">Retry</button>}
          </div>}

          {negativeDay && <p runway-id="runway.dashboard.forecast-warning" className="rounded-xl bg-error-container p-4 text-on-error-container text-body-md" role="status">
            Forecast warning: your balance falls below zero on {negativeDay.date}.
          </p>}

          <PendingPaychecks />

          <section className="glass-panel p-5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h2 runway-id="runway.dashboard.income-title" className="text-body-md font-semibold">Income streams</h2>
              <button runway-id="runway.dashboard.manage-income" type="button" onClick={() => { setStreamActionError(null); setIncomeDialog("manage"); }} disabled={isPaySaving || !!streamActionId}
                className="min-h-11 px-4 rounded-full bg-white/70 border border-primary/10 text-secondary text-body-md font-semibold disabled:opacity-50">
                Manage
              </button>
            </div>
            {isPaySettingsLoading ? <p runway-id="runway.dashboard.income-loading" className="text-body-sm text-on-surface-variant" role="status">Loading income streams…</p>
              : paySettingsError ? <div>
                <p runway-id="runway.dashboard.income-error" className="text-body-sm text-error" role="alert">{paySettingsError}</p>
                <button runway-id="runway.dashboard.income-retry" type="button" onClick={fetchPaySettings} className="min-h-11 text-secondary text-body-md">Retry</button>
              </div> : incomeStreams ? <div className="space-y-1">
                <p runway-id="runway.dashboard.enabled-income-count" className="text-body-md">{enabledIncomeStreams.length} enabled income {enabledIncomeStreams.length === 1 ? "stream" : "streams"}</p>
                <p runway-id="runway.dashboard.next-income-summary" className="text-body-sm text-on-surface-variant">{nextIncomeDate ? `Next income: ${nextIncomeDate}` : "Add or resume an income stream to calculate your forecast."}</p>
              </div> : <p runway-id="runway.dashboard.income-empty" className="text-body-sm text-on-surface-variant">Add your income streams to forecast your cash flow.</p>}
          </section>

          <div className="glass-panel divide-y divide-outline-variant/20">
            <button runway-id="runway.dashboard.open-forecast" type="button" onClick={() => setIsForecastOpen(true)} disabled={!forecast || isLoading}
              className="w-full min-h-14 p-5 flex justify-between items-center gap-3 text-body-md disabled:opacity-50">
              <span runway-id="runway.dashboard.open-forecast-label" className="font-semibold">14-day forecast</span><span runway-id="runway.dashboard.open-forecast-action" className="text-secondary">View →</span>
            </button>
            <button runway-id="runway.dashboard.open-balances" ref={balancesTrigger} type="button" onClick={() => setIsBalancesOpen(true)} disabled={!accountsAvailable || isLoading}
              className="w-full min-h-14 p-5 flex justify-between items-center gap-3 text-body-md disabled:opacity-50">
              <span runway-id="runway.dashboard.open-balances-label" className="font-semibold">Balances</span><span runway-id="runway.dashboard.open-balances-status" className="text-on-surface-variant">{isLoading ? "Loading…" : accountsAvailable ? `${accounts.length} accounts →` : "Unavailable"}</span>
            </button>
          </div>

          {duesAvailable ? <>
            {warningDues.length > 0 && <section className="space-y-3">
              <h2 runway-id="runway.dashboard.payment-warnings-title" className="text-body-md font-semibold text-error">Payment warnings · {warningDues.length}</h2>
              <UpcomingDuesList dues={warningDues} onPayClick={handlePayBill} idPrefix="runway.dashboard.payment-warnings" />
            </section>}
            {ordinaryDues.length > 0 && <UpcomingDuesList dues={ordinaryDues} onPayClick={handlePayBill} idPrefix="runway.dashboard.ordinary-dues" />}
            {unpaidDues.length === 0 && <p runway-id="runway.dashboard.no-upcoming-dues" className="text-body-md text-on-surface-variant">No upcoming dues.</p>}
            <button runway-id="runway.dashboard.all-upcoming-dues" type="button" onClick={() => setIsDuesOpen(true)} className="min-h-11 self-start text-secondary text-body-md font-semibold">All upcoming dues ({unpaidDues.length}) →</button>
          </> : <p runway-id="runway.dashboard.dues-unavailable" className="text-body-md text-on-surface-variant" role="status">{isLoading ? "Loading upcoming dues…" : "Upcoming dues unavailable."}</p>}
        </div>
      </main>

      <Dialog open={incomeDialog === "manage"} onClose={() => { if (!streamActionId) setIncomeDialog(null); }} title="Income streams">
        <div className="space-y-5">
          <form runway-id="runway.income-manage.planned-spending-form" onSubmit={handleSavePlannedSpending} className="rounded-[24px] bg-surface-container-low p-4 space-y-3" noValidate>
            <div className="space-y-2">
              <label runway-id="runway.income-manage.planned-spending-label" htmlFor="planned-spending-input" className="block text-body-md font-semibold">Planned spending per day (PHP)</label>
              <input runway-id="runway.income-manage.planned-spending-input" id="planned-spending-input" type="text" inputMode="decimal" value={plannedSpendingInput} maxLength={24} disabled={isPlannedSpendingLoading || isPlannedSpendingSaving}
                onChange={event => {
                  const value = event.target.value;
                  setPlannedSpendingInput(value);
                  const amount = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
                  const cents = amount ? Number(`${amount[1]}${(amount[2] || "").padEnd(2, "0")}`) : NaN;
                  setPlannedSpendingWarning(Number.isSafeInteger(cents) && cents > MAX_DAILY_DISCRETIONARY_BURN_CENTS
                    ? `This amount is above the current limit of ${formatPHP(MAX_DAILY_DISCRETIONARY_BURN_CENTS)} per day.`
                    : null);
                }} aria-describedby="planned-spending-hint planned-spending-error planned-spending-warning"
                className="w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md disabled:opacity-50" />
              <p runway-id="runway.income-manage.planned-spending-hint" id="planned-spending-hint" className="text-body-sm text-on-surface-variant">This daily amount is included in your forecast until your next payday.</p>
              {plannedSpendingWarning && <p runway-id="runway.income-manage.planned-spending-warning" id="planned-spending-warning" className="text-on-surface-variant text-body-sm" role="status">{plannedSpendingWarning}</p>}
            </div>
            {isPlannedSpendingLoading ? <p runway-id="runway.income-manage.planned-spending-loading" role="status" className="text-body-sm text-on-surface-variant">Loading planned spending…</p> : null}
            {plannedSpendingError && <p runway-id="runway.income-manage.planned-spending-error" id="planned-spending-error" className="text-error text-body-md" role="alert">{plannedSpendingError}</p>}
            <div className="flex gap-3">
              <button runway-id="runway.income-manage.planned-spending-save" type="submit" disabled={isPlannedSpendingLoading || isPlannedSpendingSaving} className="min-h-11 px-5 rounded-full bg-primary text-white font-semibold disabled:opacity-50">{isPlannedSpendingSaving ? "Saving…" : "Save planned spending"}</button>
              {plannedSpendingError && !isPlannedSpendingLoading && !isPlannedSpendingSaving && <button runway-id="runway.income-manage.planned-spending-retry" type="button" onClick={fetchPlannedSpending} className="min-h-11 text-secondary font-semibold">Reload</button>}
            </div>
          </form>
          <button runway-id="runway.income-manage.add" type="button" disabled={isPaySettingsLoading || !!streamActionId} onClick={() => openPaySettings()} className="min-h-11 px-5 rounded-full bg-primary text-white font-semibold disabled:opacity-50">Add income stream</button>
          {streamActionError && <p runway-id="runway.income-manage.action-error" className="text-error text-body-md" role="alert">{streamActionError}</p>}
          {isPaySettingsLoading ? <p runway-id="runway.income-manage.loading" role="status">Loading income streams…</p> : paySettingsError ? <div>
            <p runway-id="runway.income-manage.error" role="alert" className="text-error text-body-md">{paySettingsError}</p>
            <button runway-id="runway.income-manage.retry" type="button" onClick={fetchPaySettings} className="min-h-11 text-secondary font-semibold">Retry</button>
          </div> : incomeStreams?.length ? incomeStreams.map(stream => <div key={stream.id} runway-id={`runway.income-manage.stream.${stream.id}`} className="rounded-[24px] bg-surface-container-low p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 runway-id={`runway.income-manage.stream.${stream.id}.name`} className="text-body-md font-semibold break-words min-w-0">{stream.name}</h3>
              <span runway-id={`runway.income-manage.stream.${stream.id}.status`} className="rounded-full bg-white/70 px-3 py-1 text-label-sm">{stream.is_enabled ? "Enabled" : "Paused"}</span>
            </div>
            <p runway-id={`runway.income-manage.stream.${stream.id}.amount`} className="font-currency-md font-semibold">{formatPHP(stream.net_pay_cents)} <span runway-id={`runway.income-manage.stream.${stream.id}.amount-period`} className="font-body-sm text-body-sm font-normal">per payment</span></p>
            <p runway-id={`runway.income-manage.stream.${stream.id}.schedule`} className="text-body-sm text-on-surface-variant">{scheduleDescription(stream)} · {stream.is_enabled ? "Next income" : "Scheduled date"}: {stream.next_pay_date}</p>
            <p runway-id={`runway.income-manage.stream.${stream.id}.destination`} className="text-body-sm text-on-surface-variant">Deposits to {destinationAccountName(stream.destination_account_id)}</p>
            <div className="flex flex-wrap gap-3">
              <button runway-id={`runway.income-manage.stream.${stream.id}.edit`} type="button" disabled={!!streamActionId} onClick={() => openPaySettings(stream)} aria-label={`Edit ${stream.name}`} className="min-h-11 px-4 rounded-full bg-white/80 text-secondary font-semibold disabled:opacity-50">Edit</button>
              <button runway-id={`runway.income-manage.stream.${stream.id}.toggle`} type="button" disabled={!!streamActionId} onClick={() => handleToggleStream(stream)} aria-label={`${stream.is_enabled ? "Pause" : "Resume"} ${stream.name}`} className="min-h-11 px-4 rounded-full bg-white/80 text-secondary font-semibold disabled:opacity-50">{streamActionId === stream.id ? "Saving…" : stream.is_enabled ? "Pause" : "Resume"}</button>
            </div>
          </div>) : <p runway-id="runway.income-manage.empty" className="text-body-md">No income streams yet. Add one to start forecasting.</p>}
        </div>
      </Dialog>
      <Dialog open={incomeDialog === "form"} onClose={() => { if (!isPaySaving) transitionIncomeDialog("manage"); }} title={editingStream ? "Edit income stream" : "Add income stream"}>
        <form onSubmit={handleSavePay} className="space-y-5" noValidate>
          <div className="space-y-2">
            <label runway-id="runway.income-form.name-label" htmlFor="income-name-input" className="block text-body-md font-semibold">Income name</label>
            <input runway-id="runway.income-form.name" id="income-name-input" type="text" value={streamNameInput} maxLength={100} onChange={event => setStreamNameInput(event.target.value)}
              className="w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md" />
          </div>
          <div className="space-y-2">
            <label runway-id="runway.income-form.net-pay-label" htmlFor="net-pay-input" className="block text-body-md font-semibold">Take-home pay (PHP)</label>
            <input runway-id="runway.income-form.net-pay" id="net-pay-input" type="text" inputMode="decimal" value={netPayInput} maxLength={24}
              onChange={(event) => setNetPayInput(event.target.value)} aria-describedby="net-pay-hint"
              className="w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md" />
            <p runway-id="runway.income-form.net-pay-hint" id="net-pay-hint" className="text-body-sm text-on-surface-variant">The amount deposited after deductions, per payment.</p>
          </div>
          <div className="space-y-2">
            <label runway-id="runway.income-form.destination-label" htmlFor="income-destination-input" className="block text-body-md font-semibold">Deposit account</label>
            <select runway-id="runway.income-form.destination" id="income-destination-input" required value={payDestinationAccountId}
              disabled={!accountsAvailable || activeLiquidAccounts.length === 0 || isPaySaving}
              onChange={event => setPayDestinationAccountId(event.target.value)} aria-describedby="income-destination-hint"
              className="w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md disabled:opacity-50">
              <option runway-id="runway.income-form.destination.placeholder" value="">Choose an account</option>
              {activeLiquidAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <p runway-id="runway.income-form.destination-hint" id="income-destination-hint" className="text-body-sm text-on-surface-variant">
              {accountsAvailable ? activeLiquidAccounts.length ? "Only active liquid accounts can receive income." : "Add an active liquid account before setting up income streams." : "Active liquid accounts are unavailable. Reload the page and try again."}
            </p>
          </div>
          <div className="space-y-2">
            <label runway-id="runway.income-form.schedule-label" htmlFor="pay-schedule-input" className="block text-body-md font-semibold">Pay schedule</label>
            <select runway-id="runway.income-form.schedule" id="pay-schedule-input" value={payScheduleKind} onChange={(event) => setPayScheduleKind(event.target.value as PayScheduleKind | "calendar")}
              className="w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md">
              <option runway-id="runway.income-form.schedule.weekly" value="weekly">Weekly</option>
              <option runway-id="runway.income-form.schedule.biweekly" value="biweekly">Every 2 weeks</option>
              <option runway-id="runway.income-form.schedule.monthly" value="monthly">Monthly</option>
              <option runway-id="runway.income-form.schedule.custom" value="custom">Custom interval</option>
              {editingStream?.schedule_kind === "calendar" && <option runway-id="runway.income-form.schedule.calendar" value="calendar">Keep existing calendar schedule</option>}
            </select>
          </div>
          {payScheduleKind === "custom" && <div className="space-y-2">
            <label runway-id="runway.income-form.interval-label" htmlFor="pay-interval-input" className="block text-body-md font-semibold">Every N days</label>
            <input runway-id="runway.income-form.interval" id="pay-interval-input" type="number" inputMode="numeric" min="1" max="366" step="1" value={payIntervalInput}
              onChange={(event) => setPayIntervalInput(event.target.value)} aria-describedby="pay-interval-hint"
              className="w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md" />
            <p runway-id="runway.income-form.interval-hint" id="pay-interval-hint" className="text-body-sm text-on-surface-variant">Choose 1–366 whole days.</p>
          </div>}
          {payScheduleKind !== "calendar" && <div className="space-y-2">
            <label runway-id="runway.income-form.date-label" htmlFor="pay-date-input" className="block text-body-md font-semibold">Schedule start date</label>
            <input runway-id="runway.income-form.date" id="pay-date-input" type="date" value={payDateInput} onChange={(event) => setPayDateInput(event.target.value)}
              aria-describedby="pay-date-hint"
              className="w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md" />
          </div>}
          <p runway-id="runway.income-form.date-hint" id="pay-date-hint" className="text-body-sm text-on-surface-variant">{payScheduleKind === "calendar" ? `Keeps calendar days ${editingStream?.salary_cycle_days}.` : payScheduleKind === "monthly"
            ? "Repeats on this day each month, using the last day in shorter months. The original day is preserved."
            : "Repeats from this date at your selected interval."} {payScheduleKind !== "calendar" && "A past date rolls forward to the next income date."}</p>
          {editingStream?.schedule_kind === "calendar" && payScheduleKind !== "calendar" && <p runway-id="runway.income-form.calendar-notice" className="text-body-sm text-on-surface-variant">Saving replaces this stream’s calendar schedule with the selected schedule.</p>}
          <p runway-id="runway.income-form.disclaimer" className="text-body-sm text-on-surface-variant">Runway automatically credits this account on or after payday the next time it processes a request. Paydays during a pause are skipped.</p>
          {payFormError && <p runway-id="runway.income-form.error" className="text-body-md text-error" role="alert">{payFormError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <button runway-id="runway.income-form.cancel" type="button" disabled={isPaySaving} onClick={() => transitionIncomeDialog("manage")} className="min-h-11 rounded-full bg-surface-container-low text-body-md disabled:opacity-50">Cancel</button>
            <button runway-id="runway.income-form.save" type="submit" disabled={isPaySaving} className="min-h-11 rounded-full bg-primary text-white text-body-md font-semibold disabled:opacity-50">{isPaySaving ? "Saving…" : "Save stream"}</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={isForecastOpen} onClose={() => setIsForecastOpen(false)} title="14-day forecast">
        {forecast?.timeline.length ? <RunwayTimeline timeline={forecast.timeline} nextCycleDateStr={paydayDateStr} />
          : <p runway-id="runway.forecast-unavailable" className="text-body-md">{forecast ? "No forecast days available." : "Forecast unavailable."}</p>}
      </Dialog>
      <Dialog open={isBalancesOpen} onClose={() => setIsBalancesOpen(false)} title="Balances" fullScreen>
        {!accountsAvailable ? <p runway-id="runway.balances-unavailable" className="text-body-md">Balances unavailable.</p> : accounts.length > 0
          ? <LiquidAccountsStrip accounts={accounts} onReconcileClick={handleReconcileClick} idPrefix="runway.balances" />
          : <p runway-id="runway.balances-empty" className="text-body-md">No accounts yet.</p>}
      </Dialog>
      <Dialog open={isDuesOpen} onClose={() => setIsDuesOpen(false)} title="All upcoming dues">
        {!duesAvailable ? <p runway-id="runway.all-dues.unavailable" className="text-body-md">Upcoming dues unavailable.</p> : unpaidDues.length > 0
          ? <UpcomingDuesList dues={unpaidDues} onPayClick={handlePayBill} idPrefix="runway.all-dues" />
          : <p runway-id="runway.all-dues.empty" className="text-body-md">No upcoming dues.</p>}
      </Dialog>

      {/* Bottom Tab Navigation */}
      <BottomNav onOpenQuickLog={() => setIsQuickLogOpen(true)} />

      {/* Rapid Expense Keypad Drawer */}
      {forecast ? <RapidExpenseDrawer
        isOpen={isQuickLogOpen}
        onClose={() => setIsQuickLogOpen(false)}
        onSuccess={fetchData}
        accounts={accounts}
        daysToPayday={Math.max(1, forecast.days_to_payday)}
      /> : <Dialog open={isQuickLogOpen} onClose={() => setIsQuickLogOpen(false)} title="Quick log">
        <p runway-id="runway.quick-log.unavailable" className="text-body-md" role="status">{isLoading ? "Loading your forecast…" : "Your forecast and daily allowance are unavailable. Retry to load them before logging an entry."}</p>
        <button runway-id="runway.quick-log.retry" type="button" onClick={fetchData} className="min-h-11 mt-4 text-secondary font-semibold">Retry</button>
      </Dialog>}

      {/* Reconcile Modal */}
      <ReconcileModal
        account={reconcileAccount}
        isOpen={reconcileAccount !== null}
        onClose={() => {
          setReconcileAccount(null);
          requestAnimationFrame(() => balancesTrigger.current?.focus());
        }}
        onSuccess={fetchData}
      />
    </div>
  );
}
