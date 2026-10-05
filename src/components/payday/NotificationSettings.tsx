"use client";

import { useEffect, useState } from "react";

type PushState = "checking" | "unsupported" | "disabled" | "enabled";

function supportsPush() {
  return typeof window !== "undefined" && "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;
}

function isAppleMobile() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function decodeApplicationServerKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager.getSubscription() ?? null;
}

/** Remove cached documents and API responses left by older service workers. */
export async function clearPrivatePageCaches() {
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
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!supportsPush()) {
      setState("unsupported");
      return () => { active = false; };
    }
    void currentSubscription().then((subscription) => {
      if (active) setState(subscription ? "enabled" : "disabled");
    }).catch(() => {
      if (active) setState("disabled");
    });
    return () => { active = false; };
  }, []);

  async function enableNotifications() {
    setBusy(true); setError(null); setMessage(null);
    try {
      if (!supportsPush()) throw new Error("This browser does not support push notifications.");
      // This handler runs only after the user presses the enable button.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(permission === "denied"
        ? "Notifications are blocked in this browser's settings."
        : "Allow notifications to enable payday alerts.");

      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const keyResponse = await fetch("/api/payday/push-subscriptions", { cache: "no-store" });
      const keyData = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok || typeof keyData.publicKey !== "string" || !keyData.publicKey) {
        throw new Error(keyData.error || "Push notifications are not configured on this server.");
      }

      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription = existingSubscription ??
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(keyData.publicKey),
        });
      const response = await fetch("/api/payday/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (!existingSubscription) await subscription.unsubscribe().catch(() => false);
        throw new Error(data.error || "Unable to save this device's notification subscription.");
      }
      setState("enabled");
      setMessage("Payday notifications are enabled on this device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to enable notifications.");
    } finally { setBusy(false); }
  }

  async function disableNotifications() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const response = await fetch("/api/payday/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to remove this device's subscription.");
        await subscription.unsubscribe();
      }
      setState("disabled");
      setMessage("Payday notifications are disabled on this device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to disable notifications.");
    } finally { setBusy(false); }
  }

  return <section className="glass-panel mt-5 space-y-4 p-5" aria-labelledby="notification-settings-heading">
    <div>
      <h2 id="notification-settings-heading" className="text-body-lg font-semibold">Payday notifications</h2>
      <p className="text-body-sm text-on-surface-variant">Get a browser push notification when a scheduled paycheck is added to its linked account.</p>
    </div>
    {state === "checking" ? <p role="status" className="text-body-sm text-on-surface-variant">Checking this device…</p> : null}
    {state === "unsupported" ? <p className="text-body-sm text-on-surface-variant">This browser does not support push notifications.</p> : null}
    {state === "disabled" ? <button type="button" disabled={busy} onClick={() => void enableNotifications()} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-white disabled:opacity-50">{busy ? "Enabling…" : "Enable payday notifications"}</button> : null}
    {state === "enabled" ? <div className="space-y-3"><p className="text-body-sm text-secondary">Notifications are enabled for this device.</p><button type="button" disabled={busy} onClick={() => void disableNotifications()} className="min-h-11 rounded-full border border-outline-variant px-5 font-semibold text-on-surface disabled:opacity-50">{busy ? "Disabling…" : "Disable notifications"}</button></div> : null}
    {isAppleMobile() ? <p className="text-body-sm text-on-surface-variant">On iPhone and iPad, add Runway to the Home Screen and open it there before enabling notifications.</p> : null}
    {error ? <p role="alert" className="text-body-sm text-error">{error}</p> : null}
    {message ? <p role="status" className="text-body-sm text-secondary">{message}</p> : null}
  </section>;
}
