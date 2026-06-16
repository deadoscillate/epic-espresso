// -----------------------------------------------------------------------------
// "Install app" affordance
// -----------------------------------------------------------------------------
// Browsers don't render an in-page install button by default, and iOS never
// prompts at all. This wires up our own button:
//   • Chromium (Android/desktop): trigger the captured beforeinstallprompt.
//   • iOS Safari: show "Share → Add to Home Screen" instructions.
//   • Other / not-yet-eligible: show a generic "use your browser menu" hint.
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
  let deferred = null;

  const showHint = (text) => {
    if (hint) {
      hint.textContent = text;
      hint.hidden = false;
    } else {
      alert(text);
    }
  };

  btn.hidden = false; // always offer it (unless already installed)

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e; // stash so we can trigger it on click
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    btn.hidden = true;
    if (hint) hint.hidden = true;
  });

  btn.addEventListener("click", async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
    } else if (isIOS) {
      showHint("To install: tap the Share icon, then “Add to Home Screen.”");
    } else {
      showHint("Open your browser menu and choose “Install app” / “Add to Home screen.”");
    }
  });
}
