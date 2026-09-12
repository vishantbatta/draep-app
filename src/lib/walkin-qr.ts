/**
 * Walk-in v2 payment URL — WALKIN_V2_PLAN.md §5.5.
 *
 * The QR on the review/wait screens encodes the direct app order URL plus the
 * walk-in gate params. `wi=1` tells /app/orders/[id] this is a walk-in pickup
 * (Phase 5 gate); `ph` pre-fills the customer's phone so the login step knows
 * whose session to open.
 */

export function walkInPayUrl(origin: string, orderId: string, phone: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/app/orders/${encodeURIComponent(orderId)}?wi=1&ph=${encodeURIComponent(phone)}`;
}
