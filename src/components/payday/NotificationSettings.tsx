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
  return <section className="glass-panel mt-5 space-y-4 p-5" aria-labelledby="notification-settings-heading">
    <div>
      <h2 id="notification-settings-heading" className="text-body-lg font-semibold">Bill and payday notifications</h2>
      <p className="text-body-sm text-on-surface-variant">Runway sends bill due, past-due, and payday alerts through ntfy. Install the ntfy app and subscribe to the <span className="font-medium text-on-surface">runway-finance</span> topic on your tailnet.</p>
    </div>
  </section>;
}
