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
  idPrefix?: string;
}

export function LiquidAccountsStrip({
  accounts,
  onReconcileClick,
  idPrefix = "runway.account-balances",
}: LiquidAccountsStripProps) {
  return (
    <section runway-id={idPrefix} className="flex flex-col space-y-space-sm">
      <div className="flex items-center justify-between">
        <h2 runway-id={`${idPrefix}.title`} className="font-headline-sm text-headline-sm text-on-surface font-semibold">
          Account balances
        </h2>
        <Link
          runway-id={`${idPrefix}.manage`}
          href="/accounts"
          className="font-label-md text-label-md min-h-11 inline-flex items-center px-3 rounded-full text-secondary hover:underline font-semibold"
        >
          Manage
        </Link>
      </div>

      {/* Cards reflow within the viewport instead of requiring a swipe. */}
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((acc) => {
          const isCredit = acc.type === "revolving_credit";
          return (
            <div
              key={acc.id}
              runway-id={`${idPrefix}.item.${acc.id}`}
              className="min-w-0 glass-panel p-5 flex flex-col justify-between space-y-space-md"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${
                      isCredit
                        ? "bg-surface-container text-outline"
                        : acc.name.toLowerCase().includes("maya")
                        ? "bg-surface-container text-secondary"
                        : "bg-surface-container text-primary"
                    }`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                      {isCredit
                        ? "credit_card"
                        : acc.name.toLowerCase().includes("maya")
                        ? "account_balance_wallet"
                        : "account_balance"}
                    </span>
                  </div>
                  <span runway-id={`${idPrefix}.item.${acc.id}.name`} className="min-w-0 font-label-md text-label-md font-semibold text-on-surface [overflow-wrap:anywhere]">
                    {acc.name}
                  </span>
                </div>

                {isCredit ? (
                  <span runway-id={`${idPrefix}.item.${acc.id}.type`} className="inline-flex shrink-0 px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant text-[10px] font-semibold">
                    Credit
                  </span>
                ) : null}
              </div>

              <div>
                <span runway-id={`${idPrefix}.item.${acc.id}.balance`}
                  className={`break-words tabular-nums font-currency-lg text-currency-lg font-bold ${
                    isCredit ? "text-error" : "text-on-surface"
                  }`}
                >
                  {formatPHP(acc.currentBalance)}
                </span>
                <p runway-id={`${idPrefix}.item.${acc.id}.balance-description`} className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                  {isCredit && acc.statementCutoffDay
                    ? `Cutoff day ${acc.statementCutoffDay}`
                    : "Recorded balance"}
                </p>
              </div>

              {isCredit ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-on-surface-variant py-1.5 px-1">
                  <span runway-id={`${idPrefix}.item.${acc.id}.limit-label`} className="font-label-sm text-label-sm">Limit Available</span>
                  <span runway-id={`${idPrefix}.item.${acc.id}.limit-available`} className="font-currency-sm text-currency-sm font-medium text-on-surface">
                    {formatCompactPHP((acc.creditLimit || 0) - acc.currentBalance)}
                  </span>
                </div>
              ) : (
                <button
                  runway-id={`${idPrefix}.item.${acc.id}.reconcile`}
                  type="button"
                  onClick={() => onReconcileClick && onReconcileClick(acc.id)}
                  className="w-full flex items-center justify-center space-x-1.5 min-h-11 py-2 px-4 bg-surface-container-low hover:bg-surface-container active:scale-[0.98] transition rounded-full text-secondary"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                    check_circle
                  </span>
                  <span runway-id={`${idPrefix}.item.${acc.id}.reconcile-label`} className="font-label-sm text-label-sm font-semibold">
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
