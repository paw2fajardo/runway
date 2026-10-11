"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BILL_NOTIFICATION_ALERTS, BillNotificationSchedulesSettingsSchema, MAX_BILL_NOTIFICATION_SCHEDULES,
  type BillNotificationSchedule } from "@/lib/types";

/** Remove cached documents and API responses left by older service workers. */
export async function clearPrivatePageCaches() {
  if (typeof window === "undefined") return;
  if (!("caches" in window)) return;
  const staticPath = (pathname: string) => pathname === "/manifest.json" ||
    pathname === "/logo.svg" || pathname === "/logo-192.png" ||
    pathname === "/logo-512.png" || pathname.startsWith("/_next/static/");
  const names = await caches.keys();
  await Promise.all(names.map(async (name) => {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    await Promise.all(requests.map((request) => {
      const url = new URL(request.url);
      if (url.origin !== window.location.origin || request.mode === "navigate" ||
        url.pathname.startsWith("/api/") || !staticPath(url.pathname)) {
        return cache.delete(request);
      }
    }));
  }));
}

export function NotificationSettings() {
  const [schedules, setSchedules] = useState<BillNotificationSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const labels: Record<BillNotificationSchedule["alerts"][number], string> = {
    past_due: "Past-due bills", due_today: "Bills due today", due_tomorrow: "Bills due tomorrow",
    until_payday: "Bills due through payday",
  };
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const response = await fetch("/api/runway/settings?field=bill_notification_schedules");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load notification schedules.");
      setSchedules(BillNotificationSchedulesSettingsSchema.parse(data).bill_notification_schedules);
    } catch {
      setLoadError("Unable to load notification schedules. Retry to keep your saved times.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function change(next: BillNotificationSchedule[]) {
    setSchedules(next); setSaved(false); setError(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setSaved(false);
    const parsed = BillNotificationSchedulesSettingsSchema.safeParse({ bill_notification_schedules: schedules });
    if (!parsed.success) {
      setError("Choose a different time for each schedule and at least one alert per time."); return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/runway/settings", { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save notification schedules.");
      setSchedules(BillNotificationSchedulesSettingsSchema.parse(data).bill_notification_schedules); setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save notification schedules.");
    } finally { setSaving(false); }
  }

  return <section className="glass-panel mt-space-lg space-y-space-lg p-space-lg" aria-labelledby="notification-settings-heading">
    <div>
      <h2 id="notification-settings-heading" className="text-body-lg font-semibold">Bill and payday notifications</h2>
      <p className="text-body-sm text-on-surface-variant">Runway sends bill due, past-due, and payday alerts through ntfy. Install the ntfy app and subscribe to the <span className="font-medium text-on-surface">runway-finance</span> topic on your tailnet.</p>
    </div>
    <p id="notification-schedules-hint" className="text-body-sm text-on-surface-variant">Choose daily times in Manila time (UTC+8). Each time sends one message with your selected bill alerts. Paycheck alerts arrive when a paycheck is deposited.</p>
    {loading ? <p role="status" className="text-body-sm text-on-surface-variant">Loading notification schedules…</p>
      : loadError ? <div><p role="alert" className="text-body-sm text-error">{loadError}</p>
        <button type="button" onClick={() => void load()} className="min-h-11 text-secondary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Retry</button></div>
        : <form onSubmit={save} className="space-y-space-lg" aria-describedby="notification-schedules-hint">
          {schedules.length === 0 && <p className="text-body-sm text-on-surface-variant">No bill reminders scheduled. Add a time to enable them, or save to keep them off.</p>}
          {schedules.map((schedule, index) => <fieldset key={index} disabled={saving} className="space-y-space-sm border-t border-outline-variant pt-space-lg">
            <legend className="sr-only">Notification schedule {index + 1}</legend>
            <div className="flex flex-wrap items-end gap-space-md">
              <div className="min-w-0 flex-1 space-y-space-sm">
                <label htmlFor={`notification-time-${index}`} className="block text-body-md font-semibold">Send at (Manila time)</label>
                <input id={`notification-time-${index}`} type="time" step="60" required value={schedule.time}
                  onChange={event => change(schedules.map((row, i) => i === index ? { ...row, time: event.target.value } : row))}
                  className="min-h-11 w-full rounded-full border border-outline-variant bg-surface-container-lowest px-space-lg text-body-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
              </div>
              <button type="button" aria-label={`Remove schedule ${index + 1}`} onClick={() => change(schedules.filter((_, i) => i !== index))}
                className="min-h-11 px-space-sm text-body-md font-semibold text-error underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Remove</button>
            </div>
            <div className="grid gap-x-space-lg sm:grid-cols-2">
              {BILL_NOTIFICATION_ALERTS.map(alert => <label key={alert} className="flex min-h-11 items-center gap-space-sm text-body-md text-on-surface">
                <input type="checkbox" checked={schedule.alerts.includes(alert)}
                  onChange={event => change(schedules.map((row, i) => i === index ? { ...row,
                    alerts: event.target.checked ? [...row.alerts, alert] : row.alerts.filter(value => value !== alert) } : row))}
                  className="h-5 w-5 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
                {labels[alert]}
              </label>)}
            </div>
          </fieldset>)}
          <div className="flex flex-wrap gap-space-md">
            <button type="button" disabled={saving || schedules.length >= MAX_BILL_NOTIFICATION_SCHEDULES}
              onClick={() => change([...schedules, { time: "", alerts: [...BILL_NOTIFICATION_ALERTS] }])}
              className="min-h-11 rounded-full border border-outline px-space-lg text-body-md font-semibold text-on-surface disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Add time</button>
            <button type="submit" disabled={saving}
              className="min-h-11 rounded-full bg-primary px-space-lg text-body-md font-semibold text-on-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{saving ? "Saving…" : "Save notification schedules"}</button>
          </div>
          {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
          {saved && <p role="status" className="text-body-sm text-secondary">Notification schedules saved.</p>}
        </form>}
  </section>;
}
