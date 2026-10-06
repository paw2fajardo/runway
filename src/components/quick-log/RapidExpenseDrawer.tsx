"use client";

import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { formatPHP } from "@/lib/currency";
import { queueOfflineTransaction } from "@/lib/offline-db";
import { Dialog } from "@/components/ui/Dialog";

interface CategoryOption {
  id: string;
  name: string;
  isIncome: boolean;
  isSystemFee: boolean;
  isArchived: boolean;
}

interface AccountOption {
  id: string;
  name: string;
  type: string;
  currentBalance: number;
}

const DEFAULT_CATEGORIES = [
  "ATM / Pocket Cash",
  "Food & Groceries",
  "Utilities",
  "Transit / Grab",
  "Subscriptions",
  "General Living",
];
const LAST_ACCOUNT_BY_CATEGORY_KEY = "runway.quick-log.last-source-account-by-category";
const categoryStorageKey = (category: string) => category.trim().toLocaleLowerCase();

function parseAmountToCents(value: string) {
  const [pesos = "0", fraction = ""] = value.split(".");
  const cents = Number(pesos || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : 0;
}

function normalizeAmountInput(value: string) {
  const normalized = value.replace(/,/g, "").replace(/[^\d.]/g, "");
  const decimalIndex = normalized.indexOf(".");
  return decimalIndex < 0
    ? normalized
    : `${normalized.slice(0, decimalIndex)}.${normalized.slice(decimalIndex + 1).replace(/\./g, "").slice(0, 2)}`;
}

interface RapidExpenseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  accounts?: AccountOption[];
  daysToPayday?: number;
  editTransaction?: {
    id: string; type: "income" | "expense" | "transfer"; description: string;
    transactedAt: string; legs: { leg: { accountId: string | null; categoryId: string | null; amount: number }; account: { id: string; name: string } | null; category: { id: string; name: string; isSystemFee: boolean } | null }[];
  onEditSuccess?: () => void;
}

export function RapidExpenseDrawer({
  isOpen,
  onClose,
  onSuccess,
  accounts = [],
  daysToPayday,
  editTransaction,
  onEditSuccess,
}: RapidExpenseDrawerProps) {
  const [mode, setMode] = useState<"expense" | "transfer" | "inflow">("expense");
  const [rawAmount, setRawAmount] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [selectedDestId, setSelectedDestId] = useState<string>("");
  const [selectedFee, setSelectedFee] = useState<number>(0);
  const [isCustomFee, setIsCustomFee] = useState<boolean>(false);
  const [rawCustomFee, setRawCustomFee] = useState("");
  const [transactedAt, setTransactedAt] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("ATM / Pocket Cash");
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [lastAccountByCategory, setLastAccountByCategory] = useState<Record<string, string>>({});
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const categorySearchRef = useRef<HTMLInputElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const customFeeInputRef = useRef<HTMLInputElement>(null);

  // Set default source account
  useEffect(() => {
    if (accounts.length > 0 && !selectedSourceId) {
      setSelectedSourceId(accounts[0].id);
    }
    if (accounts.length > 1 && !selectedDestId) {
      setSelectedDestId(accounts[1].id);
    }
  }, [accounts, selectedSourceId, selectedDestId]);

  const loadCategories = async () => {
    setIsCategoriesLoading(true);
    try {
      const response = await fetch("/api/categories");
      if (!response.ok) throw new Error("Categories are unavailable. Retry before logging an expense.");
      const items = await response.json() as CategoryOption[];
      const eligible = items.filter((item) => !item.isArchived && !item.isSystemFee && (editTransaction?.type === "income" ? item.isIncome : !item.isIncome));
      setCategories(eligible);
      setSelectedCategoryId((current) => eligible.some((item) => item.id === current) ? current : eligible[0]?.id ?? "");
      setSelectedCategory((current) => eligible.some((item) => item.id === selectedCategoryId)
        ? eligible.find((item) => item.id === selectedCategoryId)?.name ?? current
        : eligible[0]?.name ?? current);
      setCategoryError(null);
    } catch {
      setCategories([]);
      setSelectedCategoryId("");
      setCategoryError("Categories are unavailable. Retry before logging an expense.");
    } finally { setIsCategoriesLoading(false); }
  };

  useEffect(() => { if (isOpen) void loadCategories(); }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !editTransaction) return;
    const accountLegs = editTransaction.legs.filter((item) => item.leg.accountId);
    const categoryLegs = editTransaction.legs.filter((item) => item.leg.categoryId && !item.category?.isSystemFee);
    const fee = editTransaction.legs.find((item) => item.category?.isSystemFee)?.leg.amount ?? 0;
    const date = new Date(editTransaction.transactedAt);
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setMode(editTransaction.type === "income" ? "inflow" : editTransaction.type);
    const amount = editTransaction.type === "income" ? accountLegs[0]?.leg.amount ?? 0 : editTransaction.type === "transfer" ? accountLegs.find((item) => item.leg.amount > 0)?.leg.amount ?? 0 : -Math.min(...accountLegs.map((item) => item.leg.amount)) - fee;
    setRawAmount((amount / 100).toFixed(2));
    setDescriptionInput(editTransaction.description);
    setSelectedFee(fee);
    setIsCustomFee(fee !== 0 && ![1500, 1800].includes(fee));
    setRawCustomFee(fee ? (fee / 100).toFixed(2) : "");
    const source = editTransaction.type === "income" ? accountLegs[0] : accountLegs.find((item) => item.leg.amount < 0);
    const dest = editTransaction.type === "transfer" ? accountLegs.find((item) => item.leg.amount > 0) : accountLegs[0];
    if (source?.leg.accountId) setSelectedSourceId(source.leg.accountId);
    if (dest?.leg.accountId) setSelectedDestId(dest.leg.accountId);
    setSelectedCategoryId(categoryLegs[0]?.leg.categoryId ?? "");
    setSelectedCategory(categoryLegs[0]?.category?.name ?? "");
    setTransactedAt(localDate);
  }, [isOpen, editTransaction]);

  useEffect(() => {
    if (!isOpen) return;
    setSubmitError(null);
    if (!editTransaction) {
      setRawAmount("");
      setSelectedFee(0);
      setIsCustomFee(false);
      setRawCustomFee("");
      setMode("expense");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsCategoryOpen(false);
      setCategorySearch("");
      return;
    }
    if (isCategoryOpen && !window.matchMedia("(pointer: coarse)").matches) categorySearchRef.current?.focus();
  }, [isOpen, isCategoryOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !isCategoryOpen) return;
    const menu = categoryMenuRef.current;
    const trigger = categoryTriggerRef.current;
    if (!menu || !trigger) return;
    const viewport = window.visualViewport;

    const positionMenu = () => {
      const anchor = trigger.getBoundingClientRect();
      const dialog = trigger.closest("dialog");
      const dialogBounds = dialog?.getBoundingClientRect();
      const footer = dialog?.querySelector<HTMLElement>(".quick-log-footer");
      const footerTop = footer?.getBoundingClientRect().top ?? dialogBounds?.bottom ?? window.innerHeight;
      const topLimit = Math.max(8, dialogBounds?.top ?? 8);
      const bottomLimit = Math.min(window.innerHeight - 8, footerTop - 8);
      const below = bottomLimit - anchor.bottom - 8;
      const above = anchor.top - topLimit - 8;
      const placeAbove = below < 220 && above > below;
      const available = Math.max(120, placeAbove ? above : below);
      const maxHeight = Math.min(320, available);
      const width = Math.min(anchor.width, window.innerWidth - 24);
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));

      menu.style.left = `${left}px`;
      menu.style.top = `${placeAbove ? Math.max(topLimit, anchor.top - maxHeight - 8) : anchor.bottom + 8}px`;
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${maxHeight}px`;
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && !trigger.contains(target)) {
        setIsCategoryOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsCategoryOpen(false);
      setCategorySearch("");
      trigger.focus();
    };

    positionMenu();
    menu.showPopover();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    viewport?.addEventListener("resize", positionMenu);
    viewport?.addEventListener("scroll", positionMenu);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      viewport?.removeEventListener("resize", positionMenu);
      viewport?.removeEventListener("scroll", positionMenu);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      if (menu.matches(":popover-open")) menu.hidePopover();
    };
  }, [isOpen, isCategoryOpen]);

  useEffect(() => {
    if (isCustomFee) customFeeInputRef.current?.focus({ preventScroll: true });
  }, [isCustomFee]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LAST_ACCOUNT_BY_CATEGORY_KEY);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const validEntries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
        setLastAccountByCategory(Object.fromEntries(validEntries));
      }
    } catch {
      // Ignore unavailable storage or stale preference data.
    }
  }, []);
  if (!isOpen) return null;

  const baseCents = parseAmountToCents(rawAmount);
  const totalCents =
    mode === "expense" || mode === "transfer"
      ? baseCents + selectedFee
      : baseCents;

  // Runway impact calculation
  const impactPerDay = daysToPayday !== undefined && daysToPayday > 0
    ? (totalCents / daysToPayday)
    : 0;

  const handleAmountChange = (value: string) => {
    setRawAmount(normalizeAmountInput(value));
  };

  const handleConfirm = async () => {
    if (isSubmitting || baseCents <= 0 || (editTransaction && !descriptionInput.trim()) || (mode === "expense" && (isCategoriesLoading || !!categoryError)) ||
      (mode !== "inflow" && isCustomFee && rawCustomFee.trim() === "")) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const sourceAcc = accounts.find((a) => a.id === selectedSourceId);
      const destAcc = accounts.find((a) => a.id === selectedDestId);

      const description = editTransaction ? descriptionInput.trim() :
        mode === "transfer"
          ? `${sourceAcc?.name || "Source"} to ${destAcc?.name || "Destination"}`
          : mode === "expense"
          ? selectedCategory || "Expense"
          : "Salary / Inflow";

      const transactionType = mode === "inflow" ? ("income" as const) : mode;

      if (editTransaction) {
        const payload = {
          type: transactionType,
          description,
          transacted_at: new Date(transactedAt).toISOString(),
          source_account_id: transactionType !== "income" ? selectedSourceId : null,
          destination_account_id: transactionType === "income" ? selectedSourceId : transactionType === "transfer" ? selectedDestId : null,
          category_id: (mode === "expense" || mode === "inflow") ? selectedCategoryId || null : null,
          gross_outflow: mode === "expense" || mode === "transfer" ? totalCents : undefined,
          net_inflow: mode === "inflow" ? baseCents : mode === "transfer" ? baseCents : undefined,
          fee_amount: mode === "inflow" ? undefined : selectedFee,
        };
        const response = await fetch(`/api/transactions/${editTransaction.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Couldn’t update this entry. Your changes are still here. Try again."); }
        onEditSuccess?.();
        onClose();
        return;
      }

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
        category_id: transactionType === "expense" ? selectedCategoryId : undefined,
        category_name: transactionType === "expense" && !selectedCategoryId ? selectedCategory : undefined,
        transacted_at: new Date().toISOString(),
      });

      if (mode === "expense" && selectedSourceId) {
        const nextPreferences = {
          ...lastAccountByCategory,
          [categoryStorageKey(selectedCategory)]: selectedSourceId,
        };
        setLastAccountByCategory(nextPreferences);
        try {
          window.localStorage.setItem(LAST_ACCOUNT_BY_CATEGORY_KEY, JSON.stringify(nextPreferences));
        } catch {
          // Keep the queued expense even when preference storage is unavailable.
        }
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Failed to queue transaction:", err);
      setSubmitError(err instanceof Error ? err.message : "Couldn’t save this entry. Your details are still here. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoriesList = [...new Map(
    [...(editTransaction && mode === "inflow" ? [] : DEFAULT_CATEGORIES), ...categories.map((category) => category.name), ...(mode === "expense" ? customCategories : [])].map((category) => [category.toLocaleLowerCase(), category])
  ).values()];
  const filteredCategories = categoriesList.filter((category) =>
    category.toLocaleLowerCase().includes(categorySearch.trim().toLocaleLowerCase())
  );
  const normalizedCategorySearch = categorySearch.trim();
  const exactCategory = categoriesList.find((category) =>
    category.toLocaleLowerCase() === normalizedCategorySearch.toLocaleLowerCase()
  );
  const canAddCategory = normalizedCategorySearch.length > 0 && !exactCategory;
  const activeCategory = filteredCategories[activeCategoryIndex];
  const selectCategory = (category: string) => {
    setSelectedCategory(category);
    const savedCategory = categories.find((item) => item.name.toLocaleLowerCase() === category.toLocaleLowerCase());
    setSelectedCategoryId(savedCategory?.id ?? "");
    const rememberedAccount = lastAccountByCategory[categoryStorageKey(category)];
    if (rememberedAccount && accounts.some((account) => account.id === rememberedAccount)) {
      setSelectedSourceId(rememberedAccount);
    }
    setIsCategoryOpen(false);
    setCategorySearch("");
    categoryTriggerRef.current?.focus();
  };
  const addCategory = (category: string) => {
    const normalized = category.trim();
    if (!normalized) return;
    const existing = categoriesList.find((name) => name.toLocaleLowerCase() === normalized.toLocaleLowerCase());
    const selected = existing ?? normalized;
    if (!existing) setCustomCategories((current) => [...current, selected]);
    selectCategory(selected);
  };
  const handleCategorySearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveCategoryIndex((index) => Math.min(index + 1, filteredCategories.length - (canAddCategory ? 0 : 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveCategoryIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && canAddCategory && activeCategoryIndex === filteredCategories.length) {
      event.preventDefault();
      addCategory(normalizedCategorySearch);
    } else if (event.key === "Enter" && activeCategory) {
      event.preventDefault();
      selectCategory(activeCategory);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsCategoryOpen(false);
      setCategorySearch("");
      categoryTriggerRef.current?.focus();
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} title={editTransaction ? "Edit entry" : "Quick log"} className="app-dialog-quick-log">
      <div className="flex h-full min-h-0 flex-col pb-safe">
        {/* Transaction Type Selector */}
        <div className="relative shrink-0 pb-space-xs">
          <div className="flex items-center justify-between w-full">
            {/* Segmented Mode Control */}
            <div className="grid grid-cols-3 w-full p-1 bg-surface-container rounded-full gap-1">
              <button
                runway-id="quick-log.mode.expense"
                type="button"
                aria-pressed={mode === "expense"} disabled={!!editTransaction} onClick={() => setMode("expense")}
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
                aria-pressed={mode === "transfer"} disabled={!!editTransaction} onClick={() => setMode("transfer")}
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
                aria-pressed={mode === "inflow"} disabled={!!editTransaction} onClick={() => setMode("inflow")}
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
            {editTransaction && <p className="mt-2 text-center text-body-sm text-on-surface-variant">Entry type can’t be changed while editing.</p>}

          </div>
        </div>

        {/* Scrollable Form Body */}
        <div className="quick-log-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain pr-1">
          {/* Amount Display & Runway Impact */}
          <section className="flex flex-col gap-2" aria-labelledby="quick-log-amount-label">
            <label id="quick-log-amount-label" htmlFor="quick-log-amount" className="text-sm font-semibold text-on-surface">
              Amount
            </label>
            <div className="flex min-h-16 items-center gap-3 rounded-xl border border-outline-variant bg-white px-4 transition focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20">
              <span runway-id="quick-log.amount.currency" aria-hidden="true" className="text-xl font-semibold text-on-surface-variant">₱</span>
              <input
                runway-id="quick-log.amount.value"
                id="quick-log-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                maxLength={18}
                value={rawAmount}
                onChange={(event) => handleAmountChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleConfirm();
                  }
                }}
                aria-label="Amount in Philippine pesos"
                aria-describedby="quick-log-amount-hint"
                placeholder="0.00"
                className="min-w-0 flex-1 bg-transparent py-2 text-3xl font-semibold tabular-nums tracking-tight text-on-surface outline-none placeholder:text-outline-variant"
              />
            </div>
            <p id="quick-log-amount-hint" runway-id="quick-log.amount.hint" className="text-sm text-on-surface-variant">
              Enter an amount in pesos.
            </p>
            {editTransaction && <div className="flex flex-col gap-2"><label htmlFor="quick-log-description" className="text-sm font-semibold text-on-surface">Description</label><input id="quick-log-description" value={descriptionInput} onChange={(event) => setDescriptionInput(event.target.value)} className="min-h-12 rounded-xl border border-outline-variant bg-white px-4 text-on-surface" /></div>}

            {/* Runway Impact Readout */}
            {mode === "expense" && daysToPayday !== undefined && daysToPayday > 0 && baseCents > 0 && (
              <div className="inline-flex items-center gap-2 self-start rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface-variant">
                <span runway-id="quick-log.runway-impact.icon" className="material-symbols-outlined text-error text-[14px]">
                  trending_down
                </span>
                <span runway-id="quick-log.runway-impact.label">
                  Estimated runway impact: {" "}
                  <strong runway-id="quick-log.runway-impact.value" className="font-semibold text-error">
                    -{formatPHP(impactPerDay)}/day
                  </strong>{" "}
                </span>
              </div>
            )}
          </section>

          {/* Category Allocation (if Expense) */}
          <div className={`quick-log-core-fields${mode === "inflow" ? " quick-log-core-fields-single" : ""}`}>
            {(mode === "expense" || (editTransaction && mode === "inflow")) && (
              <div className="flex min-w-0 flex-col gap-2">
                <span runway-id="quick-log.category.label" className="text-sm font-semibold text-on-surface">
                  Category
                </span>
                <div className="relative">
                <button
                  runway-id="quick-log.category.select"
                  ref={categoryTriggerRef}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={isCategoryOpen}
                  aria-controls="quick-log-category-options"
                  aria-label={`Category allocation: ${selectedCategory}`}
                  onClick={() => {
                    setCategorySearch("");
                    setActiveCategoryIndex(categoriesList.indexOf(selectedCategory));
                    setIsCategoryOpen((open) => !open);
                  }}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-white/70 bg-white/75 px-4 text-left text-body-md text-on-surface shadow-sm transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="truncate">{selectedCategory}</span>
                  <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-on-surface-variant transition-transform ${isCategoryOpen ? "rotate-180" : ""}`} />
                </button>

                {isCategoryOpen && (
                  <div
                    runway-id="quick-log.category.menu"
                    ref={categoryMenuRef}
                    popover="manual"
                    className="quick-log-category-popover flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-2 shadow-lg"
                  >
                    <div className="relative">
                      <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                      <input
                        runway-id="quick-log.category.search"
                        ref={categorySearchRef}
                        type="search"
                        maxLength={100}
                        role="combobox"
                        aria-label="Search categories"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls="quick-log-category-options"
                        aria-activedescendant={canAddCategory && activeCategoryIndex === filteredCategories.length
                          ? "quick-log-category-option-create"
                          : activeCategory ? `quick-log-category-option-${categoriesList.indexOf(activeCategory)}` : undefined}
                        value={categorySearch}
                        onChange={(event) => {
                          const value = event.target.value;
                          const trimmedValue = value.trim();
                          const hasExactMatch = categoriesList.some((category) => category.toLocaleLowerCase() === trimmedValue.toLocaleLowerCase());
                          const matchingCategories = categoriesList.filter((category) => category.toLocaleLowerCase().includes(trimmedValue.toLocaleLowerCase()));
                          setCategorySearch(value);
                          setActiveCategoryIndex(trimmedValue && !hasExactMatch ? matchingCategories.length : 0);
                        }}
                        onKeyDown={handleCategorySearchKeyDown}
                        placeholder="Search categories"
                        className="min-h-11 w-full rounded-xl bg-surface-container-low pl-10 pr-3 text-body-md text-on-surface placeholder:text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      />
                    </div>

                    <ul id="quick-log-category-options" runway-id="quick-log.category.options" role="listbox" aria-label="Categories" className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
                      {filteredCategories.map((category, index) => {
                        const isSelected = category === selectedCategory;
                        const optionId = `quick-log-category-option-${categoriesList.indexOf(category)}`;
                        return (
                          <li key={category} role="presentation">
                            <button
                              id={optionId}
                              runway-id={`quick-log.category.option.${categoriesList.indexOf(category)}`}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              tabIndex={-1}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveCategoryIndex(index)}
                              onClick={() => selectCategory(category)}
                              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-body-md transition-colors ${
                                index === activeCategoryIndex ? "bg-primary/10 text-primary" : "text-on-surface hover:bg-surface-container-low"
                              }`}
                            >
                              <span>{category}</span>
                              {isSelected && <Check size={17} aria-hidden="true" className="shrink-0 text-primary" />}
                            </button>
                          </li>
                        );
                      })}
                      {canAddCategory && (
                        <li role="presentation">
                          <button
                            id="quick-log-category-option-create"
                            runway-id="quick-log.category.add"
                            type="button"
                            role="option"
                            aria-selected={activeCategoryIndex === filteredCategories.length}
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveCategoryIndex(filteredCategories.length)}
                            onClick={() => addCategory(normalizedCategorySearch)}
                            className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-body-md transition-colors ${
                              activeCategoryIndex === filteredCategories.length ? "bg-primary/10 text-primary" : "text-on-surface hover:bg-surface-container-low"
                            }`}
                          >
                            <span aria-hidden="true" className="text-lg leading-none">+</span>
                            <span>Add category “{normalizedCategorySearch}”</span>
                          </button>
                        </li>
                      )}
                      {filteredCategories.length === 0 && !canAddCategory && (
                        <li runway-id="quick-log.category.no-results" role="option" aria-selected="false" className="px-3 py-3 text-body-sm text-on-surface-variant">
                          No categories found.
                        </li>
                      )}
                    </ul>
                    {isCategoriesLoading && <p role="status" className="px-3 py-2 text-body-sm text-on-surface-variant">Loading saved categories…</p>}
                    {categoryError && <div className="px-3 py-2"><p role="alert" className="text-body-sm text-error">{categoryError}</p><button type="button" onClick={() => void loadCategories()} className="min-h-11 text-secondary underline">Retry saved categories</button></div>}
                  </div>
                )}
                </div>
              </div>
            )}
            {editTransaction && <div className="flex flex-col gap-2"><label htmlFor="quick-log-date" className="text-sm font-semibold text-on-surface">Date and time</label><input id="quick-log-date" type="datetime-local" value={transactedAt} onChange={(event) => setTransactedAt(event.target.value)} className="min-h-12 rounded-xl border border-outline-variant bg-white px-4 text-on-surface" /></div>}

            {/* Source Account Selector */}
            <div className="flex min-w-0 flex-col gap-2">
              <label runway-id="quick-log.source-account.label" htmlFor="quick-log-source-account" className="text-sm font-semibold text-on-surface">
                {mode === "inflow" ? "Deposit to" : mode === "transfer" ? "Transfer from" : "Paid from"}
              </label>
              <div className="relative">
              <select
                runway-id="quick-log.source-account.select"
                id="quick-log-source-account"
                value={selectedSourceId}
                disabled={accounts.length === 0}
                onChange={(event) => setSelectedSourceId(event.target.value)}
                className="min-h-12 w-full appearance-none rounded-xl border border-white/70 bg-white/75 px-4 pr-11 text-body-md text-on-surface shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
              >
                {accounts.length === 0 && <option value="">No accounts available</option>}
                {accounts.map((account) => (
                  <option runway-id={`quick-log.source-account.option.${account.id}`} key={account.id} value={account.id}>
                    {account.name} · ₱{(account.currentBalance / 100000).toFixed(1)}k
                  </option>
                ))}
              </select>
              <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              </div>
            </div>

          {/* Destination Account (if Transfer mode) */}
          {mode === "transfer" && (
            <div className="flex min-w-0 flex-col gap-2">
              <span runway-id="quick-log.destination-account.label" className="text-sm font-semibold text-on-surface">
                Transfer to
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
          </div>

          {/* Instant Fee Chips (Only for Expense & Transfer) */}
          {mode !== "inflow" && (
            <div className="flex flex-col gap-3 border-t border-outline-variant/70 pt-4">
              <div className="flex items-center justify-between gap-3">
                <span runway-id="quick-log.fee.label" className="text-sm font-semibold text-on-surface">
                  Fee
                </span>
                <span runway-id="quick-log.fee.selected-label" className="font-label-sm text-label-sm text-on-tertiary-container font-currency-sm">
                  {isCustomFee
                    ? "Custom fee"
                    : selectedFee === 1800
                    ? "External ATM fee"
                    : selectedFee === 1500
                    ? "InstaPay fee"
                    : "No fee"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-space-xs">
                <button
                  runway-id="quick-log.fee.zero"
                  type="button"
                  aria-pressed={selectedFee === 0 && !isCustomFee}
                  onClick={() => {
                    setSelectedFee(0);
                    setIsCustomFee(false);
                    setRawCustomFee("");
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
                  aria-pressed={selectedFee === 1500 && !isCustomFee}
                  onClick={() => {
                    setSelectedFee(1500);
                    setIsCustomFee(false);
                    setRawCustomFee("");
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
                  aria-pressed={selectedFee === 1800 && !isCustomFee}
                  onClick={() => {
                    setSelectedFee(1800);
                    setIsCustomFee(false);
                    setRawCustomFee("");
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
                    if (!isCustomFee) {
                      setSelectedFee(0);
                      setRawCustomFee("");
                    }
                    setIsCustomFee(true);
                  }}
                  aria-pressed={isCustomFee}
                  className={`min-h-11 rounded-full font-label-md text-label-md transition-colors flex items-center justify-center gap-0.5 ${
                    isCustomFee
                      ? "bg-primary text-white font-semibold shadow-sm"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  <span runway-id="quick-log.fee.custom.icon" className="material-symbols-outlined text-[14px]">edit</span>
                  Custom
                </button>
              </div>
              {isCustomFee && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="quick-log-custom-fee" className="text-sm font-semibold text-on-surface">
                    Custom fee amount
                  </label>
                  <div className="flex min-h-12 items-center gap-3 rounded-xl border border-outline-variant bg-white px-4 transition focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20">
                    <span aria-hidden="true" className="text-base font-semibold text-on-surface-variant">₱</span>
                    <input
                      id="quick-log-custom-fee"
                      runway-id="quick-log.fee.custom.amount"
                      ref={customFeeInputRef}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={18}
                      value={rawCustomFee}
                      onChange={(event) => {
                        const value = normalizeAmountInput(event.target.value);
                        setRawCustomFee(value);
                        setSelectedFee(parseAmountToCents(value));
                      }}
                      aria-label="Custom fee in Philippine pesos"
                      placeholder="0.00"
                      className="min-w-0 flex-1 bg-transparent py-2 text-lg font-semibold tabular-nums text-on-surface outline-none placeholder:text-outline-variant"
                    />
                  </div>
                  <p className="text-sm text-on-surface-variant">Enter 0 if there’s no fee.</p>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Confirm Button Area */}
        <div className="quick-log-footer mt-4 shrink-0 border-t border-outline-variant/70 pt-4">
          {!editTransaction && <a href="/transactions" className="mb-3 block text-center text-body-sm text-secondary underline">View logged activity</a>}
          {submitError && <p runway-id="quick-log.submit.error" role="alert" className="mb-space-xs text-center text-body-sm text-error">{submitError}</p>}
          <div className="flex flex-col gap-space-xs pb-space-xs">
            <button
              runway-id="quick-log.confirm"
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || baseCents <= 0 || (mode === "expense" && (isCategoriesLoading || !!categoryError)) || (mode !== "inflow" && isCustomFee && rawCustomFee.trim() === "")}
              className="w-full min-h-16 py-4 rounded-full bg-primary text-white font-label-md text-label-md font-semibold shadow-md active:scale-[0.98] transition-all flex flex-wrap gap-3 items-center justify-between px-4 disabled:opacity-50"
            >
              <div className="flex items-center gap-space-xs">
                <span runway-id="quick-log.confirm.icon" className="material-symbols-outlined text-[18px]">verified</span>
                <span runway-id="quick-log.confirm.label">
                  {mode === "expense"
                    ? "Save expense"
                    : mode === "transfer"
                    ? "Save transfer"
                    : "Save income"}
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
