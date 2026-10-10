const CACHE_NAME = "runway-cache-v4";
const STATIC_ASSETS = ["/manifest.json", "/logo.svg", "/logo-192.png", "/logo-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Authenticated documents and API responses are always network-only. In
  // particular, never put a user's account data in a shared service-worker cache.
  if (event.request.mode === "navigate" || url.pathname.startsWith("/api/")) return;

  const safeStaticAsset = url.pathname === "/manifest.json" ||
    url.pathname === "/logo.svg" || url.pathname === "/logo-192.png" ||
    url.pathname === "/logo-512.png" || url.pathname.startsWith("/_next/static/");
  if (!safeStaticAsset) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networked = fetch(event.request).then(async (response) => {
        if (response.ok && response.type === "basic") {
          await cache.put(event.request, response.clone());
        }
        return response;
      }).catch(() => cached);
      return cached || networked;
    })
  );
});

function notificationTarget(value) {
  if (typeof value !== "string") return "/";
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || !(url.pathname === "/bills" || /^\/payday\/occurrences\/[a-zA-Z0-9-]+\/?$/.test(url.pathname))) return "/";
    return url.pathname;
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
  const title = typeof payload.title === "string" ? payload.title : "Runway";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "A Runway update is ready.",
    icon: "/logo-192.png",
    data: { url: notificationTarget(payload.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = notificationTarget(event.notification.data && event.notification.data.url);
  const url = new URL(target, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        await client.navigate(url);
        return await client.focus();
      } catch {
        // Opening a fresh app window below is the fallback for clients that cannot navigate.
      }
    }
    return self.clients.openWindow(url);
  }));
});
