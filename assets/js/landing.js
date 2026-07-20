// -----------------------------------------------------------------------------
// Landing page — small live "Now:" chip + Joe's status + install button.
// -----------------------------------------------------------------------------
import "./pwa.js";
import { setupInstallButton } from "./install.js";
import { createCoffeeStore } from "./store.js";
import { getStatus, getManager } from "./statuses.js";
import { renderConnection } from "./util.js";

const store = createCoffeeStore();
const chip = document.getElementById("live-chip");
const icon = document.getElementById("live-icon");
const label = document.getElementById("live-label");
const joeChip = document.getElementById("joe-chip");

store.onChange((state) => {
  const status = getStatus(state.status);
  document.body.dataset.status = status.id;
  icon.textContent = status.icon;
  label.textContent = status.label;
  chip.hidden = false;

  const manager = state.manager || { state: "available", note: "" };
  if (manager.state && manager.state !== "available") {
    const mInfo = getManager(manager.state);
    joeChip.textContent = `👤 Joe — ${mInfo.label}` + (manager.note ? ` · ${manager.note}` : "");
    joeChip.hidden = false;
  } else {
    joeChip.hidden = true;
  }
});

setupInstallButton(
  document.getElementById("install-btn"),
  document.getElementById("install-hint")
);
store.onConnection((conn) => renderConnection(document.getElementById("connection"), conn));
store.init();
