"use client";

import { useState, useEffect, useCallback } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { formatPHP } from "@/lib/currency";
import { ParsedInboxItem } from "@/lib/types";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { InboxReview } from "@/components/inbox/InboxReview";

interface InboxItemRecord {
  id: string;
  sourceChannel: string;
  rawPayload: string;
  parsedJson: ParsedInboxItem;
  status: "pending" | "approved" | "discarded";
  createdAt: string;
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItemRecord[]>([]);
  const [isInboxLoading, setIsInboxLoading] = useState(true);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState<boolean>(false);
  const [isGuardrailOpen, setIsGuardrailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InboxItemRecord | null>(null);
  const [reviewItem, setReviewItem] = useState<InboxItemRecord | null>(null);
  const [activeTab, setActiveTab] = useState<"pending" | "approved">("pending");

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox");
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch (err) {
      console.error("Failed to load inbox items:", err);
    } finally {
      setIsInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const handleDiscard = async (id: string) => {
    try {
      const res = await fetch(`/api/inbox/${id}/discard`, {
        method: "POST",
      });
      if (res.ok) {
        fetchInbox();
      }
    } catch (err) {
      console.error("Discard failed:", err);
    }
  };

  const pendingItems = items.filter((i) => i.status === "pending");
  const approvedItems = items.filter((i) => i.status === "approved");

  return (
    <div className="flex flex-col min-h-screen bg-transparent">

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] md:max-w-5xl mx-auto min-h-screen">
        <div className="flex flex-col w-full px-margin pb-6 gap-space-md select-none">
          <div className="flex items-center justify-end gap-3 py-2">
            <button runway-id="inbox.approval-required" type="button" onClick={() => setIsGuardrailOpen(true)} className="min-h-11 text-body-md text-secondary">Approval required ⓘ</button>
          </div>
          <Dialog open={isGuardrailOpen} onClose={() => setIsGuardrailOpen(false)} title="Approval required">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-secondary shrink-0">
              <span runway-id="inbox.guardrail.icon" className="material-symbols-outlined text-[20px]">
                security
              </span>
            </div>
            <div className="flex flex-col">
              <span runway-id="inbox.guardrail.heading" className="font-headline-sm text-[15px] font-bold text-on-surface">
                Deterministic Guardrail Active
              </span>
              <p runway-id="inbox.guardrail.description" className="font-body-sm text-body-sm text-on-surface-variant leading-tight mt-0.5">
                Staged entries stay out of your ledger until you review and approve them.
              </p>
            </div>
          </div>
          </Dialog>

          {/* Segmented Tab Control */}
          <div className="flex p-1 bg-surface-container rounded-lg gap-1">
            <button
              runway-id="inbox.tab.pending"
              type="button"
              onClick={() => setActiveTab("pending")}
              className={`flex min-h-11 flex-1 items-center justify-center py-1.5 text-center rounded font-label-md text-label-md font-semibold transition ${
                activeTab === "pending"
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Pending ({isInboxLoading ? "…" : pendingItems.length})
            </button>
            <button
              runway-id="inbox.tab.approved"
              type="button"
              onClick={() => setActiveTab("approved")}
              className={`flex min-h-11 flex-1 items-center justify-center py-1.5 text-center rounded font-label-md text-label-md font-semibold transition ${
                activeTab === "approved"
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Approved ({isInboxLoading ? "…" : approvedItems.length})
            </button>
          </div>

          {/* Tab 1: Pending Staged Items */}
          {activeTab === "pending" && (
            <div className="flex flex-col space-y-space-sm">
              {isInboxLoading ? <div runway-id="inbox.pending.loading" className="space-y-space-sm" role="status" aria-label="Loading inbox items"><span className="sr-only">Loading inbox items…</span>{[0, 1].map((item) => <Skeleton key={item} className="h-[240px] w-full rounded-[28px]" />)}</div> : pendingItems.length === 0 ? (
                <div className="glass-panel p-space-lg text-center border border-dashed border-outline-variant/50">
                  <span runway-id="inbox.pending.empty.icon" className="material-symbols-outlined text-[36px] text-outline">
                    inbox
                  </span>
                  <p runway-id="inbox.pending.empty.heading" className="font-headline-sm text-headline-sm font-semibold mt-1">
                    Inbox is Clear
                  </p>
                  <p runway-id="inbox.pending.empty.description" className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                    Staged payment entries will appear here for review.
                  </p>
                </div>
              ) : (
                pendingItems.map((item) => {
                  const data = item.parsedJson;
                  return (
                    <div
                      runway-id={`inbox.pending.item.${item.id}`}
                      key={item.id}
                      className="glass-panel min-h-[240px] lg:min-h-0 p-space-md flex flex-col gap-space-sm"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col">
                          <span runway-id={`inbox.pending.item.${item.id}.merchant`} className="font-headline-sm text-headline-sm font-bold text-on-surface">
                            {data.merchant}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span runway-id={`inbox.pending.item.${item.id}.amount`} className="font-currency-lg text-currency-lg font-bold text-on-surface">
                            {formatPHP(data.amount_cents)}
                          </span>
                          {data.fee_cents > 0 && (
                            <span runway-id={`inbox.pending.item.${item.id}.fee`} className="font-label-sm text-[10px] font-bold text-on-tertiary-container bg-tertiary-container/10 px-1.5 py-0.2 rounded">
                              + Fee: {formatPHP(data.fee_cents)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Extracted Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-outline-variant/20">
                        <span runway-id={`inbox.pending.item.${item.id}.account`} className="px-2 py-0.5 bg-surface-container rounded-full text-on-surface font-label-sm text-[11px]">
                          Acc: {data.source_account_hint || "Choose during review"}
                        </span>
                        <button runway-id={`inbox.pending.item.${item.id}.details`} type="button" onClick={() => setDetailItem(item)} className="min-h-11 px-3 text-secondary text-body-sm">Details</button>
                      </div>

                      {/* Actions */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          runway-id={`inbox.pending.item.${item.id}.discard`}
                          type="button"
                          onClick={() => handleDiscard(item.id)}
                          className="min-h-11 rounded-lg bg-surface-container-low text-on-surface font-label-md text-label-md font-semibold hover:bg-surface-container active:scale-95 transition"
                        >
                          Discard
                        </button>
                        <button
                          runway-id={`inbox.pending.item.${item.id}.approve`}
                          type="button"
                          onClick={() => setReviewItem(item)}
                          className="min-h-11 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-semibold flex items-center justify-center gap-1 active:scale-95 transition"
                        >
                          <span runway-id={`inbox.pending.item.${item.id}.approve-icon`} className="material-symbols-outlined text-[16px]">
                            check
                          </span>
                          Review and log
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <InboxReview item={reviewItem} onClose={() => setReviewItem(null)} onSaved={() => { void fetchInbox(); }} />

          {/* Tab 2: Approved History */}
          {activeTab === "approved" && (
            <div className="flex flex-col space-y-space-xs">
              {isInboxLoading ? <div runway-id="inbox.approved.loading" className="space-y-space-xs" role="status" aria-label="Loading approved items"><span className="sr-only">Loading approved items…</span>{[0, 1, 2].map((item) => <Skeleton key={item} className="h-[76px] w-full rounded-[28px]" />)}</div> : approvedItems.map((item) => (
                <div
                  runway-id={`inbox.approved.item.${item.id}`}
                  key={item.id}
                  className="glass-panel min-h-[76px] p-space-md flex items-center justify-between opacity-80"
                >
                  <div className="flex flex-col">
                    <span runway-id={`inbox.approved.item.${item.id}.merchant`} className="font-body-md text-body-md font-semibold text-on-surface">
                      {item.parsedJson.merchant}
                    </span>
                    <span runway-id={`inbox.approved.item.${item.id}.status`} className="font-body-sm text-body-sm text-on-surface-variant">
                      Committed to ledger
                    </span>
                  </div>
                  <span runway-id={`inbox.approved.item.${item.id}.amount`} className="font-currency-md text-currency-md font-bold text-secondary">
                    {formatPHP(item.parsedJson.amount_cents)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Dialog open={detailItem !== null} onClose={() => setDetailItem(null)} title="Alert details">
            {detailItem && <div runway-id={`inbox.detail.${detailItem.id}`} className="space-y-4 text-body-md">
              <p runway-id={`inbox.detail.${detailItem.id}.summary`}>{detailItem.parsedJson.raw_summary}</p>
              <p runway-id={`inbox.detail.${detailItem.id}.category`}>Category: {detailItem.parsedJson.category_hint || "General Living"}</p>
              <p runway-id={`inbox.detail.${detailItem.id}.confidence`}>Confidence: {Math.round((detailItem.parsedJson.confidence || 0.95) * 100)}%</p>
            </div>}
          </Dialog>
        </div>
      </main>

      <BottomNav onOpenQuickLog={() => setIsQuickLogOpen(true)} />

      <RapidExpenseDrawer
        isOpen={isQuickLogOpen}
        onClose={() => setIsQuickLogOpen(false)}
        onSuccess={fetchInbox}
      />
    </div>
  );
}
