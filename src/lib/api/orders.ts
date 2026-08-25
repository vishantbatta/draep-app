/**
 * Orders API — draft lifecycle, selections, add-ons, validation.
 * Mirrors be/app/api/orders.py
 */

import { apiDelete, apiGet, apiPost, apiPut, apiPatch } from "./client";
import type {
  CustomerOrderDetail,
  OrderListOut,
  OrderOut,
  ValidateOut,
} from "@/types/api";

// GET /orders — signed-in customer's own orders, newest first
export function listOrders(
  page = 1,
  perPage = 20,
  signal?: AbortSignal,
): Promise<OrderListOut> {
  return apiGet<OrderListOut>("/orders", {
    query: { page, per_page: perPage },
    signal,
  });
}

// GET /orders/{order_id}/detail — full customer breakdown (/app order page)
export function getOrderDetail(
  orderId: string,
  signal?: AbortSignal,
): Promise<CustomerOrderDetail> {
  return apiGet<CustomerOrderDetail>(`/orders/${orderId}/detail`, { signal });
}

// POST /orders
export function createOrder(garmentId: string): Promise<OrderOut> {
  return apiPost<OrderOut>("/orders", { garment_id: garmentId });
}

// GET /orders/{order_id}
export function getOrder(orderId: string): Promise<OrderOut> {
  return apiGet<OrderOut>(`/orders/${orderId}`);
}

// DELETE /orders/{order_id}
export function deleteOrder(orderId: string): Promise<void> {
  return apiDelete<void>(`/orders/${orderId}`);
}

// POST /orders/{order_id}/validate
export function validateOrder(orderId: string): Promise<ValidateOut> {
  return apiPost<ValidateOut>(`/orders/${orderId}/validate`);
}

// PUT /orders/{order_id}/selections/{component_id}?garment_order_id=…
// garmentOrderId targets a specific garment card (the /app order page edit
// flow); omitted = the order's first garment order (review-screen behaviour).
export function updateSelection(
  orderId: string,
  componentId: string,
  variationId: string,
  variationTypeId?: string | null,
  garmentOrderId?: string,
): Promise<OrderOut> {
  return apiPut<OrderOut>(
    `/orders/${orderId}/selections/${componentId}`,
    {
      variation_id: variationId,
      variation_type_id: variationTypeId ?? null,
    },
    { query: { garment_order_id: garmentOrderId } },
  );
}

// DELETE /orders/{order_id}/selections/{component_id}
export function resetSelection(
  orderId: string,
  componentId: string,
  garmentOrderId?: string,
): Promise<OrderOut> {
  return apiDelete<OrderOut>(`/orders/${orderId}/selections/${componentId}`, {
    query: { garment_order_id: garmentOrderId },
  });
}

// PUT /orders/{order_id}/add-ons/{add_on_id}
export function upsertAddon(
  orderId: string,
  addOnId: string,
  addOnVariationId?: string | null,
  placement?: string | null,
  garmentOrderId?: string,
): Promise<OrderOut> {
  return apiPut<OrderOut>(
    `/orders/${orderId}/add-ons/${addOnId}`,
    {
      add_on_variation_id: addOnVariationId ?? null,
      placement: placement ?? null,
    },
    { query: { garment_order_id: garmentOrderId } },
  );
}

// PATCH /orders/{order_id}/add-ons/{add_on_id}
export function patchAddon(
  orderId: string,
  addOnId: string,
  addOnVariationId?: string | null,
  placement?: string | null,
  garmentOrderId?: string,
): Promise<OrderOut> {
  return apiPatch<OrderOut>(
    `/orders/${orderId}/add-ons/${addOnId}`,
    {
      add_on_variation_id: addOnVariationId ?? null,
      placement: placement ?? null,
    },
    { query: { garment_order_id: garmentOrderId } },
  );
}

// DELETE /orders/{order_id}/add-ons/{add_on_id}?placement=…
export function removeAddon(
  orderId: string,
  addOnId: string,
  placement?: string | null,
  garmentOrderId?: string,
): Promise<OrderOut> {
  return apiDelete<OrderOut>(`/orders/${orderId}/add-ons/${addOnId}`, {
    query: { placement: placement ?? undefined, garment_order_id: garmentOrderId },
  });
}

// PUT /orders/{order_id}/garments/{garment_order_id}/note — set or clear the
// customer's note on one garment order (the note editor on the /app order
// page; editable at every order state). Empty/whitespace clears the note.
export function updateOrderNote(
  orderId: string,
  garmentOrderId: string,
  note: string | null,
): Promise<OrderOut> {
  return apiPut<OrderOut>(
    `/orders/${orderId}/garments/${garmentOrderId}/note`,
    { note: note ?? null },
  );
}

// PUT /orders/{order_id}/address — attach an existing saved address to the
// draft order (same address_id set the admin dashboard performs; no new
// address row is created).
export function attachOrderAddress(
  orderId: string,
  addressId: string,
): Promise<OrderOut> {
  return apiPut<OrderOut>(`/orders/${orderId}/address`, {
    address_id: addressId,
  });
}
