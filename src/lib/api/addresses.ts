/**
 * Addresses API — the signed-in customer's saved visit addresses.
 * Mirrors be/app/api/addresses.py
 */

import { apiDelete, apiGet, apiPost } from "./client";
import type { Address, AddressCoordinates } from "@/types/api";

export interface AddressIn {
  address_line_1: string;
  address_line_2?: string | null;
  city: string;
  state: string;
  pincode: string;
  coordinates?: AddressCoordinates | null;
}

export function listAddresses(): Promise<Address[]> {
  return apiGet<Address[]>("/addresses");
}

export function createAddress(body: AddressIn): Promise<Address> {
  return apiPost<Address>("/addresses", body);
}

export function deleteAddress(id: string): Promise<void> {
  return apiDelete<void>(`/addresses/${id}`);
}
