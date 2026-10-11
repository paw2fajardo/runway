"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Plus, ReceiptText, TrendingUp, Wallet, PiggyBank } from "lucide-react";

interface BottomNavProps {
  onOpenQuickLog?: () => void;
}

export function BottomNav({ onOpenQuickLog }: BottomNavProps) {
  const pathname = usePathname();

  const isRunway = pathname === "/";
  const isBills = pathname.startsWith("/bills");
  const isAccounts = pathname.startsWith("/accounts");
  const isTransactions = pathname.startsWith("/transactions");
  const isBudgets = pathname.startsWith("/budgets");

  return (
    <>
    <nav runway-id="runway.nav" aria-label="Main navigation" className="fixed z-40 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 w-full max-w-lg px-space-xs">
      <div className="grid grid-cols-5 rounded-full border border-white/15 bg-primary-container/95 p-space-xs shadow-[0_16px_36px_rgba(7,40,33,0.28)] backdrop-blur-xl">
        {/* Tab 1: Runway */}
        <Link
          href="/"
          runway-id="runway.nav.home"
          aria-label="Runway"
          aria-current={isRunway ? "page" : undefined}
          className={`min-w-0 min-h-14 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
            isRunway
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <TrendingUp size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className="text-label-sm">Runway</span>
        </Link>

        {/* Tab 2: Bills */}
        <Link
          href="/bills"
          runway-id="runway.nav.bills"
          aria-label="Bills"
          aria-current={isBills ? "page" : undefined}
          className={`min-w-0 min-h-14 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
            isBills
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <CalendarDays size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className="text-label-sm">Bills</span>
        </Link>

        <Link href="/budgets" aria-label="Budgets" aria-current={isBudgets ? "page" : undefined}
          className={`min-w-0 min-h-14 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors ${isBudgets ? "bg-white text-primary shadow-sm font-semibold" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
          <PiggyBank size={20} aria-hidden="true" /><span className="text-label-sm">Budgets</span>
        </Link>

        {/* Tab 4: Accounts */}
        <Link
          href="/accounts"
          runway-id="runway.nav.accounts"
          aria-label="Accounts"
          aria-current={isAccounts ? "page" : undefined}
          className={`min-w-0 min-h-14 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
            isAccounts
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Wallet size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className="text-label-sm">Accounts</span>
        </Link>

        {/* Tab 5: Transactions */}
        <Link
          href="/transactions"
          runway-id="runway.nav.transactions"
          aria-label="Transaction history"
          aria-current={isTransactions ? "page" : undefined}
          className={`min-w-0 min-h-14 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
            isTransactions
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <ReceiptText size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className="text-label-sm">History</span>
        </Link>
      </div>
    </nav>
    <button
      onClick={onOpenQuickLog}
      runway-id="runway.nav.quick-log"
      aria-label="Open Rapid Expense Log"
      type="button"
      className="fixed z-40 right-space-lg bottom-[calc(6.25rem+env(safe-area-inset-bottom,0px))] lg:bottom-space-lg h-14 w-14 rounded-full bg-secondary-fixed text-primary flex flex-col items-center justify-center gap-0.5 shadow-lg active:scale-95 transition-transform duration-100 motion-reduce:transition-none"
    >
      <Plus size={22} aria-hidden="true" />
    </button>
    </>
  );
}
