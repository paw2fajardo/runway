"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { RapidExpenseDrawer } from "@/components/quick-log/RapidExpenseDrawer";
import { formatPHP } from "@/lib/currency";
import { ParsedInboxItem } from "@/lib/types";
import { Dialog } from "@/components/ui/Dialog";

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
  const [isQuickLogOpen, setIsQuickLogOpen] = useState<boolean>(false);
  const [isAddAlertOpen, setIsAddAlertOpen] = useState(false);
  const [isGuardrailOpen, setIsGuardrailOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<InboxItemRecord | null>(null);
  const [inputText, setInputText] = useState<string>("");
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"pending" | "approved" | "assistant">("pending");

  // Tactical assistant simulation
  const [queryText, setQueryText] = useState("");
  const [assistantReply, setAssistantReply] = useState<string | null>(null);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox");
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch (err) {
      console.error("Failed to load inbox items:", err);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const handleParseSubmit = async (textToParse?: string) => {
    const payload = textToParse || inputText;
    if (!payload.trim()) return;

    setIsParsing(true);
    try {
      const res = await fetch("/api/inbox/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_payload: payload,
          source_channel: "sms",
        }),
      });

      if (res.ok) {
        setInputText("");
        fetchInbox();
        setActiveTab("pending");
        setIsAddAlertOpen(false);
      }
    } catch (err) {
      console.error("Parse failed:", err);
    } finally {
      setIsParsing(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/inbox/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchInbox();
      }
    } catch (err) {
      console.error("Approve failed:", err);
    }
  };

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

  const handleAssistantQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;

    try {
      const forecastRes = await fetch("/api/runway/forecast");
      const forecast = await forecastRes.json();

      // Extract amount from query if mentioned
      const numMatch = queryText.match(/([\d,]+(?:\.\d{2})?)/);
      const amountPesos = numMatch ? parseFloat(numMatch[1].replace(/,/g, "")) : 5000;
      const amountCents = amountPesos * 100;

      const buffer = forecast.net_projected_buffer;
      const remainingBuffer = buffer - amountCents;
      const isSolvent = remainingBuffer >= 0;

      if (isSolvent) {
        setAssistantReply(
          `✅ Scenario Approved: Spending ${formatPHP(amountCents)} leaves you with a safe reserve of ${formatPHP(remainingBuffer)} before your ${forecast.next_payday_date} payday. Your daily allowance would adjust from ${formatPHP(forecast.daily_allowance)} to ${formatPHP(Math.floor(remainingBuffer / forecast.days_to_payday))}/day.`
        );
      } else {
        setAssistantReply(
          `⚠️ Deficit Alert: Spending ${formatPHP(amountCents)} exceeds your safe runway by ${formatPHP(Math.abs(remainingBuffer))}. This would cause an impending shortfall before your ${forecast.next_payday_date} salary arrives.`
        );
      }
    } catch {
      setAssistantReply("Unable to calculate scenario at this time.");
    }
  };

  const pendingItems = items.filter((i) => i.status === "pending");
  const approvedItems = items.filter((i) => i.status === "approved");

  const samplePresets = [
    {
      label: "InstaPay ₱5,000 + ₱15 fee",
      text: "InstaPay transfer of PHP 5,000.00 to GCash successful. Fee: PHP 15.00. Ref No: 994821",
    },
    {
      label: "ATM ₱2,000 + ₱18 fee",
      text: "ATM withdrawal of PHP 2,000.00 at BDO ATM. Fee: PHP 18.00.",
    },
    {
      label: "Meralco Bill ₱2,850",
      text: "Your Meralco bill for Oct 2026 is PHP 2,850.00 due on 10/06/2026.",
    },
    {
      label: "Artisan Brew ₱185",
      text: "You paid PHP 185.00 at Artisan Brew on 10/03/2026. Card ending 9281",
    },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <Header title="AI Staging Inbox" />

      <main className="app-bottom-clearance flex flex-col flex-1 relative w-full pt-20 bg-transparent max-w-[480px] mx-auto min-h-screen">
        <div className="flex flex-col w-full px-margin pb-6 gap-space-md select-none">
          <div className="flex items-center justify-between gap-3 py-2">
            <button runway-id="inbox.approval-required" type="button" onClick={() => setIsGuardrailOpen(true)} className="min-h-11 text-body-md text-secondary">Approval required ⓘ</button>
            <button runway-id="inbox.add-alert" type="button" onClick={() => setIsAddAlertOpen(true)} className="min-h-11 px-5 rounded-xl bg-secondary text-white font-semibold">Add alert</button>
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
                AI extraction strictly stages items into an isolated queue. No automated
                system modifies your ledger without explicit 1-tap confirmation.
              </p>
            </div>
          </div>
          </Dialog>

          {/* Quick SMS & Alert Ingest Testbed */}
          <Dialog open={isAddAlertOpen} onClose={() => setIsAddAlertOpen(false)} title="Add alert">
          <section className="glass-panel p-space-md flex flex-col gap-space-sm">
            <span runway-id="inbox.add-alert.prompt" className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
              Paste a bank alert or receipt
            </span>
            <div className="flex flex-col gap-2">
              <textarea runway-id="inbox.add-alert.message-input"
                rows={2}
                aria-label="Bank alert or receipt text"
                placeholder="Paste raw bank SMS, payment receipt, or utility notice..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-secondary resize-none"
              />
              <button runway-id="inbox.add-alert.parse-button"
                type="button"
                onClick={() => handleParseSubmit()}
                disabled={isParsing || !inputText.trim()}
                className="h-10 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center justify-center gap-1 active:scale-95 transition disabled:opacity-50"
              >
                <span runway-id="inbox.add-alert.parse-icon" className="material-symbols-outlined text-[16px]">
                  auto_awesome
                </span>
                {isParsing ? "Extracting..." : "Parse & Stage into Inbox"}
              </button>
            </div>

            {/* Presets */}
            <div className="flex flex-col gap-1 pt-1">
              <span runway-id="inbox.add-alert.samples-label" className="font-label-sm text-[11px] text-on-surface-variant">
                Quick Sample Alerts:
              </span>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {samplePresets.map((preset) => (
                  <button runway-id={`inbox.add-alert.sample.${preset.label}`}
                    key={preset.label}
                    type="button"
                    onClick={() => handleParseSubmit(preset.text)}
                    disabled={isParsing}
                    className="flex-shrink-0 px-2.5 py-1 bg-surface-container-low hover:bg-surface-container rounded-full text-on-surface-variant text-[11px] font-medium border border-outline-variant/20 transition"
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
          </Dialog>

          {/* Segmented Tab Control */}
          <div className="flex p-1 bg-surface-container rounded-lg gap-1">
            <button
              runway-id="inbox.tab.pending"
              type="button"
              onClick={() => setActiveTab("pending")}
              className={`flex-1 py-1.5 text-center rounded font-label-md text-label-md font-semibold transition ${
                activeTab === "pending"
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Pending ({pendingItems.length})
            </button>
            <button
              runway-id="inbox.tab.approved"
              type="button"
              onClick={() => setActiveTab("approved")}
              className={`flex-1 py-1.5 text-center rounded font-label-md text-label-md font-semibold transition ${
                activeTab === "approved"
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Approved ({approvedItems.length})
            </button>
            <button
              runway-id="inbox.tab.assistant"
              type="button"
              onClick={() => setActiveTab("assistant")}
              className={`flex-1 py-1.5 text-center rounded font-label-md text-label-md font-semibold transition flex items-center justify-center gap-1 ${
                activeTab === "assistant"
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span runway-id="inbox.tab.assistant.icon" className="material-symbols-outlined text-[14px]">psychology</span>
              Runway AI
            </button>
          </div>

          {/* Tab 1: Pending Staged Items */}
          {activeTab === "pending" && (
            <div className="flex flex-col space-y-space-sm">
              {pendingItems.length === 0 ? (
                <div className="glass-panel p-space-lg text-center border border-dashed border-outline-variant/50">
                  <span runway-id="inbox.pending.empty.icon" className="material-symbols-outlined text-[36px] text-outline">
                    inbox
                  </span>
                  <p runway-id="inbox.pending.empty.heading" className="font-headline-sm text-headline-sm font-semibold mt-1">
                    Inbox is Clear
                  </p>
                  <p runway-id="inbox.pending.empty.description" className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                    Use Add alert to paste a bank message or receipt.
                  </p>
                </div>
              ) : (
                pendingItems.map((item) => {
                  const data = item.parsedJson;
                  return (
                    <div
                      runway-id={`inbox.pending.item.${item.id}`}
                      key={item.id}
                      className="glass-panel p-space-md flex flex-col gap-space-sm"
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
                          Acc: {data.source_account_hint || "BPI Checking"}
                        </span>
                        <button runway-id={`inbox.pending.item.${item.id}.details`} type="button" onClick={() => setDetailItem(item)} className="min-h-11 px-3 text-secondary text-body-sm">Details</button>
                      </div>

                      {/* Actions */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          runway-id={`inbox.pending.item.${item.id}.discard`}
                          type="button"
                          onClick={() => handleDiscard(item.id)}
                          className="h-10 rounded-lg bg-surface-container-low text-on-surface font-label-md text-label-md font-semibold hover:bg-surface-container active:scale-95 transition"
                        >
                          Discard
                        </button>
                        <button
                          runway-id={`inbox.pending.item.${item.id}.approve`}
                          type="button"
                          onClick={() => handleApprove(item.id)}
                          className="h-10 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-semibold flex items-center justify-center gap-1 active:scale-95 transition"
                        >
                          <span runway-id={`inbox.pending.item.${item.id}.approve-icon`} className="material-symbols-outlined text-[16px]">
                            check
                          </span>
                          Approve into Ledger
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab 2: Approved History */}
          {activeTab === "approved" && (
            <div className="flex flex-col space-y-space-xs">
              {approvedItems.map((item) => (
                <div
                  runway-id={`inbox.approved.item.${item.id}`}
                  key={item.id}
                  className="glass-panel p-space-md flex items-center justify-between opacity-80"
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

          {/* Tab 3: Tactical Runway Query Assistant */}
          {activeTab === "assistant" && (
            <button runway-id="inbox.assistant.open" type="button" onClick={() => setIsAssistantOpen(true)} className="glass-panel min-h-14 p-5 text-secondary font-semibold">Ask about runway</button>
          )}
          <Dialog open={isAssistantOpen} onClose={() => setIsAssistantOpen(false)} title="Ask about runway">
            <div className="glass-panel p-space-md flex flex-col gap-space-md">
              <div>
                <h3 runway-id="inbox.assistant.heading" className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Forward Solvency Simulation
                </h3>
                <p runway-id="inbox.assistant.description" className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Ask natural language scenarios without granting ledger write permissions.
                </p>
              </div>

              <form onSubmit={handleAssistantQuery} className="flex flex-col gap-2">
                <input
                  runway-id="inbox.assistant.query"
                  type="text"
                  aria-label="Runway scenario"
                  placeholder="e.g. Can I buy a ₱12,000 monitor this weekend?"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  className="h-11 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 font-body-md text-body-md text-on-surface"
                />
                <button
                  runway-id="inbox.assistant.evaluate"
                  type="submit"
                  className="h-10 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-semibold"
                >
                  Evaluate Runway Impact
                </button>
              </form>

              {assistantReply && (
                <div runway-id="inbox.assistant.reply" className="p-space-md rounded-xl bg-surface-container-low text-on-surface font-body-sm text-body-sm border border-outline-variant/30 leading-relaxed animate-in fade-in duration-200">
                  {assistantReply}
                </div>
              )}
            </div>
          </Dialog>
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
