"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Inbox, Plus, TrendingUp, Wallet } from "lucide-react";

interface BottomNavProps {
  onOpenQuickLog?: () => void;
}

export function BottomNav({ onOpenQuickLog }: BottomNavProps) {
  const pathname = usePathname();

  const isRunway = pathname === "/";
  const isBills = pathname.startsWith("/bills");
  const isAccounts = pathname.startsWith("/accounts");
  const isInbox = pathname.startsWith("/inbox");

  return (
    <nav runway-id="runway.nav" aria-label="Main navigation" className="fixed z-40 left-1/2 -translate-x-1/2 w-[calc(100%-40px)] max-w-[400px]" style={{ bottom: "calc(20px + env(safe-area-inset-bottom, 0px))" }}>
      <div className="flex items-center justify-between gap-1 rounded-full border border-white/15 bg-primary-container/95 p-2 shadow-[0_16px_36px_rgba(7,40,33,0.28)] backdrop-blur-xl">
        {/* Tab 1: Runway */}
        <Link
          href="/"
          runway-id="runway.nav.home"
          aria-label="Runway"
          aria-current={isRunway ? "page" : undefined}
          className={`min-w-11 h-11 shrink-0 rounded-full flex items-center justify-center gap-1.5 px-3 transition-colors ${
            isRunway
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <TrendingUp size={20} strokeWidth={1.8} aria-hidden="true" />
          {isRunway && <span className="hidden min-[360px]:inline text-label-sm">Runway</span>}
        </Link>

        {/* Tab 2: Bills */}
        <Link
          href="/bills"
          runway-id="runway.nav.bills"
          aria-label="Bills"
          aria-current={isBills ? "page" : undefined}
          className={`min-w-11 h-11 shrink-0 rounded-full flex items-center justify-center gap-1.5 px-3 transition-colors ${
            isBills
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <CalendarDays size={20} strokeWidth={1.8} aria-hidden="true" />
          {isBills && <span className="hidden min-[360px]:inline text-label-sm">Bills</span>}
        </Link>

        {/* Tab 3: Center Action (+) FAB */}
        <div className="flex shrink-0 items-center justify-center">
          <button
            onClick={onOpenQuickLog}
            runway-id="runway.nav.quick-log"
            aria-label="Open Rapid Expense Log"
            type="button"
            className="w-11 h-11 rounded-full bg-secondary-fixed text-primary flex items-center justify-center shadow-sm active:scale-95 transition-transform duration-100"
          >
            <Plus size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Tab 4: Accounts */}
        <Link
          href="/accounts"
          runway-id="runway.nav.accounts"
          aria-label="Accounts"
          aria-current={isAccounts ? "page" : undefined}
          className={`min-w-11 h-11 shrink-0 rounded-full flex items-center justify-center gap-1.5 px-3 transition-colors ${
            isAccounts
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Wallet size={20} strokeWidth={1.8} aria-hidden="true" />
          {isAccounts && <span className="hidden min-[360px]:inline text-label-sm">Accounts</span>}
        </Link>

        {/* Tab 5: Inbox */}
        <Link
          href="/inbox"
          runway-id="runway.nav.inbox"
          aria-label="Inbox"
          aria-current={isInbox ? "page" : undefined}
          className={`min-w-11 h-11 shrink-0 rounded-full flex items-center justify-center gap-1.5 px-3 transition-colors ${
            isInbox
              ? "bg-white text-primary shadow-sm font-semibold"
              : "text-white/80 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Inbox size={20} strokeWidth={1.8} aria-hidden="true" />
          {isInbox && <span className="hidden min-[360px]:inline text-label-sm">Inbox</span>}
        </Link>
      </div>
    </nav>
  );
}
