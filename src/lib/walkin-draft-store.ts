"use client";

/**
 * WalkInDraft — in-memory store for the pre-order part of the walk-in
 * wizard (phone → OTP → address → first garment).
 *
 * The routes own navigation now; this tiny store only carries what the next
 * screen needs across client-side route changes. It is deliberately NOT
 * persisted: once the order exists, every screen is refresh-proof off the
 * SERVER snapshot (?order=…); before that, a refresh simply restarts at the
 * phone screen — nothing was committed server-side except the user row.
 */

import { create } from "zustand";

import type { SavedAddress } from "@/components/shared/AddressPicker";

/** New-address fields as the walk-in endpoints take them. */
export interface WalkInAddressPayload {
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  state: string;
  pincode: string;
  coordinates: { lat: number; lng: number } | null;
}

export type WalkInAddressChoice =
  | { addressId: string }
  | { newAddress: WalkInAddressPayload };

interface WalkInDraftState {
  phone: string;
  countryCode: string;
  /** Lookup result (phone screen). */
  isNewUser: boolean;
  customerName: string | null;
  /** Lookup's user id for EXISTING customers (null for new). */
  lookupUserId: string | null;
  savedAddresses: SavedAddress[];
  /** Set right after OTP verification (user created/linked server-side). */
  userId: string | null;
  /** Chosen at the address screen — rides the first-garment creation. */
  addressChoice: WalkInAddressChoice | null;
  /** The walk-in order, once the first garment creates it. */
  orderId: string | null;

  setLookup: (p: {
    phone: string;
    countryCode: string;
    isNewUser: boolean;
    customerName: string | null;
    lookupUserId: string | null;
    savedAddresses: SavedAddress[];
  }) => void;
  setUser: (userId: string) => void;
  setCountryCode: (cc: string) => void;
  setAddressChoice: (choice: WalkInAddressChoice | null) => void;
  setOrderId: (orderId: string) => void;
  reset: () => void;
}

export const useWalkInDraft = create<WalkInDraftState>((set) => ({
  phone: "",
  countryCode: "+91",
  isNewUser: false,
  customerName: null,
  lookupUserId: null,
  savedAddresses: [],
  userId: null,
  addressChoice: null,
  orderId: null,
  setLookup: (p) =>
    set({
      phone: p.phone,
      countryCode: p.countryCode,
      isNewUser: p.isNewUser,
      customerName: p.customerName,
      lookupUserId: p.lookupUserId,
      savedAddresses: p.savedAddresses,
      userId: null,
      addressChoice: null,
      orderId: null,
    }),
  setUser: (userId) => set({ userId }),
  setCountryCode: (countryCode) => set({ countryCode }),
  setAddressChoice: (addressChoice) => set({ addressChoice }),
  setOrderId: (orderId) => set({ orderId }),
  reset: () =>
    set({
      phone: "",
      countryCode: "+91",
      isNewUser: false,
      customerName: null,
      lookupUserId: null,
      savedAddresses: [],
      userId: null,
      addressChoice: null,
      orderId: null,
    }),
}));
