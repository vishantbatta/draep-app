/**
 * Pricing values — placeholders per spec §13.
 *
 * TODO(pricing): replace with the real rate card before launch.
 * Frontend is structurally unblocked; only this file changes.
 */

export const BASE_STITCHING = 600;

export const OPTION_PRICING: Record<string, number> = {
  // Sleeve priced add-ons (spec §6.6)
  sleeve_regular_short: 0, // included
  sleeve_elbow: 60,
  sleeve_three_quarter: 120,
  sleeve_full: 180,
};

export const ADDONS_PRICING: Record<string, number> = {
  piping: 80,
  lining: 120,
  button_decor: 60,
  boning: 100,
  border: 120,
  latkan: 90, // per placement
  breast_cups: 80,
  moti_work: 200, // TBD — confirm
  net_work: 150, // per placement
  keyhole: 60,
  tassels: 70, // per placement
};

/**
 * Three-hour home-visit slot windows — spec §6.12.
 * TODO(ops): confirm final windows + how many days ahead ops can serve.
 */
export const VISIT_SLOT_WINDOWS = [
  { id: "09:00-12:00", label: "9 AM – 12 PM" },
  { id: "12:00-15:00", label: "12 PM – 3 PM" },
  { id: "15:00-18:00", label: "3 PM – 6 PM" },
  { id: "18:00-21:00", label: "6 PM – 9 PM" },
];

export const VISIT_SLOT_DAYS_AHEAD = 7;
