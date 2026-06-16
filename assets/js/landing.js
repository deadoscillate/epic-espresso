// -----------------------------------------------------------------------------
// Landing page — shows a small live "Now:" chip so the homepage feels alive.
// -----------------------------------------------------------------------------
import "./pwa.js";
import { setupInstallButton } from "./install.js";
import { createCoffeeStore } from "./store.js";
import { getStatus } from "./statuses.js";

const store = createCoffeeStore();
const chip = document.getElementById("live-chip");
const icon = document.getElementById("live-icon");
const label = document.getElementById("live-label");

store.onChange((state) => {
  const status = getStatus(state.status);
  document.body.dataset.status = status.id;
  icon.textContent = status.icon;
  label.textContent = status.label;
  chip.hidden = false;
});

setupInstallButton(
  document.getElementById("install-btn"),
  document.getElementById("install-hint")
);
store.init();
