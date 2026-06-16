// Registers the service worker so the app is installable and works offline.
// Imported by every page; a no-op on browsers without service-worker support
// or on insecure origins (e.g. plain http:// during local file testing).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[pwa] Service worker registration failed:", err));
  });
}
