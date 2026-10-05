"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, UserRound } from "lucide-react";
import { getPendingQueueCount, flushOfflineQueue } from "@/lib/offline-db";

interface HeaderProps {
  title?: string;
  showBack?: boolean;
}

export function Header({ title, showBack = false }: HeaderProps) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingCount, setPendingCount] = useState<number>(0);

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
                {title || "Runway"}
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
            href="/settings"
            runway-id="runway.header.settings"
            aria-label="Settings"
            className="w-11 h-11 rounded-full bg-white/60 border border-white/70 text-primary flex items-center justify-center hover:bg-white active:scale-95 transition-transform"
          >
            <UserRound size={20} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
