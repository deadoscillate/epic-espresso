// -----------------------------------------------------------------------------
// Status catalogue
// -----------------------------------------------------------------------------
// Single source of truth for every coffee status: label, emoji (used on the
// admin buttons / as a fallback), the "Epic Brew" card image shown big on the
// display, the default "service-desk" tagline, and the theme key the CSS reads
// via `data-status`. Add a status here and it appears across all pages.
//
// Keep the id list in sync with the STATUSES array in api/status.js.
// -----------------------------------------------------------------------------

export const DEFAULT_STATUS_ID = "closed";

export const STATUS_ORDER = [
  "brewing",
  "ready",
  "empty",
  "cleaning",
  "closed",
  "beans_low",
  "maintenance",
];

const img = (id) => `/assets/img/status/${id}.webp`;

export const STATUSES = {
  brewing: {
    id: "brewing",
    label: "Brewing",
    icon: "☕",
    image: img("brewing"),
    tagline: "Brewing in progress. Please hold for caffeine.",
  },
  ready: {
    id: "ready",
    label: "Ready",
    icon: "✅",
    image: img("ready"),
    tagline: "Coffee is operational. Morale restoration available.",
  },
  empty: {
    id: "empty",
    label: "Empty",
    icon: "🫗",
    image: img("empty"),
    tagline: "Pot empty. Productivity degradation in progress.",
  },
  cleaning: {
    id: "cleaning",
    label: "Cleaning",
    icon: "🧼",
    image: img("cleaning"),
    tagline: "Scheduled cleaning underway. Service resumes shortly.",
  },
  closed: {
    id: "closed",
    label: "Closed",
    icon: "🌙",
    image: img("closed"),
    tagline: "Espresso bar closed. Service resumes next business day.",
  },
  beans_low: {
    id: "beans_low",
    label: "Beans Low",
    icon: "⚠️",
    image: img("beans_low"),
    tagline: "Beans low. Productivity degradation imminent.",
  },
  maintenance: {
    id: "maintenance",
    label: "Maintenance",
    icon: "🛠️",
    image: img("maintenance"),
    tagline: "Espresso system under maintenance. Please submit a ticket through Incident IQ.",
  },
};

// Always returns a valid status object, falling back to the default.
export function getStatus(id) {
  return STATUSES[id] || STATUSES[DEFAULT_STATUS_ID];
}
