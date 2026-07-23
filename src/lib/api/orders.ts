/**
 * Orders API — draft lifecycle, selections, add-ons, validation.
 * Mirrors be/app/api/orders.py
 */

import { apiDelete, apiGet, apiPost, apiPut, apiPatch } from "./client";
import type { OrderOut, ValidateOut } from "@/types/api";

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

// PUT /orders/{order_id}/selections/{component_id}
export function updateSelection(
  orderId: string,
  componentId: string,
  variationId: string,
  variationTypeId?: string | null,
  signal?: AbortSignal,
): Promise<OrderOut> {
  return apiPut<OrderOut>(
    `/orders/${orderId}/selections/${componentId}`,
    {
      variation_id: variationId,
      variation_type_id: variationTypeId ?? null,
    },
    { signal },
  );
}

// DELETE /orders/{order_id}/selections/{component_id}
export function resetSelection(
  orderId: string,
  componentId: string,
): Promise<OrderOut> {
  return apiDelete<OrderOut>(`/orders/${orderId}/selections/${componentId}`);
}

// PUT /orders/{order_id}/add-ons/{add_on_id}
export function upsertAddon(
  orderId: string,
  addOnId: string,
  addOnVariationId?: string | null,
  placement?: string | null,
): Promise<OrderOut> {
  return apiPut<OrderOut>(
    `/orders/${orderId}/add-ons/${addOnId}`,
    {
      add_on_variation_id: addOnVariationId ?? null,
      placement: placement ?? null,
    },
  );
}

// PATCH /orders/{order_id}/add-ons/{add_on_id}
export function patchAddon(
  orderId: string,
  addOnId: string,
  addOnVariationId?: string | null,
  placement?: string | null,
): Promise<OrderOut> {
  return apiPatch<OrderOut>(
    `/orders/${orderId}/add-ons/${addOnId}`,
    {
      add_on_variation_id: addOnVariationId ?? null,
      placement: placement ?? null,
    },
  );
}

// DELETE /orders/{order_id}/add-ons/{add_on_id}?placement=...
export function removeAddon(
  orderId: string,
  addOnId: string,
  placement?: string | null,
): Promise<OrderOut> {
  return apiDelete<OrderOut>(`/orders/${orderId}/add-ons/${addOnId}`, {
    query: placement ? { placement } : undefined,
  });
}
