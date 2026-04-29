// Business logic constants — single source of truth for all hardcoded thresholds.

// Booking dispatch guards
export const LEAD_TIME_MINUTES = 15;
export const CONFLICT_WINDOW_MINUTES = 20;

// Driver location trail
export const DRIVER_LOCATION_TRAIL_MAX = 50;
export const DRIVER_LOCATION_TRAIL_RESPONSE_MAX = 10;

// Scheduled messaging
export const MESSAGE_SCHEDULER_INTERVAL_MS = 30_000;

// HOS retention
export const HOS_RETENTION_MONTHS = 12;

// Auto-dispatch
export const AUTO_DISPATCH_MAX_CANDIDATES = 20;
export const AUTO_DISPATCH_MAX_DISTANCE_METERS = Math.round(6 * 1609.34); // 6 miles default
