/**
 * Admin-dashboard promotion surfacing.
 *
 * Adjustment rows carry a `source` column the generic "Discount"/"Fee" pill
 * hides: coupon (customer-applied code), sale (store-wide offer), cod
 * (payment-policy fee), manual (admin's own lever). These helpers expose
 * that distinction for badges, the orders-list chip, and the delete guard
 * that mirrors the backend's frozen-promotion 409.
 */

export type PromoBadgeKind = "coupon" | "sale" | "cod";

export interface PromoSourceBadge {
  text: string;
  kind: PromoBadgeKind;
}

/** Badge for the adjustment row; null = render nothing extra (manual/unknown). */
export function promoSourceBadge(
  source: string | null,
  sourceRef: string | null,
): PromoSourceBadge | null {
  switch (source) {
    case "coupon":
      return { text: sourceRef ? `COUPON · ${sourceRef}` : "COUPON", kind: "coupon" };
    case "sale":
      return { text: "SALE", kind: "sale" };
    case "cod":
      return { text: "COD", kind: "cod" };
    default:
      return null;
  }
}

/**
 * Coupon codes applied to an order, for the orders-list chip. Codes are
 * finalized at placement, so an empty list on an open order means the
 * customer hasn't applied (or hasn't settled) a coupon yet — sales never
 * appear here, they only live in the order's adjustment rows.
 */
export function orderPromoCodes(row: {
  applied_promo_codes?: unknown;
  applied_promo_code?: unknown;
}): string[] {
  const codes: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v && !codes.includes(v)) codes.push(v);
  };
  const many = row.applied_promo_codes;
  if (Array.isArray(many)) many.forEach(push);
  else push(many); // scalar leaked into the JSONB column on older rows
  push(row.applied_promo_code); // legacy single-code column
  return codes;
}

/** Open states — the promotion engine still re-syncs these orders. */
const OPEN_STATUSES = new Set(["draft", "pending"]);

/**
 * Whether the trash button should work on an adjustment row. Sale rows are
 * never deletable: they're a projection of the live sale feed — an open
 * order re-stamps them on the next sync, a placed order is frozen history.
 * Coupon rows are deletable while the order is open, then frozen at
 * placement (the engine finalized the discount and never re-syncs closed
 * orders). Manual rows stay deletable everywhere.
 */
export function canDeleteAdjustment(
  adj: { source: string | null },
  orderFulfillmentStatus: string | null | undefined,
): boolean {
  if (adj.source === "sale") return false;
  if (adj.source !== "coupon") return true;
  return orderFulfillmentStatus != null && OPEN_STATUSES.has(orderFulfillmentStatus);
}

/**
 * Whether the admin order page should fire the one-shot promo resync after
 * first paint — the same healing pass the customer app runs. Open orders
 * only: a promotion created after the order's last engine sync (checkout,
 * payment, coupon touch) lands here without any customer action. Placed
 * orders are frozen history and are never re-priced. Unknown status fails
 * closed (no resync).
 */
export function shouldAdminResync(
  orderFulfillmentStatus: string | null | undefined,
): boolean {
  return orderFulfillmentStatus != null && OPEN_STATUSES.has(orderFulfillmentStatus);
}

/**
 * Whether the Grand-total section shows the coupon input. Same open-orders
 * rule as the resync (coupons are placed-order history once confirmed for
 * payment), plus the global kill switch — with promotions off the engine
 * holds nothing, so the input would only ever answer "not applied".
 */
export function canApplyCoupon(
  orderFulfillmentStatus: string | null | undefined,
  promotionsEnabled: boolean,
): boolean {
  return (
    promotionsEnabled &&
    orderFulfillmentStatus != null &&
    OPEN_STATUSES.has(orderFulfillmentStatus)
  );
}

/** One dropped decision from the apply endpoint (see _dropped_out on the BE). */
export interface CouponDrop {
  reason: string;
  code?: string | null;
  gap_amount?: number | null;
}

/** Human line under the coupon input for a code that didn't stick. */
export function couponDropText(d: CouponDrop): string {
  if (d.reason === "invalid_code") return "That code doesn't exist or isn't active.";
  if (d.gap_amount != null && d.gap_amount > 0)
    return `Add ₹${d.gap_amount} more to unlock this coupon.`;
  if (d.reason === "superseded") return "Another discount won this order's total.";
  return `Coupon not applied (${d.reason.replace(/_/g, " ")}).`;
}
