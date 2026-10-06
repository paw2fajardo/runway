import { Skeleton } from "@/components/ui/Skeleton";

type Page = "dashboard" | "bills" | "accounts" | "inbox";

const pageCards: Record<Page, string[]> = {
  dashboard: ["min-h-[376px] min-[380px]:min-h-[304px]", "h-28", "h-24", "h-24"],
  bills: ["h-[244px]", "h-40", "h-40", "h-40"],
  accounts: ["h-[120px]", "h-[120px]", "h-[76px]", "h-[144px]"],
  inbox: ["h-11", "h-[240px]", "h-[240px]"],
};

export function PrimaryPageLoading({ page }: { page: Page }) {
  return (
    <div className="min-h-screen" role="status" aria-label={`Loading ${page}`}>
      <span className="sr-only">Loading {page}…</span>
      <header aria-hidden="true" className="fixed inset-x-0 top-0 z-40 h-16 border-b border-white/60 bg-white/55 px-margin backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-5xl items-center"><Skeleton className="h-7 w-36" /></div>
      </header>
      <main className="app-bottom-clearance mx-auto flex min-h-screen w-full max-w-[480px] flex-col gap-6 px-margin pt-20 md:max-w-5xl">
        <div className="space-y-2"><Skeleton className="h-8 w-3/5" /><Skeleton className="h-4 w-4/5" /></div>
        {page === "accounts" ? <>
          <div className="grid grid-cols-2 gap-2">{pageCards.accounts.slice(0, 2).map((height) => <Skeleton key={height} className={`${height} w-full rounded-[28px]`} />)}</div>
          <div className="flex flex-col gap-3">{pageCards.accounts.slice(2).map((height) => <Skeleton key={height} className={`${height} w-full rounded-[28px]`} />)}</div>
        </> : <div className="flex flex-col gap-3">
          {pageCards[page].map((height, index) => <Skeleton key={`${height}-${index}`} className={`${height} w-full rounded-[28px]`} />)}
        </div>}
      </main>
      <div aria-hidden="true" className="fixed inset-x-0 bottom-0 z-40 h-[76px] border-t border-white/60 bg-white/70 backdrop-blur-xl" />
    </div>
  );
}
