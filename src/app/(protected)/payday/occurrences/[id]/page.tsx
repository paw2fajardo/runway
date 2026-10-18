"use client";

import { use } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { PendingPaychecks } from "@/components/payday/PendingPaychecks";

export default function PaycheckOccurrencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <div className="flex min-h-screen flex-col bg-transparent">
    <Header />
    <main className="app-bottom-clearance relative mx-auto flex min-h-screen w-full max-w-[480px] md:max-w-3xl flex-1 flex-col bg-transparent px-margin pt-20">
      <div className="flex flex-col gap-6 pb-space-xl">
        <div className="space-y-2 pt-2"><h1 className="text-headline-lg font-semibold tracking-tight">Paycheck confirmation</h1><p className="text-body-md text-on-surface-variant">Confirm whether this deposit arrived.</p></div>
        <PendingPaychecks focusId={id} />
      </div>
    </main>
    <BottomNav onOpenQuickLog={() => { window.location.assign("/"); }} />
  </div>;
}
