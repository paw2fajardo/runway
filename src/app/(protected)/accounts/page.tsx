"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { ReconcileModal } from "@/components/accounts/ReconcileModal";
import { formatPHP } from "@/lib/currency";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";

interface AccountItem {
  id: string;
  name: string;
  type: "liquid" | "revolving_credit" | "installment_loan";
  currency: string;
  currentBalance: number;
  initialBalance: number;
  creditLimit?: number | null;
  statementCutoffDay?: number | null;
  paymentDueDay?: number | null;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [isAccountsLoading, setIsAccountsLoading] = useState(true);
  const [reconcileAccount, setReconcileAccount] = useState<AccountItem | null>(null);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState<boolean>(false);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState<boolean>(false);
  const [detailAccount, setDetailAccount] = useState<AccountItem | null>(null);
  const [editAccount, setEditAccount] = useState<AccountItem | null>(null);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // New account form state
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"liquid" | "revolving_credit" | "installment_loan">("liquid");
  const [newBalance, setNewBalance] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [newCutoff, setNewCutoff] = useState("");
  const [newDueDay, setNewDueDay] = useState("");

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
      }
    } catch (err) {
      console.error("Failed to load accounts:", err);
    } finally {
      setIsAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setIsSaving(true);
    try {
      const isEditing = editAccount !== null;
      const res = await fetch(isEditing ? `/api/accounts/${editAccount.id}` : "/api/accounts", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          type: newType,
          credit_limit: newLimit ? Math.round(parseFloat(newLimit) * 100) : null,
          statement_cutoff_day: newCutoff ? parseInt(newCutoff, 10) : null,
          payment_due_day: newDueDay ? parseInt(newDueDay, 10) : null,
          ...(isEditing
            ? { initial_balance: Math.round((parseFloat(newBalance) || 0) * 100) }
            : { current_balance: Math.round((parseFloat(newBalance) || 0) * 100) }),
        }),
      });

      if (res.ok) {
        await fetchAccounts();
        setIsAddAccountOpen(false);
        setEditAccount(null);
        setNewName("");
        setNewBalance("");
        setNewLimit("");
        setNewCutoff("");
        setNewDueDay("");
      } else {
        const data = await res.json().catch(() => null);
        setFormError(data?.error || `Unable to ${isEditing ? "update" : "create"} account. Please try again.`);
      }
    } catch (err) {
      console.error("Failed to save account:", err);
      setFormError("Unable to save account. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const openEditAccount = (account: AccountItem) => {
    setEditAccount(account);
    setNewName(account.name);
    setNewType(account.type);
    setNewBalance(String(account.initialBalance / 100));
    setNewLimit(account.creditLimit == null ? "" : String(account.creditLimit / 100));
    setNewCutoff(account.statementCutoffDay == null ? "" : String(account.statementCutoffDay));
    setNewDueDay(account.paymentDueDay == null ? "" : String(account.paymentDueDay));
    setFormError("");
  };

  const closeAccountForm = () => {
    setIsAddAccountOpen(false);
    setEditAccount(null);
    setFormError("");
  };

  const openNewAccount = () => {
    setEditAccount(null);
    setNewName("");
    setNewType("liquid");
    setNewBalance("");
    setNewLimit("");
    setNewCutoff("");
    setNewDueDay("");
    setFormError("");
    setIsAddAccountOpen(true);
  };

  const liquidAccounts = accounts.filter((a) => a.type === "liquid");
  const creditAccounts = accounts.filter((a) => a.type === "revolving_credit");
  const loanAccounts = accounts.filter((a) => a.type === "installment_loan");

  const totalLiquid = liquidAccounts.reduce((acc, a) => acc + a.currentBalance, 0);
  const totalCreditDebt = creditAccounts.reduce((acc, a) => acc + a.currentBalance, 0);

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <Header title="Accounts" />

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] md:max-w-5xl mx-auto min-h-screen">
        <div className="flex flex-col w-full px-margin pb-6 gap-space-lg select-none">
          {/* Top KPI Bento */}
          <div className="grid grid-cols-2 gap-2 pt-space-xs">
            <div className="glass-panel min-h-[120px] p-space-md flex flex-col">
              <span runway-id="accounts.summary.liquid.label" className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Total Liquid Cash
              </span>
              <span runway-id="accounts.summary.liquid.total" className="font-currency-display text-headline-md text-secondary font-bold mt-1 min-h-[28px]">
                {isAccountsLoading ? <Skeleton className="h-7 w-32" /> : formatPHP(totalLiquid)}
              </span>
              <span runway-id="accounts.summary.liquid.count" className="font-body-sm text-[11px] text-on-surface-variant mt-0.5">
                {isAccountsLoading ? <Skeleton className="h-4 w-28" /> : `${liquidAccounts.length} Connected Wallets`}
              </span>
            </div>

            <div className="glass-panel min-h-[120px] p-space-md flex flex-col">
              <span runway-id="accounts.summary.credit.label" className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Revolving Debt
              </span>
              <span runway-id="accounts.summary.credit.total" className="font-currency-display text-headline-md text-error font-bold mt-1 min-h-[28px]">
                {isAccountsLoading ? <Skeleton className="h-7 w-32" /> : formatPHP(totalCreditDebt)}
              </span>
              <span runway-id="accounts.summary.credit.count" className="font-body-sm text-[11px] text-on-surface-variant mt-0.5">
                {isAccountsLoading ? <Skeleton className="h-4 w-24" /> : `${creditAccounts.length} Active Cards`}
              </span>
            </div>
          </div>

          <div className="grid gap-space-lg md:grid-cols-2">
          {/* Section 1: Liquid Accounts */}
          <section runway-id="accounts.liquid.section" className="flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span runway-id="accounts.liquid.icon" className="material-symbols-outlined text-secondary text-[20px]">
                  account_balance
                </span>
                <h2 runway-id="accounts.liquid.heading" className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Liquid Assets &amp; Wallets
                </h2>
              </div>
              <span runway-id="accounts.liquid.note" className="font-label-sm text-label-sm text-on-surface-variant">
                Integer-cent safe
              </span>
            </div>

            <div className="flex flex-col space-y-space-xs">
              {isAccountsLoading ? [0, 1].map((item) => <Skeleton key={item} className="h-[76px] w-full rounded-[28px]" />) : liquidAccounts.map((acc) => (
                <div
                  key={acc.id}
                  runway-id={`accounts.liquid.account.${acc.id}`}
                  className="glass-panel min-h-[76px] p-space-md flex items-center justify-between"
                >
                  <div className="flex items-center space-x-space-sm min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                      <span runway-id={`accounts.liquid.account.${acc.id}.icon`} className="material-symbols-outlined text-[20px]">
                        {acc.name.toLowerCase().includes("maya") ||
                        acc.name.toLowerCase().includes("gcash")
                          ? "account_balance_wallet"
                          : acc.name.toLowerCase().includes("cash")
                          ? "payments"
                          : "account_balance"}
                      </span>
                    </div>
                    <div className="min-w-0 flex flex-col">
                      <span runway-id={`accounts.liquid.account.${acc.id}.name`} className="font-body-md text-body-md font-semibold text-on-surface truncate">
                        {acc.name}
                      </span>
                      <span runway-id={`accounts.liquid.account.${acc.id}.type`} className="font-body-sm text-body-sm text-on-surface-variant">
                        Liquid Checking / Savings
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-space-sm shrink-0">
                    <span runway-id={`accounts.liquid.account.${acc.id}.balance`} className="font-currency-md text-currency-md font-bold text-on-surface">
                      {formatPHP(acc.currentBalance)}
                    </span>
                    <button type="button" runway-id={`accounts.liquid.account.${acc.id}.edit`} onClick={() => openEditAccount(acc)} className="min-h-11 px-2 text-secondary text-body-sm">Edit</button>
                    <button
                      type="button"
                      runway-id={`accounts.liquid.account.${acc.id}.reconcile`}
                      onClick={() => setReconcileAccount(acc)}
                      title="Reconcile balance drift"
                      className="px-2.5 py-1 bg-surface-container-low hover:bg-surface-container text-secondary rounded-lg font-label-sm text-label-sm font-semibold flex items-center gap-1 active:scale-95 transition"
                    >
                      <span runway-id={`accounts.liquid.account.${acc.id}.reconcile-icon`} className="material-symbols-outlined text-[15px]">
                        verified
                      </span>
                      Reconcile
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 2: Revolving Credit */}
          {(isAccountsLoading || creditAccounts.length > 0) && (
            <section runway-id="accounts.credit.section" className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span runway-id="accounts.credit.icon" className="material-symbols-outlined text-outline text-[20px]">
                    credit_card
                  </span>
                  <h2 runway-id="accounts.credit.heading" className="font-headline-sm text-headline-sm font-bold text-on-surface">
                    Revolving Credit Cards
                  </h2>
                </div>
                <span runway-id="accounts.credit.note" className="font-label-sm text-label-sm text-on-surface-variant">
                  Cycle Tracking
                </span>
              </div>

              <div className="flex flex-col space-y-space-xs">
                {isAccountsLoading ? [0, 1].map((item) => <Skeleton key={item} className="h-[144px] w-full rounded-[28px]" />) : creditAccounts.map((acc) => {
                  return (
                    <div
                      key={acc.id}
                      runway-id={`accounts.credit.account.${acc.id}`}
                      className="glass-panel min-h-[144px] p-space-md flex flex-col gap-2"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center space-x-space-sm min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-outline shrink-0">
                            <span runway-id={`accounts.credit.account.${acc.id}.icon`} className="material-symbols-outlined text-[20px]">
                              credit_card
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span runway-id={`accounts.credit.account.${acc.id}.name`} className="font-body-md text-body-md font-semibold text-on-surface">
                              {acc.name}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end">
                          <span runway-id={`accounts.credit.account.${acc.id}.balance`} className="font-currency-md text-currency-md font-bold text-error">
                            {formatPHP(acc.currentBalance)}
                          </span>
                          <span runway-id={`accounts.credit.account.${acc.id}.balance-label`} className="font-label-sm text-label-sm text-on-surface-variant">
                            Running Balance
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 self-start">
                        <button runway-id={`accounts.credit.account.${acc.id}.details`} type="button" onClick={() => setDetailAccount(acc)} className="min-h-11 text-secondary text-body-sm">Details</button>
                        <button runway-id={`accounts.credit.account.${acc.id}.edit`} type="button" onClick={() => openEditAccount(acc)} className="min-h-11 text-secondary text-body-sm">Edit</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          </div>

          {/* Add Account Action */}
          <button
            type="button"
            runway-id="accounts.add-account"
            onClick={openNewAccount}
            className="w-full h-12 glass-panel text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-2 hover:bg-surface-container-low active:scale-[0.99] transition-all"
          >
            <span runway-id="accounts.add-account.icon" className="material-symbols-outlined text-[20px]">
              account_balance
            </span>
            Add Financial Account
          </button>
        </div>
      </main>

      <BottomNav onOpenQuickLog={() => setIsQuickLogOpen(true)} />

      {/* Reconcile Modal */}
      <ReconcileModal
        account={reconcileAccount}
        isOpen={reconcileAccount !== null}
        onClose={() => setReconcileAccount(null)}
        onSuccess={fetchAccounts}
      />

      {/* Quick Log Drawer */}
      <RapidExpenseDrawer
        isOpen={isQuickLogOpen}
        onClose={() => setIsQuickLogOpen(false)}
        onSuccess={fetchAccounts}
        accounts={accounts}
      />

      {/* Add Account Modal */}
      <Dialog open={isAddAccountOpen || editAccount !== null} onClose={closeAccountForm} title={editAccount ? "Edit account" : "New account"}>
          <form
            onSubmit={handleCreateAccount}
            className="flex flex-col space-y-4"
          >

            <div className="flex flex-col space-y-1">
              <label runway-id="accounts.add.name.label" className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Account Name
              </label>
              <input
                type="text"
                runway-id={editAccount ? "accounts.edit.name.input" : "accounts.add.name.input"}
                required
                placeholder="e.g. Maya Savings"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-10 px-3 rounded-lg border border-outline-variant/50 font-body-md text-body-md"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label runway-id="accounts.add.type.label" className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Account Type
              </label>
              <select
                runway-id={editAccount ? "accounts.edit.type.select" : "accounts.add.type.select"}
                value={newType}
                onChange={(e) =>
                  setNewType(
                    e.target.value as "liquid" | "revolving_credit" | "installment_loan"
                  )
                }
                className="h-10 px-3 rounded-lg border border-outline-variant/50 font-body-md text-body-md bg-white"
              >
                <option runway-id="accounts.add.type.liquid" value="liquid">Liquid (Bank / E-Wallet / Cash)</option>
                <option runway-id="accounts.add.type.credit" value="revolving_credit">Revolving Credit Card</option>
                <option runway-id="accounts.add.type.loan" value="installment_loan">Fixed Installment Loan</option>
              </select>
            </div>

            <div className="flex flex-col space-y-1">
              <label runway-id={editAccount ? "accounts.edit.balance.label" : "accounts.add.balance.label"} className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Initial Balance (₱) {editAccount && <span className="normal-case">(opening balance correction)</span>}
              </label>
              <input
                type="number"
                runway-id={editAccount ? "accounts.edit.balance.input" : "accounts.add.balance.input"}
                step="0.01"
                required
                placeholder="0.00"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                className="h-10 px-3 rounded-lg border border-outline-variant/50 font-currency-md text-currency-md"
              />
              {editAccount && <span className="font-body-sm text-body-sm text-on-surface-variant">Updates the opening balance; the displayed running balance is recalculated from transactions and deposits.</span>}
            </div>

            {newType === "revolving_credit" && (
              <>
                <div className="flex flex-col space-y-1">
                  <label runway-id={editAccount ? "accounts.edit.limit.label" : "accounts.add.limit.label"} className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                    Credit Limit (₱)
                  </label>
                  <input
                    type="number"
                    runway-id={editAccount ? "accounts.edit.limit.input" : "accounts.add.limit.input"}
                    step="0.01"
                    placeholder="50000.00"
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    className="h-10 px-3 rounded-lg border border-outline-variant/50 font-currency-md text-currency-md"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col space-y-1">
                    <label runway-id="accounts.add.cutoff.label" className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                      Cutoff Day
                    </label>
                    <input
                      type="number"
                      runway-id={editAccount ? "accounts.edit.cutoff.input" : "accounts.add.cutoff.input"}
                      min="1"
                      max="31"
                      placeholder="18"
                      value={newCutoff}
                      onChange={(e) => setNewCutoff(e.target.value)}
                      className="h-10 px-3 rounded-lg border border-outline-variant/50 font-body-md text-body-md"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label runway-id="accounts.add.due-day.label" className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                      Due Day
                    </label>
                    <input
                      type="number"
                      runway-id={editAccount ? "accounts.edit.due-day.input" : "accounts.add.due-day.input"}
                      min="1"
                      max="31"
                      placeholder="8"
                      value={newDueDay}
                      onChange={(e) => setNewDueDay(e.target.value)}
                      className="h-10 px-3 rounded-lg border border-outline-variant/50 font-body-md text-body-md"
                    />
                  </div>
                </div>
              </>
            )}

            {formError && <p role="alert" className="text-error text-body-sm">{formError}</p>}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                runway-id="accounts.add.cancel"
                onClick={closeAccountForm}
                className="h-11 rounded-lg bg-surface-container-low font-label-md text-label-md font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                runway-id={editAccount ? "accounts.edit.save" : "accounts.add.save"}
                disabled={isSaving}
                className="h-11 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-semibold"
              >
                {isSaving ? "Saving…" : editAccount ? "Save Changes" : "Save Account"}
              </button>
            </div>
          </form>
      </Dialog>
      <Dialog open={detailAccount !== null} onClose={() => setDetailAccount(null)} title={detailAccount?.name || "Account details"}>
        {detailAccount && <dl className="space-y-4 text-body-md">
          <div><dt runway-id={`accounts.details.${detailAccount.id}.cutoff.label`}>Statement cutoff day</dt><dd runway-id={`accounts.details.${detailAccount.id}.cutoff.value`}>{detailAccount.statementCutoffDay || "—"}</dd></div>
          <div><dt runway-id={`accounts.details.${detailAccount.id}.due-day.label`}>Payment due day</dt><dd runway-id={`accounts.details.${detailAccount.id}.due-day.value`}>{detailAccount.paymentDueDay || "—"}</dd></div>
          <div><dt runway-id={`accounts.details.${detailAccount.id}.credit-limit.label`}>Credit limit</dt><dd runway-id={`accounts.details.${detailAccount.id}.credit-limit.value`}>{formatPHP(detailAccount.creditLimit || 0)}</dd></div>
          <div><dt runway-id={`accounts.details.${detailAccount.id}.available-credit.label`}>Available credit</dt><dd runway-id={`accounts.details.${detailAccount.id}.available-credit.value`} className="text-secondary">{formatPHP((detailAccount.creditLimit || 0) - detailAccount.currentBalance)}</dd></div>
        </dl>}
      </Dialog>
    </div>
  );
}
