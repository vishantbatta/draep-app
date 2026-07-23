/**
 * Service Area API — polygon shape, serviceability check, contact save.
 * Mirrors be/app/api/service_area.py
 */

import { apiGet, apiPut } from "./client";
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
