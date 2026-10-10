"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { clearPrivatePageCaches, NotificationSettings } from "@/components/payday/NotificationSettings";
type Category = { id: string; name: string; isIncome: boolean; isArchived: boolean; isSystemFee: boolean };

const moneyInput = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export default function SettingsPage() {
  const [burnLoading, setBurnLoading] = useState(true);
  const [burnSaving, setBurnSaving] = useState(false);
  const [burnLoadError, setBurnLoadError] = useState<string | null>(null);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [burnSuccess, setBurnSuccess] = useState(false);
  const [dailyBurn, setDailyBurn] = useState("");
  const [billReminderTime, setBillReminderTime] = useState("09:00");
  const [billReminderLoading, setBillReminderLoading] = useState(true);
  const [billReminderSaving, setBillReminderSaving] = useState(false);
  const [billReminderLoadError, setBillReminderLoadError] = useState<string | null>(null);
  const [billReminderError, setBillReminderError] = useState<string | null>(null);
  const [billReminderSuccess, setBillReminderSuccess] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"expense" | "income">("expense");
  const [categorySaving, setCategorySaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const loadDailyBurn = useCallback(async () => {
    setBurnLoading(true);
    try {
      const response = await fetch("/api/runway/settings?field=daily_discretionary_burn_cents");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load daily spending allowance.");
      setDailyBurn(moneyInput(data.daily_discretionary_burn_cents));
      setBurnLoadError(null);
    } catch (error) {
      setBurnLoadError(error instanceof Error ? error.message : "Unable to load daily spending allowance.");
    } finally { setBurnLoading(false); }
  }, []);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const response = await fetch("/api/categories?include_archived=true");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load categories.");
      setCategories(data as Category[]);
      setCategoryError(null);
    } catch (error) { setCategoryError(error instanceof Error ? error.message : "Unable to load categories."); }
    finally { setCategoriesLoading(false); }
  }, []);

  const loadBillReminderTime = useCallback(async () => {
    setBillReminderLoading(true);
    try {
      const response = await fetch("/api/runway/settings?field=bill_reminder_time");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load bill reminder time.");
      setBillReminderTime(data.bill_reminder_time);
      setBillReminderLoadError(null);
    } catch (error) {
      setBillReminderLoadError(error instanceof Error ? error.message : "Unable to load bill reminder time.");
    } finally { setBillReminderLoading(false); }
  }, []);

  useEffect(() => { void loadDailyBurn(); void loadCategories(); void loadBillReminderTime(); }, [loadDailyBurn, loadCategories, loadBillReminderTime]);

  async function saveDailyBurn(event: FormEvent) {
    event.preventDefault();
    const match = dailyBurn.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    const cents = match ? Number(`${match[1]}${(match[2] || "").padEnd(2, "0")}`) : NaN;
    if (!Number.isSafeInteger(cents) || cents < 0) { setBurnError("Enter a nonnegative amount with up to two decimal places."); setBurnSuccess(false); return; }
    setBurnSaving(true); setBurnError(null); setBurnSuccess(false);
    try {
      const response = await fetch("/api/runway/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ daily_discretionary_burn_cents: cents }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save daily spending allowance.");
      setDailyBurn(moneyInput(data.daily_discretionary_burn_cents)); setBurnSuccess(true);
    } catch (error) { setBurnError(error instanceof Error ? error.message : "Unable to save daily spending allowance."); }
    finally { setBurnSaving(false); }
  }

  async function saveBillReminderTime(event: FormEvent) {
    event.preventDefault();
    setBillReminderSaving(true); setBillReminderError(null); setBillReminderSuccess(false);
    try {
      const response = await fetch("/api/runway/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill_reminder_time: billReminderTime }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save bill reminder time.");
      setBillReminderTime(data.bill_reminder_time); setBillReminderSuccess(true);
    } catch (error) {
      setBillReminderError(error instanceof Error ? error.message : "Unable to save bill reminder time.");
    } finally { setBillReminderSaving(false); }
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) { setCategoryError("Enter a category name."); return; }
    setCategorySaving(true); setCategoryError(null);
    try {
      const response = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, is_income: newKind === "income" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create category.");
      setNewName(""); await loadCategories();
    } catch (error) { setCategoryError(error instanceof Error ? error.message : "Unable to create category."); }
    finally { setCategorySaving(false); }
  }

  async function patchCategory(category: Category, patch: { name?: string; is_archived?: boolean }) {
    setCategoryError(null);
    try {
      const response = await fetch(`/api/categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update category.");
      setEditingId(null); await loadCategories();
    } catch (error) { setCategoryError(error instanceof Error ? error.message : "Unable to update category."); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword !== confirmPassword) { setPasswordError("New passwords do not match."); return; }
    setPasswordSaving(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to change password.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      await clearPrivatePageCaches().catch(() => undefined);
      window.location.assign("/login");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Unable to change password.");
    } finally { setPasswordSaving(false); }
  }

  async function signOut() {
    setSigningOut(true); setAccountError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to sign out.");
      await clearPrivatePageCaches().catch(() => undefined);
      window.location.assign("/login");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Unable to sign out.");
      setSigningOut(false);
    }
  }

  const inputClass = "w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md";
  const sorted = [...categories].sort((a, b) => Number(a.isIncome) - Number(b.isIncome) || a.name.localeCompare(b.name));

  return <div className="flex min-h-screen flex-col bg-transparent">
    <Header title="Settings" />
    <main className="app-bottom-clearance mx-auto flex min-h-screen w-full max-w-[480px] md:max-w-3xl flex-1 flex-col bg-transparent px-margin pb-space-xl pt-20">
      <div className="space-y-2 py-2"><h1 className="text-headline-lg font-semibold tracking-tight">Settings</h1><p className="text-body-md text-on-surface-variant">Manage your spending allowance, bill reminders, and categories.</p></div>
      <section className="glass-panel mt-4 space-y-4 p-5" aria-labelledby="runway-settings-heading">
        <div><h2 id="runway-settings-heading" className="text-body-lg font-semibold">Daily spending allowance</h2><p className="text-body-sm text-on-surface-variant">Baseline discretionary spending for your runway calculation.</p></div>
        {burnLoading ? <p role="status" className="text-body-sm text-on-surface-variant">Loading daily allowance…</p> : burnLoadError ? <div><p role="alert" className="text-body-sm text-error">{burnLoadError}</p><button type="button" onClick={() => void loadDailyBurn()} className="min-h-11 text-secondary underline">Retry</button></div> : <form className="space-y-4" onSubmit={saveDailyBurn}>
          <div className="space-y-2"><label htmlFor="settings-daily-burn" className="font-semibold">Daily allowance (PHP)</label><input id="settings-daily-burn" className={inputClass} inputMode="decimal" value={dailyBurn} onChange={e => { setDailyBurn(e.target.value); setBurnSuccess(false); }} aria-describedby="settings-daily-burn-hint" /><p id="settings-daily-burn-hint" className="text-body-sm text-on-surface-variant">Enter an amount with up to two decimal places.</p></div>
          <button type="submit" disabled={burnSaving} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-white disabled:opacity-50">{burnSaving ? "Saving…" : "Save daily allowance"}</button>
          {burnError && <p role="alert" className="text-body-sm text-error">{burnError}</p>}
          {burnSuccess && <p role="status" className="text-body-sm text-secondary">Daily allowance saved.</p>}
        </form>}
      </section>
      <section className="glass-panel mt-5 space-y-4 p-5" aria-labelledby="category-settings-heading">
        <div><h2 id="category-settings-heading" className="text-body-lg font-semibold">Categories</h2><p className="text-body-sm text-on-surface-variant">Active categories are available in quick log. Archived categories remain on historical transactions.</p></div>
        <form onSubmit={createCategory} className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-[1fr_auto_auto]">
          <label className="sr-only" htmlFor="new-category-name">Category name</label><input id="new-category-name" className={inputClass} maxLength={100} value={newName} onChange={e => setNewName(e.target.value)} placeholder="New category name" />
          <label className="sr-only" htmlFor="new-category-kind">Category type</label><select id="new-category-kind" className={inputClass} value={newKind} onChange={e => setNewKind(e.target.value as "expense" | "income")}><option value="expense">Expense</option><option value="income">Income</option></select>
          <button type="submit" disabled={categorySaving} className="min-h-11 rounded-full bg-primary px-4 font-semibold text-white disabled:opacity-50">{categorySaving ? "Adding…" : "Add"}</button>
        </form>
        {categoryError && <div><p role="alert" className="text-body-sm text-error">{categoryError}</p><button type="button" onClick={() => void loadCategories()} className="min-h-11 text-secondary underline">Retry</button></div>}
        {categoriesLoading ? <p role="status" className="text-body-sm text-on-surface-variant">Loading categories…</p> : !categoryError && categories.length === 0 ? <p className="text-body-sm text-on-surface-variant">No categories yet. Add one above.</p> : <div className="space-y-2">
          {sorted.map(category => <div key={category.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-outline-variant/30 bg-white/50 p-3">
            <div className="min-w-0 flex-1"><div className="break-words font-semibold">{editingId === category.id ? <input aria-label={`Rename ${category.name}`} className={`${inputClass} min-h-10`} maxLength={100} value={editingName} onChange={e => setEditingName(e.target.value)} /> : category.name}</div><div className="text-body-sm text-on-surface-variant">{category.isIncome ? "Income" : "Expense"}{category.isArchived ? " · Archived" : ""}{category.isSystemFee ? " · System fee category" : ""}</div></div>
            <div className="flex items-center gap-1">
              {editingId === category.id ? <><button type="button" className="min-h-11 px-3 text-secondary" onClick={() => void patchCategory(category, { name: editingName.trim() })}>Save</button><button type="button" className="min-h-11 px-3 text-on-surface-variant" onClick={() => setEditingId(null)}>Cancel</button></> : <button type="button" className="min-h-11 px-3 text-secondary" onClick={() => { setEditingId(category.id); setEditingName(category.name); }}>Rename</button>}
              {!category.isSystemFee && editingId !== category.id && <button type="button" className="min-h-11 px-3 text-secondary" onClick={() => void patchCategory(category, { is_archived: !category.isArchived })}>{category.isArchived ? "Restore" : "Archive"}</button>}
            </div>
          </div>)}
        </div>}
      </section>
      <NotificationSettings />
      <section className="glass-panel mt-5 space-y-4 p-5" aria-labelledby="bill-reminder-settings-heading">
        <div><h2 id="bill-reminder-settings-heading" className="text-body-lg font-semibold">Bill reminder time</h2><p className="text-body-sm text-on-surface-variant">Choose when Runway sends alerts for bills due today and tomorrow. Time is shown in Manila time.</p></div>
        {billReminderLoading ? <p role="status" className="text-body-sm text-on-surface-variant">Loading bill reminder time…</p> : billReminderLoadError ? <div><p role="alert" className="text-body-sm text-error">{billReminderLoadError}</p><button type="button" onClick={() => void loadBillReminderTime()} className="min-h-11 text-secondary underline">Retry</button></div> : <form className="space-y-4" onSubmit={saveBillReminderTime}>
          <div className="space-y-2"><label htmlFor="settings-bill-reminder-time" className="font-semibold">Send reminders at</label><input id="settings-bill-reminder-time" className={inputClass} type="time" step="60" required value={billReminderTime} onChange={event => { setBillReminderTime(event.target.value); setBillReminderSuccess(false); }} /></div>
          <button type="submit" disabled={billReminderSaving} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-white disabled:opacity-50">{billReminderSaving ? "Saving…" : "Save reminder time"}</button>
          {billReminderError && <p role="alert" className="text-body-sm text-error">{billReminderError}</p>}
          {billReminderSuccess && <p role="status" className="text-body-sm text-secondary">Bill reminder time saved.</p>}
        </form>}
      </section>
      <section className="glass-panel mt-5 space-y-4 p-5" aria-labelledby="account-security-heading">
        <div><h2 id="account-security-heading" className="text-body-lg font-semibold">Account security</h2><p className="text-body-sm text-on-surface-variant">Change your owner password or end this session.</p></div>
        <form onSubmit={changePassword} className="space-y-3">
          <div className="space-y-2"><label htmlFor="settings-current-password" className="font-semibold">Current password</label><input id="settings-current-password" className={inputClass} type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></div>
          <div className="space-y-2"><label htmlFor="settings-new-password" className="font-semibold">New password</label><input id="settings-new-password" className={inputClass} type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={newPassword} onChange={e => setNewPassword(e.target.value)} /><p className="text-body-sm text-on-surface-variant">Use at least 12 characters. Changing it signs out all sessions.</p></div>
          <div className="space-y-2"><label htmlFor="settings-confirm-password" className="font-semibold">Confirm new password</label><input id="settings-confirm-password" className={inputClass} type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></div>
          <button type="submit" disabled={passwordSaving} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-white disabled:opacity-50">{passwordSaving ? "Changing password…" : "Change password"}</button>
          {passwordError && <p role="alert" className="text-body-sm text-error">{passwordError}</p>}
        </form>
        <div className="border-t border-outline-variant/40 pt-4"><button type="button" disabled={signingOut} onClick={() => void signOut()} className="min-h-11 rounded-full border border-outline-variant px-5 font-semibold text-on-surface disabled:opacity-50">{signingOut ? "Signing out…" : "Sign out"}</button>{accountError && <p role="alert" className="mt-2 text-body-sm text-error">{accountError}</p>}</div>
      </section>
    </main>
    <BottomNav />
  </div>;
}
