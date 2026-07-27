/**
 * Booking API — slot selection + measurement visit booking.
 * Mirrors be/app/api/booking.py
 *
 * All endpoints are nested under /orders/{orderId}/… and use the same
 * customer session token as the rest of the order flow.
 */

import { apiGet, apiPost, apiPatch, apiDelete } from "./client";
import type { SlotsResponse, Booking } from "@/types/booking";

/** GET /orders/{orderId}/slots — collapsed availability across captains. */
export function getSlots(
  orderId: string,
  fromDate?: string,
  toDate?: string,
): Promise<SlotsResponse> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  const qs = params.toString();
  return apiGet<SlotsResponse>(`/orders/${orderId}/slots${qs ? `?${qs}` : ""}`);
}

/** GET /orders/{orderId}/booking — current active booking, or throws 404. */
export function getBooking(orderId: string): Promise<Booking> {
  return apiGet<Booking>(`/orders/${orderId}/booking`);
}

/** POST /orders/{orderId}/booking — book a visit at startAt (ISO datetime). */
export function createBooking(orderId: string, startAt: string): Promise<Booking> {
  return apiPost<Booking>(`/orders/${orderId}/booking`, { start_at: startAt });
}

/** PATCH /orders/{orderId}/booking — reschedule the active visit. */
export function rescheduleBooking(orderId: string, startAt: string): Promise<Booking> {
  return apiPatch<Booking>(`/orders/${orderId}/booking`, { start_at: startAt });
}

/** DELETE /orders/{orderId}/booking — cancel the active visit. */
export function cancelBooking(orderId: string): Promise<void> {
  return apiDelete<void>(`/orders/${orderId}/booking`);
}
