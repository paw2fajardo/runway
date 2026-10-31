"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Inbox, LogOut, UserRound } from "lucide-react";
import { getPendingQueueCount, flushOfflineQueue } from "@/lib/offline-db";
import { usePathname } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { signOut } from "@/lib/auth/client";

interface HeaderProps {
  title?: string;
  showBack?: boolean;
}

export function Header({ title, showBack = false }: HeaderProps) {
  const pathname = usePathname();
  const routeTitle = title ?? (pathname === "/accounts" ? "Accounts"
    : pathname.startsWith("/bills") ? "Bills"
    : pathname === "/budgets" ? "Budget plans"
    : pathname.startsWith("/inbox") ? "Inbox"
    : pathname === "/insights" ? "Insights"
    : pathname === "/settings" ? "Settings"
    : pathname.startsWith("/transactions") ? "Transactions"
    : pathname.startsWith("/payday/occurrences/") ? "Paycheck confirmation"
    : "Runway");
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [showLogoutDialog, setShowLogoutDialog] = useState<boolean>(false);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await signOut();
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "Unable to sign out.");
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const updateOnline = () => {
      setIsOnline(true);
      flushOfflineQueue().then(() => checkQueue());
    };
    const updateOffline = () => setIsOnline(false);

    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOffline);

    const checkQueue = async () => {
      const count = await getPendingQueueCount();
      setPendingCount(count);
    };

    checkQueue();
    if (navigator.onLine) {
      flushOfflineQueue().then(() => checkQueue());
    }
    const interval = setInterval(checkQueue, 5000);

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOffline);
      clearInterval(interval);
    };
  }, []);

  return (
    <header runway-id="runway.header" className="glass-chrome fixed top-0 w-full z-50 pt-safe border-b border-white/40">
      <div className="h-16 px-margin flex items-center justify-between gap-3 max-w-[480px] md:max-w-5xl mx-auto">
        <div className="flex items-center gap-space-sm min-w-0">
          {showBack ? (
            <button
              onClick={() => window.history.back()}
              runway-id="runway.header.back"
              aria-label="Go Back"
              className="w-11 h-11 shrink-0 -ml-2 rounded-full flex items-center justify-center text-on-surface hover:bg-white/50 transition-colors"
            >
              <ArrowLeft size={22} aria-hidden="true" />
            </button>
          ) : null}

          <Link href="/" runway-id="runway.header.home" className="flex min-w-0 min-h-11 items-center gap-2.5">
            <div className="relative w-9 h-9 shrink-0 rounded-full overflow-hidden border border-white/70 flex items-center justify-center bg-white">
              <Image
                src="/logo.svg"
                alt=""
                width={32}
                height={32}
                className="object-contain"
                priority
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span runway-id="runway.header.title" className="font-headline-sm text-headline-sm truncate font-semibold text-on-surface leading-tight tracking-tight">
                {routeTitle}
              </span>
              {!isOnline || pendingCount > 0 ? (
                <div className="flex items-center gap-1">
                  <span
                    runway-id="runway.header.connection-indicator"
                    className={`w-1.5 h-1.5 rounded-full ${
                      isOnline ? "bg-secondary" : "bg-amber-500 animate-pulse"
                    }`}
                  />
                  <span runway-id="runway.header.connection-status" className="font-label-sm text-label-sm text-secondary font-semibold">
                    {isOnline ? `${pendingCount} pending` : `Offline (${pendingCount} queued)`}
                  </span>
                </div>
              ) : null}
            </div>
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-space-sm">
          <Link
            href="/inbox"
            runway-id="runway.header.inbox"
            aria-label="Inbox"
            className="w-11 h-11 rounded-full bg-white/60 border border-white/70 text-primary flex items-center justify-center hover:bg-white active:scale-95 transition-transform"
          >
            <Inbox size={20} aria-hidden="true" />
          </Link>
          <Link
            href="/settings"
            runway-id="runway.header.settings"
            aria-label="Settings"
            className="w-11 h-11 rounded-full bg-white/60 border border-white/70 text-primary flex items-center justify-center hover:bg-white active:scale-95 transition-transform"
          >
            <UserRound size={20} aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => {
              setLogoutError(null);
              setShowLogoutDialog(true);
            }}
            runway-id="runway.header.logout"
            aria-label="Sign out"
            title="Sign out"
            className="w-11 h-11 rounded-full bg-white/60 border border-white/70 text-primary flex items-center justify-center hover:bg-white hover:text-error active:scale-95 transition-transform"
          >
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      {showLogoutDialog && (
        <Dialog
          open={showLogoutDialog}
          onClose={() => {
            if (!loggingOut) setShowLogoutDialog(false);
          }}
          title="Sign out"
        >
          <div className="space-y-4 pt-1">
            <p className="text-body-md text-on-surface-variant">
              Are you sure you want to sign out of your account?
            </p>
            {logoutError && (
              <p role="alert" className="text-body-sm text-error">
                {logoutError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => setShowLogoutDialog(false)}
                runway-id="runway.header.logout.cancel"
                className="min-h-11 rounded-full border border-outline-variant px-space-md text-label-md font-medium text-on-surface hover:bg-black/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void handleSignOut()}
                runway-id="runway.header.logout.confirm"
                className="min-h-11 rounded-full bg-primary px-space-md text-label-md font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </header>
  );
}
