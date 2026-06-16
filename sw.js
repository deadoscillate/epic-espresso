// Service worker — installable + offline-capable.
// Network-first for everything (so updates always show when online); the cache
// is only a fallback for offline. The live API is never intercepted.
const CACHE = "bsmeb-v6";
const SHELL = [
  "/",
  "/display",
  "/manifest.webmanifest",
  "/assets/css/base.css",
  "/assets/css/landing.css",
  "/assets/css/admin.css",
  "/assets/css/display.css",
  "/assets/js/config.js",
  "/assets/js/statuses.js",
  "/assets/js/util.js",
  "/assets/js/store.js",
  "/assets/js/pwa.js",
  "/assets/js/install.js",
  "/assets/js/landing.js",
  "/assets/js/display.js",
  "/assets/js/admin.js",
  "/assets/img/epic-icon.svg",
  "/assets/img/icon-192.png",
  "/assets/img/status/brewing.webp",
  "/assets/img/status/ready.webp",
  "/assets/img/status/empty.webp",
  "/assets/img/status/cleaning.webp",
  "/assets/img/status/closed.webp",
  "/assets/img/status/beans_low.webp",
  "/assets/img/status/maintenance.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept writes
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live data: always the network

  // Network-first: fresh when online, cache as a fallback when offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("/display")))
  );
});
