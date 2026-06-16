// -----------------------------------------------------------------------------
// "Install app" affordance
// -----------------------------------------------------------------------------
// Browsers don't render an in-page install button by default, and iOS never
// prompts. We capture Chromium's `beforeinstallprompt` event as early as
// possible (an inline <head> script stashes it on window.__deferredInstall so
// it's never missed) and trigger it from our button:
//   • Chromium (Android/desktop): fire the captured prompt.
//   • iOS Safari: show "Share → Add to Home Screen" instructions.
//   • Not eligible yet / other: point to the browser menu.
//   • Already installed (standalone): hide the button.
// -----------------------------------------------------------------------------
export function setupInstallButton(btn, hint) {
  if (!btn) return;

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (standalone) {
    btn.hidden = true;
    if (hint) hint.hidden = true;
    return;
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferred = window.__deferredInstall || null;

  const showHint = (text) => {
    if (hint) {
      hint.textContent = text;
      hint.hidden = false;
    } else {
      alert(text);
    }
  };

  btn.hidden = false; // always offer it (unless already installed)

  // In case the event fires after this runs.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    window.__deferredInstall = e;
    btn.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    window.__deferredInstall = null;
    btn.hidden = true;
    if (hint) hint.hidden = true;
  });

  btn.addEventListener("click", async () => {
    const evt = deferred || window.__deferredInstall;
    if (evt) {
      evt.prompt();
      await evt.userChoice.catch(() => {});
      deferred = null;
      window.__deferredInstall = null;
    } else if (isIOS) {
      showHint("To install: tap the Share icon, then “Add to Home Screen.”");
    } else {
      showHint(
        "If nothing pops up, open your browser’s ⋮ menu and choose “Install app” / “Add to Home screen.”"
      );
    }
  });
}
