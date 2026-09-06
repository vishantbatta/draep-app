/**
 * Promotions API — the customer-facing half.
 * Mirrors be/app/api/promotions.py (user promo apply + public active-sales).
 */

import { apiDelete, apiGet, apiPost } from "./client";
import type { ActiveSalesOut, CustomerOrderDetail, PromoApplyOut } from "@/types/api";

// POST /orders/{order_id}/promo — ADD a coupon code to the open order
// (several can be held; stackability decides which discount), or clear
// every held code with code: null. Always 200: an ineligible code is a
// *result* (dropped + reason), so the UI can nudge instead of erroring.
export function applyOrderPromo(
  orderId: string,
  code: string | null,
): Promise<PromoApplyOut> {
  return apiPost<PromoApplyOut>(`/orders/${orderId}/promo`, { code });
}

// DELETE /orders/{order_id}/promo?code=X — remove ONE held code (the
// chip's ×). Same always-200 contract and response as the POST.
export function removeOrderPromo(
  orderId: string,
  code: string,
): Promise<PromoApplyOut> {
  return apiDelete<PromoApplyOut>(`/orders/${orderId}/promo?code=${encodeURIComponent(code)}`);
}

// POST /orders/{order_id}/promo/revalidate — re-check every held coupon
// against current conditions; answers with the refreshed customer detail
// (same shape as getOrderDetail). The order page fires this in the
// background right after its first paint so a coupon that expired / was
// paused / lost its combo since the last write stops showing as applied —
// the paint itself never waits on the promo engine.
export function revalidateOrderPromos(
  orderId: string,
): Promise<CustomerOrderDetail> {
  return apiPost<CustomerOrderDetail>(`/orders/${orderId}/promo/revalidate`, {});
}

// GET /promotions/active-sales — public banner feed (sales only, never codes).
export function listActiveSales(signal?: AbortSignal): Promise<ActiveSalesOut> {
  return apiGet<ActiveSalesOut>("/promotions/active-sales", { signal });
}
