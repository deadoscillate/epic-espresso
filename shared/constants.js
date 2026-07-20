// Values shared by the browser and server. Keep business limits here so a menu
// item accepted by Inventory cannot later be rejected by Ordering.
export const CUSTOMER_NAME_MAX = 40;
export const ITEM_NAME_MAX = 60;

// Public ordering is available only while the bar is in one of these states.
// Admins can still add a walk-up order while handling an exceptional situation.
export const ORDERABLE_STATUSES = ["brewing", "ready", "beans_low"];

export const MAX_ACTIVE_ORDERS = 50;
