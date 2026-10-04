"use client";

import React, { useState, useEffect } from "react";
import { formatPHP } from "@/lib/currency";
import { queueOfflineTransaction } from "@/lib/offline-db";
import { Dialog } from "@/components/ui/Dialog";

interface AccountOption {
  id: string;
  name: string;
  type: string;
  currentBalance: number;
}

interface RapidExpenseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  accounts?: AccountOption[];
  daysToPayday?: number;
}

export function RapidExpenseDrawer({
  isOpen,
  onClose,
  onSuccess,
  accounts = [],
  daysToPayday,
}: RapidExpenseDrawerProps) {
  const [mode, setMode] = useState<"expense" | "transfer" | "inflow">("expense");
  const [rawDigits, setRawDigits] = useState<string>("0");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [selectedDestId, setSelectedDestId] = useState<string>("");
  const [selectedFee, setSelectedFee] = useState<number>(0);
  const [isCustomFee, setIsCustomFee] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("ATM / Pocket Cash");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Set default source account
  useEffect(() => {
    if (accounts.length > 0 && !selectedSourceId) {
      setSelectedSourceId(accounts[0].id);
    }
    if (accounts.length > 1 && !selectedDestId) {
      setSelectedDestId(accounts[1].id);
    }
  }, [accounts, selectedSourceId, selectedDestId]);

  if (!isOpen) return null;

  const baseCents = parseInt(rawDigits || "0", 10);
  const totalCents =
    mode === "expense" || mode === "transfer"
      ? baseCents + selectedFee
      : baseCents;

  // Runway impact calculation
  const impactPerDay = daysToPayday !== undefined && daysToPayday > 0
    ? (totalCents / daysToPayday)
    : 0;

  const handleKeyClick = (val: string) => {
    if (val === ".") return; // cent format handles decimals naturally
    if (rawDigits.length >= 8) return;
    setRawDigits((prev) => (prev === "0" ? val : prev + val));
  };

  const handleBackspace = () => {
    setRawDigits((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
  };

  const handleConfirm = async () => {
    if (baseCents <= 0) return;
    setIsSubmitting(true);

    try {
      const sourceAcc = accounts.find((a) => a.id === selectedSourceId);
      const destAcc = accounts.find((a) => a.id === selectedDestId);

      const description =
        mode === "transfer"
          ? `${sourceAcc?.name || "Source"} to ${destAcc?.name || "Destination"}`
          : mode === "expense"
          ? selectedCategory
          : "Salary / Inflow";

      const transactionType = mode === "inflow" ? ("income" as const) : mode;

      await queueOfflineTransaction({
        type: transactionType,
        description,
        source_account_id: transactionType !== "income" ? selectedSourceId : undefined,
        destination_account_id:
          transactionType === "transfer"
            ? selectedDestId
            : transactionType === "income"
            ? selectedSourceId
            : undefined,
        gross_outflow: totalCents,
        net_inflow: baseCents,
        fee_amount: selectedFee,
        transacted_at: new Date().toISOString(),
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Failed to queue transaction:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoriesList = [
    "ATM / Pocket Cash",
    "Food & Groceries",
    "Utilities",
    "Transit / Grab",
    "Subscriptions",
    "General Living",
  ];

  return (
    <Dialog open={isOpen} onClose={onClose} title="Quick log">
      <div className="flex flex-col select-none pb-safe">
        {/* Drag Handle and Mode Selector Header */}
        <div className="flex flex-col items-center pt-space-sm pb-space-xs relative shrink-0">
          <div className="w-12 h-1 rounded-full bg-on-surface-variant/20 mb-space-sm" />
          <div className="flex items-center justify-between w-full">
            {/* Segmented Mode Control */}
            <div className="grid grid-cols-3 w-full p-1 bg-surface-container rounded-full gap-1">
              <button
                runway-id="quick-log.mode.expense"
                type="button"
                aria-pressed={mode === "expense"} onClick={() => setMode("expense")}
                className={`min-h-11 min-w-0 px-2 rounded-full font-label-md text-label-sm transition-all flex items-center justify-center gap-1 ${
                  mode === "expense"
                    ? "bg-primary-container text-surface-container-lowest shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span runway-id="quick-log.mode.expense.icon" className="material-symbols-outlined hidden min-[400px]:inline text-[16px]">arrow_downward</span>
                Expense
              </button>
              <button
                runway-id="quick-log.mode.transfer"
                type="button"
                aria-pressed={mode === "transfer"} onClick={() => setMode("transfer")}
                className={`min-h-11 min-w-0 px-2 rounded-full font-label-md text-label-sm transition-all flex items-center justify-center gap-1 ${
                  mode === "transfer"
                    ? "bg-primary-container text-surface-container-lowest shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span runway-id="quick-log.mode.transfer.icon" className="material-symbols-outlined hidden min-[400px]:inline text-[16px]">sync_alt</span>
                Transfer
              </button>
              <button
                runway-id="quick-log.mode.inflow"
                type="button"
                aria-pressed={mode === "inflow"} onClick={() => setMode("inflow")}
                className={`min-h-11 min-w-0 px-2 rounded-full font-label-md text-label-sm transition-all flex items-center justify-center gap-1 ${
                  mode === "inflow"
                    ? "bg-primary-container text-surface-container-lowest shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span runway-id="quick-log.mode.inflow.icon" className="material-symbols-outlined hidden min-[400px]:inline text-[16px]">arrow_upward</span>
                Inflow
              </button>
            </div>

          </div>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex flex-col gap-5">
          {/* Amount Display & Runway Impact */}
          <div className="flex flex-col items-center pt-space-xs pb-space-xs text-center">
            <div className="inline-flex items-baseline justify-center gap-1">
              <span runway-id="quick-log.amount.currency" className="font-currency-lg text-currency-lg text-primary-container font-semibold">
                ₱
              </span>
              <div className="relative">
                <span runway-id="quick-log.amount.value" className="font-currency-display text-[clamp(24px,7vw,40px)] text-primary-container tracking-tight">
                  {formatPHP(baseCents, false)}
                </span>
                <span className="inline-block w-0.5 h-7 ml-0.5 bg-secondary align-middle animate-pulse" />
              </div>
            </div>

            {/* Runway Impact Readout */}
            {mode === "expense" && daysToPayday !== undefined && daysToPayday > 0 && baseCents > 0 && (
              <div className="mt-space-xs inline-flex items-center gap-space-xs px-space-sm py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm">
                <span runway-id="quick-log.runway-impact.icon" className="material-symbols-outlined text-error text-[14px]">
                  trending_down
                </span>
                <span runway-id="quick-log.runway-impact.label">
                  Impact on Runway:{" "}
                  <strong runway-id="quick-log.runway-impact.value" className="text-error font-currency-sm text-currency-sm">
                    -{formatPHP(impactPerDay)}/day
                  </strong>{" "}
                </span>
              </div>
            )}
          </div>

          {/* Source Account Selector */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <span runway-id="quick-log.source-account.label" className="font-label-sm text-label-sm text-on-surface-variant tracking-wider uppercase">
                {mode === "inflow" ? "Destination Account" : "Source Account"}
              </span>
            </div>
            <div className="flex items-center gap-space-xs overflow-x-auto pb-0.5 scrollbar-none">
              {accounts.map((acc) => {
                const isSelected = acc.id === selectedSourceId;
                return (
                  <button
                    runway-id={`quick-log.source-account.${acc.id}`}
                    key={acc.id}
                    type="button"
                    aria-pressed={isSelected} onClick={() => setSelectedSourceId(acc.id)}
                    className={`flex-shrink-0 flex items-center gap-space-xs min-h-11 px-space-md py-space-xs rounded-full font-label-md text-label-md transition-colors ${
                      isSelected
                        ? "bg-primary text-white shadow-sm border border-primary font-semibold"
                        : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {isSelected && (
                      <span runway-id={`quick-log.source-account.${acc.id}.selected-icon`} className="material-symbols-outlined hidden min-[400px]:inline text-[16px] text-white">
                        check_circle
                      </span>
                    )}
                    <span runway-id={`quick-log.source-account.${acc.id}.name`}>{acc.name}</span>
                    <span runway-id={`quick-log.source-account.${acc.id}.balance`} className={`font-currency-sm text-currency-sm ${isSelected ? "text-white/80" : "text-on-surface-variant"}`}>
                      ₱{(acc.currentBalance / 100000).toFixed(1)}k
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Destination Account (if Transfer mode) */}
          {mode === "transfer" && (
            <div className="flex flex-col gap-space-xs">
              <span runway-id="quick-log.destination-account.label" className="font-label-sm text-label-sm text-on-surface-variant tracking-wider uppercase">
                Destination Account
              </span>
              <div className="flex items-center gap-space-xs overflow-x-auto pb-0.5 scrollbar-none">
                {accounts
                  .filter((a) => a.id !== selectedSourceId)
                  .map((acc) => {
                    const isSelected = acc.id === selectedDestId;
                    return (
                      <button
                        runway-id={`quick-log.destination-account.${acc.id}`}
                        key={acc.id}
                        type="button"
                        aria-pressed={isSelected} onClick={() => setSelectedDestId(acc.id)}
                        className={`flex-shrink-0 flex items-center gap-space-xs min-h-11 px-space-md py-space-xs rounded-full font-label-md text-label-md transition-colors ${
                          isSelected
                            ? "bg-primary text-white shadow-sm border border-primary font-semibold"
                            : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        {isSelected && (
                          <span runway-id={`quick-log.destination-account.${acc.id}.selected-icon`} className="material-symbols-outlined hidden min-[400px]:inline text-[16px] text-white">
                            check_circle
                          </span>
                        )}
                        <span runway-id={`quick-log.destination-account.${acc.id}.name`}>{acc.name}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Instant Fee Chips (Only for Expense & Transfer) */}
          {mode !== "inflow" && (
            <div className="flex flex-col gap-space-xs">
              <div className="flex items-center justify-between">
                <span runway-id="quick-log.fee.label" className="font-label-sm text-label-sm text-on-surface-variant tracking-wider uppercase">
                  Instant Fee / Surcharge
                </span>
                <span runway-id="quick-log.fee.selected-label" className="font-label-sm text-label-sm text-on-tertiary-container font-currency-sm">
                  {selectedFee === 1800
                    ? "External ATM fee"
                    : selectedFee === 1500
                    ? "InstaPay fee"
                    : selectedFee === 0
                    ? "Zero fee"
                    : "Custom fee"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-space-xs">
                <button
                  runway-id="quick-log.fee.zero"
                  type="button"
                  onClick={() => {
                    setSelectedFee(0);
                    setIsCustomFee(false);
                  }}
                  className={`min-h-11 rounded-full font-label-md text-label-md transition-colors ${
                    selectedFee === 0 && !isCustomFee
                      ? "bg-primary text-white font-semibold shadow-sm"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  ₱0
                </button>
                <button
                  runway-id="quick-log.fee.instapay"
                  type="button"
                  onClick={() => {
                    setSelectedFee(1500);
                    setIsCustomFee(false);
                  }}
                  className={`min-h-11 rounded-full font-label-md text-label-md transition-colors ${
                    selectedFee === 1500 && !isCustomFee
                      ? "bg-primary text-white font-semibold shadow-sm"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  +₱15
                </button>
                <button
                  runway-id="quick-log.fee.atm"
                  type="button"
                  onClick={() => {
                    setSelectedFee(1800);
                    setIsCustomFee(false);
                  }}
                  className={`min-h-11 rounded-full font-label-md text-label-md transition-colors flex items-center justify-center gap-1 ${
                    selectedFee === 1800 && !isCustomFee
                      ? "bg-primary text-white font-semibold shadow-sm"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  <span runway-id="quick-log.fee.atm.icon" className="material-symbols-outlined text-[14px]">bolt</span>
                  +₱18
                </button>
                <button
                  runway-id="quick-log.fee.custom"
                  type="button"
                  onClick={() => {
                    const custom = prompt("Enter custom fee in Pesos:", "25.00");
                    if (custom !== null) {
                      const parsed = parseFloat(custom);
                      if (!isNaN(parsed) && parsed >= 0) {
                        setSelectedFee(Math.round(parsed * 100));
                        setIsCustomFee(true);
                      }
                    }
                  }}
                  className={`min-h-11 rounded-full font-label-md text-label-md transition-colors flex items-center justify-center gap-0.5 ${
                    isCustomFee
                      ? "bg-primary text-white font-semibold shadow-sm"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  <span runway-id="quick-log.fee.custom.icon" className="material-symbols-outlined text-[14px]">edit</span>
                  {isCustomFee ? `+₱${(selectedFee / 100).toFixed(0)}` : "Custom"}
                </button>
              </div>
            </div>
          )}

          {/* Category Chips (if Expense) */}
          {mode === "expense" && (
            <div className="flex flex-col gap-space-xs">
              <span runway-id="quick-log.category.label" className="font-label-sm text-label-sm text-on-surface-variant tracking-wider uppercase">
                Category Allocation
              </span>
              <div className="flex items-center gap-space-xs overflow-x-auto pb-0.5 scrollbar-none">
                {categoriesList.map((cat) => {
                  const isSelected = cat === selectedCategory;
                  return (
                    <button
                      runway-id={`quick-log.category.${cat}`}
                      key={cat}
                      type="button"
                      aria-pressed={isSelected} onClick={() => setSelectedCategory(cat)}
                      className={`flex-shrink-0 flex items-center gap-1 min-h-11 px-space-md py-1 rounded-full font-label-md text-label-md transition-colors ${
                        isSelected
                          ? "bg-primary-container text-surface-container-lowest shadow-sm"
                          : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
                      }`}
                    >
                      {isSelected && (
                        <span runway-id={`quick-log.category.${cat}.selected-icon`} className="material-symbols-outlined text-[14px]">check</span>
                      )}
                      <span runway-id={`quick-log.category.${cat}.label`}>{cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Numeric Touch Keypad */}
          <div className="grid grid-cols-3 gap-2 pt-space-xs select-none">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((k) => (
              <button
                runway-id={`quick-log.key.${k}`}
                key={k}
                type="button"
                onClick={() => handleKeyClick(k)}
                className="h-16 rounded-[24px] border border-white/80 bg-white/70 text-on-surface font-currency-lg text-currency-lg active:bg-surface-container transition-transform active:scale-95 flex items-center justify-center font-bold"
              >
                {k}
              </button>
            ))}
            <button
              runway-id="quick-log.key.backspace"
              type="button"
              onClick={handleBackspace}
              aria-label="Backspace"
              className="h-16 rounded-[24px] border border-white/80 bg-white/70 text-on-surface active:bg-surface-container transition-transform active:scale-95 flex items-center justify-center"
            >
              <span runway-id="quick-log.key.backspace.icon" className="material-symbols-outlined text-[22px]">backspace</span>
            </button>
          </div>

          {/* Confirm Button Area */}
          <div className="flex flex-col gap-space-xs pt-space-xs pb-space-md">
            <button
              runway-id="quick-log.confirm"
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || baseCents <= 0}
              className="w-full min-h-16 py-4 rounded-full bg-primary text-white font-label-md text-label-md font-semibold shadow-md active:scale-[0.98] transition-all flex flex-wrap gap-3 items-center justify-between px-4 disabled:opacity-50"
            >
              <div className="flex items-center gap-space-xs">
                <span runway-id="quick-log.confirm.icon" className="material-symbols-outlined text-[18px]">verified</span>
                <span runway-id="quick-log.confirm.label">
                  {mode === "expense"
                    ? "Confirm Outflow"
                    : mode === "transfer"
                    ? "Confirm Transfer"
                    : "Confirm Inflow"}
                </span>
              </div>
              <div className="flex items-center gap-space-xs">
                <span runway-id="quick-log.confirm.total" className="font-currency-md text-currency-md tracking-tight">
                  {formatPHP(totalCents)}
                </span>
                <span runway-id="quick-log.confirm.arrow" className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </div>
            </button>

            <div className="flex items-center justify-center gap-1.5 text-center">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
              <span runway-id="quick-log.offline-note" className="font-label-sm text-label-sm text-on-surface-variant">
                Entries are saved offline, then synced when online.
              </span>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
