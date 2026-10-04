"use client";

import React, { useState } from "react";
import { formatPHP, pesosToCents } from "@/lib/currency";
import { Dialog } from "@/components/ui/Dialog";

interface ReconcileAccount {
  id: string;
  name: string;
  currentBalance: number;
}

interface ReconcileModalProps {
  account: ReconcileAccount | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReconcileModal({
  account,
  isOpen,
  onClose,
  onSuccess,
}: ReconcileModalProps) {
  const [observedPesos, setObservedPesos] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !account) return null;

  const currentCents = account.currentBalance;
  const observedCents =
    observedPesos.trim() !== ""
      ? pesosToCents(parseFloat(observedPesos) || 0)
      : currentCents;
  const discrepancy = observedCents - currentCents;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/checkpoints/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: account.id,
          observed_balance: observedCents,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to reconcile balance.");
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Error reconciling");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title="Balance checkpoint">
      <div className="flex flex-col gap-4">

        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Reconcile <strong>{account.name}</strong> to your bank or wallet&apos;s actual
          ground truth. LedgerFlow will automatically compensate any drift.
        </p>

        {/* Current vs Observed */}
        <div className="bg-surface-container-low p-space-md rounded-xl flex flex-col space-y-2">
          <div className="flex justify-between items-center text-on-surface-variant font-label-sm text-label-sm">
            <span>Recorded Balance:</span>
            <span className="font-currency-sm text-currency-sm font-semibold text-on-surface">
              {formatPHP(currentCents)}
            </span>
          </div>

          <div className="flex flex-col space-y-1 pt-1 border-t border-outline-variant/20">
            <label
              htmlFor="observedInput"
              className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant"
            >
              Observed Live Balance (₱)
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-on-surface-variant font-currency-md text-currency-md">
                ₱
              </span>
              <input
                id="observedInput"
                type="number"
                step="0.01"
                placeholder={(currentCents / 100).toFixed(2)}
                value={observedPesos}
                onChange={(e) => setObservedPesos(e.target.value)}
                className="w-full h-11 pl-8 pr-3 rounded-lg bg-surface-container-lowest border border-outline-variant/50 font-currency-md text-currency-md text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary/50"
                autoFocus
              />
            </div>
          </div>
        </div>

        {/* Drift Callout */}
        <div className="flex items-center justify-between px-1">
          <span className="font-label-sm text-label-sm text-on-surface-variant">
            Drift Adjustment:
          </span>
          <span
            className={`font-currency-sm text-currency-sm font-semibold ${
              discrepancy === 0
                ? "text-on-surface-variant"
                : discrepancy > 0
                ? "text-secondary"
                : "text-error"
            }`}
          >
            {discrepancy === 0
              ? "₱0.00 (Exact Match)"
              : `${discrepancy > 0 ? "+" : ""}${formatPHP(discrepancy)}`}
          </span>
        </div>

        {errorMsg && (
          <p className="text-error font-body-sm text-body-sm text-center">
            {errorMsg}
          </p>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg bg-surface-container-low text-on-surface font-label-md text-label-md font-semibold hover:bg-surface-container transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="h-11 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-semibold hover:opacity-90 active:scale-95 transition disabled:opacity-50"
          >
            {isSubmitting ? "Adjusting..." : "Confirm Snapshot"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
