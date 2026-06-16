// Registers the service worker so the app is installable and works offline.
// Also auto-reloads once when a new service worker takes over, so code updates
// take effect on the next visit instead of being stuck behind a stale cache.
// A no-op on browsers without service workers or on insecure origins.
if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Skip the initial claim on a first (uncontrolled) visit; only reload on an
    // actual update.
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[pwa] Service worker registration failed:", err));
  });
}
