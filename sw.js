// Service worker — makes the app installable and resilient offline.
// Strategy: never cache the live API; cache-first for static assets;
// network-first for navigations (so updates show), falling back to cache.
const CACHE = "bsmeb-v3";
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
      // Tolerate individual misses (some paths differ per deployment role).
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
  if (url.pathname.startsWith("/api/")) return; // always hit the network for live data

  // Static assets: cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Navigations / everything else: network-first, fall back to cache.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("/display")))
  );
});
