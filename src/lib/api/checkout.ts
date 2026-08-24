/**
 * Checkout API — Cashfree payment init, verify, status poll.
 * Mirrors be/app/api/checkout.py
 */

import { apiGet, apiPost } from "./client";
import type {
  CheckoutIn,
  CheckoutOut,
  CheckoutVerifyIn,
  CheckoutVerifyOut,
  OrderStatusOut,
  PayInitOut,
  PayMethodOut,
} from "@/types/api";

// POST /orders/{order_id}/checkout
export function checkout(
  orderId: string,
  body: CheckoutIn,
  idempotencyKey: string,
): Promise<CheckoutOut> {
  return apiPost<CheckoutOut>(
    `/orders/${orderId}/checkout`,
    body,
    {
      headers: { "Idempotency-Key": idempotencyKey },
    },
  );
}

// POST /orders/{order_id}/checkout/verify
export function verifyCheckout(
  orderId: string,
  body: CheckoutVerifyIn,
): Promise<CheckoutVerifyOut> {
  return apiPost<CheckoutVerifyOut>(
    `/orders/${orderId}/checkout/verify`,
    body,
  );
}

// GET /orders/{order_id}/status
export function getOrderStatus(orderId: string): Promise<OrderStatusOut> {
  return apiGet<OrderStatusOut>(`/orders/${orderId}/status`);
}

// POST /orders/{order_id}/pay — Cashfree session for the order-page balance
export function startOrderPayment(orderId: string): Promise<PayInitOut> {
  return apiPost<PayInitOut>(`/orders/${orderId}/pay`, {});
}

// POST /orders/{order_id}/pay-method — choose Cash on Delivery from the
// order-page Pay sheet (confirms a draft booking + adds the COD fee)
export function chooseCodPayment(orderId: string): Promise<PayMethodOut> {
  return apiPost<PayMethodOut>(`/orders/${orderId}/pay-method`, {
    method: "cod",
  });
}

// GET /orders/{order_id}/payment/status — poll that syncs with Cashfree
export function getVerifiedPaymentStatus(
  orderId: string,
): Promise<OrderStatusOut> {
  return apiGet<OrderStatusOut>(`/orders/${orderId}/payment/status`);
}
