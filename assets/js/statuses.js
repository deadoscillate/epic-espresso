// -----------------------------------------------------------------------------
// Status catalogue
// -----------------------------------------------------------------------------
// Single source of truth for every coffee status: its label, icon, default
// "service-desk" tagline, and the theme key used by the CSS (`data-status`).
// Add a new status here and it shows up on both the admin grid and the display.
// -----------------------------------------------------------------------------

export const DEFAULT_STATUS_ID = "closed";

// Controls the order of buttons on the admin page.
export const STATUS_ORDER = [
  "brewing",
  "ready",
  "empty",
  "cleaning",
  "closed",
  "beans_low",
  "maintenance",
];

export const STATUSES = {
  brewing: {
    id: "brewing",
    label: "Brewing",
    icon: "☕",
    tagline: "Brewing in progress. Please hold for caffeine.",
  },
  ready: {
    id: "ready",
    label: "Ready",
    icon: "✅",
    tagline: "Coffee is operational. Morale restoration available.",
  },
  empty: {
    id: "empty",
    label: "Empty",
    icon: "🫗",
    tagline: "Pot empty. Productivity degradation in progress.",
  },
  cleaning: {
    id: "cleaning",
    label: "Cleaning",
    icon: "🧼",
    tagline: "Scheduled cleaning underway. Service resumes shortly.",
  },
  closed: {
    id: "closed",
    label: "Closed",
    icon: "🌙",
    tagline: "Espresso bar closed. Service resumes next business day.",
  },
  beans_low: {
    id: "beans_low",
    label: "Beans Low",
    icon: "⚠️",
    tagline: "Beans low. Productivity degradation imminent.",
  },
  maintenance: {
    id: "maintenance",
    label: "Maintenance",
    icon: "🛠️",
    tagline: "Espresso system under maintenance. Please submit a ticket through Incident IQ.",
  },
};

// Always returns a valid status object, falling back to the default.
export function getStatus(id) {
  return STATUSES[id] || STATUSES[DEFAULT_STATUS_ID];
}
