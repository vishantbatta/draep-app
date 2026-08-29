/**
 * Service Area API — polygon shape, serviceability check, contact save.
 * Mirrors be/app/api/service_area.py
 */

import { apiGet, apiPost, apiPut } from "./client";
import type {
  ContactUpdateIn,
  OrderOut,
  ServiceAreaCheckOut,
  ServiceAreaShapeOut,
} from "@/types/api";

export function getServiceAreaShape(): Promise<ServiceAreaShapeOut> {
  return apiGet<ServiceAreaShapeOut>("/service-area/shape");
}

export function checkServiceability(
  lat: number,
  lng: number,
): Promise<ServiceAreaCheckOut> {
  return apiGet<ServiceAreaCheckOut>("/service-area/check", {
    query: { lat, lng },
  });
}

export function updateOrderContact(
  orderId: string,
  body: ContactUpdateIn,
): Promise<OrderOut> {
  return apiPut<OrderOut>(`/orders/${orderId}/contact`, body);
}

/** POST /service-area/notify-me — capture demand from the "No slots
 *  available, we will notify you" state. Fire-and-forget from the FE. */
export function notifyMe(body: {
  order_id?: string;
  lat?: number;
  lng?: number;
  note?: string;
}): Promise<{ id: string }> {
  return apiPost<{ id: string }>("/service-area/notify-me", body);
}
