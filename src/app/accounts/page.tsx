"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { ReconcileModal } from "@/components/accounts/ReconcileModal";
import { formatPHP } from "@/lib/currency";
import { Dialog } from "@/components/ui/Dialog";

interface AccountItem {
  id: string;
  name: string;
  type: "liquid" | "revolving_credit" | "installment_loan";
  currency: string;
  currentBalance: number;
  creditLimit?: number | null;
  statementCutoffDay?: number | null;
  paymentDueDay?: number | null;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [reconcileAccount, setReconcileAccount] = useState<AccountItem | null>(null);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState<boolean>(false);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState<boolean>(false);
  const [detailAccount, setDetailAccount] = useState<AccountItem | null>(null);

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
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          type: newType,
          current_balance: Math.round((parseFloat(newBalance) || 0) * 100),
          credit_limit: newLimit ? Math.round(parseFloat(newLimit) * 100) : null,
          statement_cutoff_day: newCutoff ? parseInt(newCutoff, 10) : null,
          payment_due_day: newDueDay ? parseInt(newDueDay, 10) : null,
        }),
      });

      if (res.ok) {
        setIsAddAccountOpen(false);
        setNewName("");
        setNewBalance("");
        fetchAccounts();
      }
    } catch (err) {
      console.error("Failed to create account:", err);
    }
  };

  const liquidAccounts = accounts.filter((a) => a.type === "liquid");
  const creditAccounts = accounts.filter((a) => a.type === "revolving_credit");
  const loanAccounts = accounts.filter((a) => a.type === "installment_loan");

  const totalLiquid = liquidAccounts.reduce((acc, a) => acc + a.currentBalance, 0);
  const totalCreditDebt = creditAccounts.reduce((acc, a) => acc + a.currentBalance, 0);

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <Header title="Accounts Ledger" />

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] mx-auto min-h-screen">
        <div className="flex flex-col w-full px-margin pb-6 gap-space-lg select-none">
          {/* Top KPI Bento */}
          <div className="grid grid-cols-2 gap-2 pt-space-xs">
            <div className="glass-panel p-space-md flex flex-col">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Total Liquid Cash
              </span>
              <span className="font-currency-display text-headline-md text-secondary font-bold mt-1">
                {formatPHP(totalLiquid)}
              </span>
              <span className="font-body-sm text-[11px] text-on-surface-variant mt-0.5">
                {liquidAccounts.length} Connected Wallets
              </span>
            </div>

            <div className="glass-panel p-space-md flex flex-col">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Revolving Debt
              </span>
              <span className="font-currency-display text-headline-md text-error font-bold mt-1">
                {formatPHP(totalCreditDebt)}
              </span>
              <span className="font-body-sm text-[11px] text-on-surface-variant mt-0.5">
                {creditAccounts.length} Active Cards
              </span>
            </div>
          </div>

          {/* Section 1: Liquid Accounts */}
          <section className="flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-secondary text-[20px]">
                  account_balance
                </span>
                <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Liquid Assets &amp; Wallets
                </h2>
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant">
                Integer-cent safe
              </span>
            </div>

            <div className="flex flex-col space-y-space-xs">
              {liquidAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="glass-panel p-space-md flex items-center justify-between"
                >
                  <div className="flex items-center space-x-space-sm min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                      <span className="material-symbols-outlined text-[20px]">
                        {acc.name.toLowerCase().includes("maya") ||
                        acc.name.toLowerCase().includes("gcash")
                          ? "account_balance_wallet"
                          : acc.name.toLowerCase().includes("cash")
                          ? "payments"
                          : "account_balance"}
                      </span>
                    </div>
                    <div className="min-w-0 flex flex-col">
                      <span className="font-body-md text-body-md font-semibold text-on-surface truncate">
                        {acc.name}
                      </span>
                      <span className="font-body-sm text-body-sm text-on-surface-variant">
                        Liquid Checking / Savings
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-space-sm shrink-0">
                    <span className="font-currency-md text-currency-md font-bold text-on-surface">
                      {formatPHP(acc.currentBalance)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReconcileAccount(acc)}
                      title="Reconcile balance drift"
                      className="px-2.5 py-1 bg-surface-container-low hover:bg-surface-container text-secondary rounded-lg font-label-sm text-label-sm font-semibold flex items-center gap-1 active:scale-95 transition"
                    >
                      <span className="material-symbols-outlined text-[15px]">
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
          {creditAccounts.length > 0 && (
            <section className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-outline text-[20px]">
                    credit_card
                  </span>
                  <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                    Revolving Credit Cards
                  </h2>
                </div>
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  Cycle Tracking
                </span>
              </div>

              <div className="flex flex-col space-y-space-xs">
                {creditAccounts.map((acc) => {
                  return (
                    <div
                      key={acc.id}
                      className="glass-panel p-space-md flex flex-col gap-2"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center space-x-space-sm min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-outline shrink-0">
                            <span className="material-symbols-outlined text-[20px]">
                              credit_card
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="font-body-md text-body-md font-semibold text-on-surface">
                              {acc.name}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end">
                          <span className="font-currency-md text-currency-md font-bold text-error">
                            {formatPHP(acc.currentBalance)}
                          </span>
                          <span className="font-label-sm text-label-sm text-on-surface-variant">
                            Running Balance
                          </span>
                        </div>
                      </div>

                      <button type="button" onClick={() => setDetailAccount(acc)} className="min-h-11 text-secondary text-body-sm self-start">Details</button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Add Account Action */}
          <button
            type="button"
            onClick={() => setIsAddAccountOpen(true)}
            className="w-full h-12 glass-panel text-on-surface font-label-md text-label-md font-semibold flex items-center justify-center gap-2 hover:bg-surface-container-low active:scale-[0.99] transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">
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
      <Dialog open={isAddAccountOpen} onClose={() => setIsAddAccountOpen(false)} title="New account">
          <form
            onSubmit={handleCreateAccount}
            className="flex flex-col space-y-4"
          >

            <div className="flex flex-col space-y-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Account Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Maya Savings"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-10 px-3 rounded-lg border border-outline-variant/50 font-body-md text-body-md"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Account Type
              </label>
              <select
                value={newType}
                onChange={(e) =>
                  setNewType(
                    e.target.value as "liquid" | "revolving_credit" | "installment_loan"
                  )
                }
                className="h-10 px-3 rounded-lg border border-outline-variant/50 font-body-md text-body-md bg-white"
              >
                <option value="liquid">Liquid (Bank / E-Wallet / Cash)</option>
                <option value="revolving_credit">Revolving Credit Card</option>
                <option value="installment_loan">Fixed Installment Loan</option>
              </select>
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Initial Balance (₱)
              </label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                className="h-10 px-3 rounded-lg border border-outline-variant/50 font-currency-md text-currency-md"
              />
            </div>

            {newType === "revolving_credit" && (
              <>
                <div className="flex flex-col space-y-1">
                  <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                    Credit Limit (₱)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="50000.00"
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    className="h-10 px-3 rounded-lg border border-outline-variant/50 font-currency-md text-currency-md"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col space-y-1">
                    <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                      Cutoff Day
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      placeholder="18"
                      value={newCutoff}
                      onChange={(e) => setNewCutoff(e.target.value)}
                      className="h-10 px-3 rounded-lg border border-outline-variant/50 font-body-md text-body-md"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                      Due Day
                    </label>
                    <input
                      type="number"
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

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAddAccountOpen(false)}
                className="h-11 rounded-lg bg-surface-container-low font-label-md text-label-md font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-11 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-semibold"
              >
                Save Account
              </button>
            </div>
          </form>
      </Dialog>
      <Dialog open={detailAccount !== null} onClose={() => setDetailAccount(null)} title={detailAccount?.name || "Account details"}>
        {detailAccount && <dl className="space-y-4 text-body-md">
          <div><dt>Statement cutoff day</dt><dd>{detailAccount.statementCutoffDay || "—"}</dd></div>
          <div><dt>Payment due day</dt><dd>{detailAccount.paymentDueDay || "—"}</dd></div>
          <div><dt>Credit limit</dt><dd>{formatPHP(detailAccount.creditLimit || 0)}</dd></div>
          <div><dt>Available credit</dt><dd className="text-secondary">{formatPHP((detailAccount.creditLimit || 0) - detailAccount.currentBalance)}</dd></div>
        </dl>}
      </Dialog>
    </div>
  );
}
