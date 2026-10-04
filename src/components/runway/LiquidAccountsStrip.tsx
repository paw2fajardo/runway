"use client";

import React from "react";
import Link from "next/link";
import { formatPHP, formatCompactPHP } from "@/lib/currency";

interface AccountItem {
  id: string;
  name: string;
  type: string;
  currentBalance: number;
  creditLimit?: number | null;
  statementCutoffDay?: number | null;
}

interface LiquidAccountsStripProps {
  accounts: AccountItem[];
  onReconcileClick?: (accountId: string) => void;
}

export function LiquidAccountsStrip({
  accounts,
  onReconcileClick,
}: LiquidAccountsStripProps) {
  return (
    <section className="flex flex-col space-y-space-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
          Liquid Balances
        </h2>
        <Link
          href="/accounts"
          className="font-label-md text-label-md min-h-11 inline-flex items-center px-3 rounded-full text-secondary hover:underline font-semibold"
        >
          Manage
        </Link>
      </div>

      {/* Horizontal Swipe Cards */}
      <div className="flex space-x-space-sm overflow-x-auto pb-1 -mx-margin px-margin scrollbar-none snap-x snap-mandatory">
        {accounts.map((acc) => {
          const isCredit = acc.type === "revolving_credit";
          return (
            <div
              key={acc.id}
              className="min-w-[210px] glass-panel p-5 flex flex-col justify-between space-y-space-md shrink-0 snap-start"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      isCredit
                        ? "bg-surface-container text-outline"
                        : acc.name.toLowerCase().includes("maya")
                        ? "bg-surface-container text-secondary"
                        : "bg-surface-container text-primary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {isCredit
                        ? "credit_card"
                        : acc.name.toLowerCase().includes("maya")
                        ? "account_balance_wallet"
                        : "account_balance"}
                    </span>
                  </div>
                  <span className="font-label-md text-label-md font-semibold text-on-surface truncate max-w-[120px]">
                    {acc.name}
                  </span>
                </div>

                {isCredit ? (
                  <span className="inline-flex px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant text-[10px] font-semibold">
                    Credit
                  </span>
                ) : null}
              </div>

              <div>
                <span
                  className={`font-currency-lg text-currency-lg font-bold ${
                    isCredit ? "text-error" : "text-on-surface"
                  }`}
                >
                  {formatPHP(acc.currentBalance)}
                </span>
                <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                  {isCredit && acc.statementCutoffDay
                    ? `Cutoff day ${acc.statementCutoffDay}`
                    : "Recorded balance"}
                </p>
              </div>

              {isCredit ? (
                <div className="flex items-center justify-between text-on-surface-variant py-1.5 px-1">
                  <span className="font-label-sm text-label-sm">Limit Available</span>
                  <span className="font-currency-sm text-currency-sm font-medium text-on-surface">
                    {formatCompactPHP((acc.creditLimit || 0) - acc.currentBalance)}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onReconcileClick && onReconcileClick(acc.id)}
                  className="w-full flex items-center justify-center space-x-1.5 min-h-11 py-2 px-4 bg-surface-container-low hover:bg-surface-container active:scale-[0.98] transition rounded-full text-secondary"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    check_circle
                  </span>
                  <span className="font-label-sm text-label-sm font-semibold">
                    Reconcile
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
