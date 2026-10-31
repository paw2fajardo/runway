"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { clearPrivatePageCaches, NotificationSettings } from "@/components/payday/NotificationSettings";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Trash2 } from "lucide-react";
import { signOut as authSignOut } from "@/lib/auth/client";
type Category = { id: string; name: string; isIncome: boolean; isArchived: boolean; isSystemFee: boolean };
type RegisteredPasskey = { id: string; deviceName: string; createdAt: string; lastUsedAt: string | null };

const moneyInput = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export default function SettingsPage() {
  const [burnLoading, setBurnLoading] = useState(true);
  const [burnSaving, setBurnSaving] = useState(false);
  const [burnLoadError, setBurnLoadError] = useState<string | null>(null);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [burnSuccess, setBurnSuccess] = useState(false);
  const [dailyBurn, setDailyBurn] = useState("");
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
  const [passkeys, setPasskeys] = useState<RegisteredPasskey[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeyRegistering, setPasskeyRegistering] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeySuccess, setPasskeySuccess] = useState<string | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);

  const loadPasskeys = useCallback(async () => {
    setPasskeysLoading(true);
    try {
      const res = await fetch("/api/auth/webauthn/credentials");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.passkeys)) setPasskeys(data.passkeys);
    } catch {
      // Non-blocking
    } finally {
      setPasskeysLoading(false);
    }
  }, []);

  useEffect(() => {
    setWebAuthnSupported(browserSupportsWebAuthn());
  }, []);

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

  useEffect(() => {
    void loadDailyBurn();
    void loadCategories();
    void loadPasskeys();
  }, [loadDailyBurn, loadCategories, loadPasskeys]);

  async function registerPasskey() {
    setPasskeyError(null);
    setPasskeySuccess(null);
    setPasskeyRegistering(true);
    try {
      const optionsRes = await fetch("/api/auth/webauthn/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!optionsRes.ok) {
        const d = await optionsRes.json().catch(() => ({}));
        throw new Error(d.error || "Could not prepare biometric registration.");
      }
      const options = await optionsRes.json();
      const regResponse = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: regResponse,
          deviceName: navigator.userAgent.includes("Android") ? "Android Phone" : "Browser",
        }),
      });
      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => ({}));
        throw new Error(d.error || "Could not complete biometric registration.");
      }
      setPasskeySuccess("Fingerprint / Passkey registered successfully.");
      await loadPasskeys();
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setPasskeyRegistering(false);
    }
  }

  async function deletePasskey(id: string) {
    setPasskeyError(null);
    setPasskeySuccess(null);
    try {
      const res = await fetch("/api/auth/webauthn/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Could not remove credential.");
      await loadPasskeys();
      setPasskeySuccess("Credential removed.");
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : "Failed to remove credential.");
    }
  }

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
      await authSignOut();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Unable to sign out.");
      setSigningOut(false);
    }
  }

  const inputClass = "w-full min-h-11 rounded-full border border-outline-variant/50 bg-white/70 px-4 text-body-md";
  const sorted = [...categories].sort((a, b) => Number(a.isIncome) - Number(b.isIncome) || a.name.localeCompare(b.name));

  return <div className="flex min-h-screen flex-col bg-transparent">
    <main className="app-bottom-clearance mx-auto flex min-h-screen w-full max-w-[480px] md:max-w-3xl flex-1 flex-col bg-transparent px-margin pb-space-xl pt-20">
      <div className="space-y-space-xs py-space-sm"><h1 className="text-headline-md font-medium tracking-tight">Settings</h1><p className="text-body-md text-on-surface-variant">Manage your spending allowance, bill reminders, and categories.</p></div>
      <section className="glass-panel mt-space-md space-y-space-sm p-space-md" aria-labelledby="runway-settings-heading">
        <div><h2 id="runway-settings-heading" className="text-body-lg font-medium">Daily spending allowance</h2><p className="text-body-sm text-on-surface-variant">Baseline discretionary spending for your runway calculation.</p></div>
        {burnLoading ? <p role="status" className="text-body-sm text-on-surface-variant">Loading daily allowance…</p> : burnLoadError ? <div><p role="alert" className="text-body-sm text-error">{burnLoadError}</p><button type="button" onClick={() => void loadDailyBurn()} className="min-h-11 text-secondary underline">Retry</button></div> : <form className="space-y-space-sm" onSubmit={saveDailyBurn}>
          <div className="space-y-space-xs"><label htmlFor="settings-daily-burn" className="text-label-md font-medium">Daily allowance (PHP)</label><input id="settings-daily-burn" className={inputClass} inputMode="decimal" value={dailyBurn} onChange={e => { setDailyBurn(e.target.value); setBurnSuccess(false); }} aria-describedby="settings-daily-burn-hint" /><p id="settings-daily-burn-hint" className="text-body-sm text-on-surface-variant">Enter an amount with up to two decimal places.</p></div>
          <button type="submit" disabled={burnSaving} className="min-h-11 rounded-full bg-primary px-space-md text-label-md font-medium text-white disabled:opacity-50">{burnSaving ? "Saving…" : "Save daily allowance"}</button>
          {burnError && <p role="alert" className="text-body-sm text-error">{burnError}</p>}
          {burnSuccess && <p role="status" className="text-body-sm text-secondary">Daily allowance saved.</p>}
        </form>}
      </section>
      <section className="glass-panel mt-space-md space-y-space-sm p-space-md" aria-labelledby="category-settings-heading">
        <div><h2 id="category-settings-heading" className="text-body-lg font-medium">Categories</h2><p className="text-body-sm text-on-surface-variant">Active categories are available in quick log. Archived categories remain on historical transactions.</p></div>
        <form onSubmit={createCategory} className="grid grid-cols-1 gap-space-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="sr-only" htmlFor="new-category-name">Category name</label><input id="new-category-name" className={inputClass} maxLength={100} value={newName} onChange={e => setNewName(e.target.value)} placeholder="New category name" />
          <label className="sr-only" htmlFor="new-category-kind">Category type</label><select id="new-category-kind" className={inputClass} value={newKind} onChange={e => setNewKind(e.target.value as "expense" | "income")}><option value="expense">Expense</option><option value="income">Income</option></select>
          <button type="submit" disabled={categorySaving} className="min-h-11 rounded-full bg-primary px-space-md text-label-md font-medium text-white disabled:opacity-50">{categorySaving ? "Adding…" : "Add"}</button>
        </form>
        {categoryError && <div><p role="alert" className="text-body-sm text-error">{categoryError}</p><button type="button" onClick={() => void loadCategories()} className="min-h-11 text-secondary underline">Retry</button></div>}
        {categoriesLoading ? <p role="status" className="text-body-sm text-on-surface-variant">Loading categories…</p> : !categoryError && categories.length === 0 ? <p className="text-body-sm text-on-surface-variant">No categories yet. Add one above.</p> : <div className="space-y-space-xs">
          {sorted.map(category => <div key={category.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-outline-variant/30 bg-white/50 p-space-sm">
            <div className="min-w-0 flex-1"><div className="break-words text-body-md font-medium">{editingId === category.id ? <input aria-label={`Rename ${category.name}`} className={inputClass} maxLength={100} value={editingName} onChange={e => setEditingName(e.target.value)} /> : category.name}</div><div className="text-body-sm text-on-surface-variant">{category.isIncome ? "Income" : "Expense"}{category.isArchived ? " · Archived" : ""}{category.isSystemFee ? " · System fee category" : ""}</div></div>
            <div className="flex items-center gap-1">
              {editingId === category.id ? <><button type="button" className="min-h-11 px-space-sm text-label-md text-secondary" onClick={() => void patchCategory(category, { name: editingName.trim() })}>Save</button><button type="button" className="min-h-11 px-space-sm text-label-md text-on-surface-variant" onClick={() => setEditingId(null)}>Cancel</button></> : <button type="button" className="min-h-11 px-space-sm text-label-md text-secondary" onClick={() => { setEditingId(category.id); setEditingName(category.name); }}>Rename</button>}
              {!category.isSystemFee && editingId !== category.id && <button type="button" className="min-h-11 px-space-sm text-label-md text-secondary" onClick={() => void patchCategory(category, { is_archived: !category.isArchived })}>{category.isArchived ? "Restore" : "Archive"}</button>}
            </div>
          </div>)}
        </div>}
      </section>
      <NotificationSettings />
      <section className="glass-panel mt-space-md space-y-space-sm p-space-md" aria-labelledby="biometrics-heading">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="biometrics-heading" className="text-body-lg font-medium">Fingerprint & Passkeys</h2>
            <p className="text-body-sm text-on-surface-variant">Use device biometrics to sign in quickly from your browser or PWA.</p>
          </div>
          <Fingerprint className="text-secondary" size={24} aria-hidden="true" />
        </div>

        {webAuthnSupported ? (
          <div className="space-y-space-sm">
            <button
              type="button"
              disabled={passkeyRegistering}
              onClick={() => void registerPasskey()}
              className="flex min-h-11 items-center gap-2 rounded-full bg-secondary px-space-md text-label-md font-medium text-on-secondary disabled:opacity-50"
            >
              <Fingerprint size={16} aria-hidden="true" />
              {passkeyRegistering ? "Registering…" : "Register this device / fingerprint"}
            </button>

            {passkeyError && <p role="alert" className="text-body-sm text-error">{passkeyError}</p>}
            {passkeySuccess && <p role="status" className="text-body-sm text-secondary">{passkeySuccess}</p>}

            <div className="space-y-space-xs pt-space-xs">
              <h3 className="text-label-md font-medium text-on-surface">Registered devices</h3>
              {passkeysLoading ? (
                <p role="status" className="text-body-sm text-on-surface-variant">Loading registered passkeys…</p>
              ) : passkeys.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">No devices or fingerprints registered yet.</p>
              ) : (
                <div className="space-y-space-xs">
                  {passkeys.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-white/50 p-space-sm"
                    >
                      <div>
                        <p className="text-body-md font-medium">{p.deviceName}</p>
                        <p className="text-body-xs text-on-surface-variant">
                          Added {new Date(p.createdAt).toLocaleDateString()}
                          {p.lastUsedAt ? ` · Last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deletePasskey(p.id)}
                        className="rounded-full p-2 text-on-surface-variant transition hover:bg-error/10 hover:text-error"
                        aria-label={`Remove ${p.deviceName}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            Biometric authentication is not supported by this browser or requires HTTPS.
          </p>
        )}
      </section>
      <section className="glass-panel mt-space-md space-y-space-sm p-space-md" aria-labelledby="account-security-heading">
        <div><h2 id="account-security-heading" className="text-body-lg font-medium">Account security</h2><p className="text-body-sm text-on-surface-variant">Change your owner password or end this session.</p></div>
        <form onSubmit={changePassword} className="space-y-space-sm">
          <div className="space-y-space-xs"><label htmlFor="settings-current-password" className="text-label-md font-medium">Current password</label><input id="settings-current-password" className={inputClass} type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></div>
          <div className="space-y-space-xs"><label htmlFor="settings-new-password" className="text-label-md font-medium">New password</label><input id="settings-new-password" className={inputClass} type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={newPassword} onChange={e => setNewPassword(e.target.value)} /><p className="text-body-sm text-on-surface-variant">Use at least 12 characters. Changing it signs out all sessions.</p></div>
          <div className="space-y-space-xs"><label htmlFor="settings-confirm-password" className="text-label-md font-medium">Confirm new password</label><input id="settings-confirm-password" className={inputClass} type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></div>
          <button type="submit" disabled={passwordSaving} className="min-h-11 rounded-full bg-primary px-space-md text-label-md font-medium text-white disabled:opacity-50">{passwordSaving ? "Changing password…" : "Change password"}</button>
          {passwordError && <p role="alert" className="text-body-sm text-error">{passwordError}</p>}
        </form>
        <div className="border-t border-outline-variant/40 pt-space-sm"><button type="button" disabled={signingOut} onClick={() => void signOut()} className="min-h-11 rounded-full border border-outline-variant px-space-md text-label-md font-medium text-on-surface disabled:opacity-50">{signingOut ? "Signing out…" : "Sign out"}</button>{accountError && <p role="alert" className="mt-2 text-body-sm text-error">{accountError}</p>}</div>
      </section>
    </main>
    <BottomNav showNavigation={false} />
  </div>;
}
