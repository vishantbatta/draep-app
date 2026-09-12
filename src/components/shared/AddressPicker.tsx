"use client";

/**
 * Shared address step for customer-order flows.
 *
 * Extracted from the admin NewOrderSheet (2026-09-11) for reuse by the
 * style-captain walk-in flow. The picker owns the interactive internals
 * (Nominatim autocomplete, map pin + fly-to, reverse geocode); the consumer
 * owns the submitted state (selected id, new-address fields, pin coords,
 * skip flag, show-new toggle) so it can validate and persist on submit.
 */

import { useRef, useState } from "react";
import { MapPinPicker } from "@/components/contact/MapPinPicker";
import {
  searchAddresses,
  reverseGeocode,
  type GeocodeAddressResult,
} from "@/lib/api/geocode";

/** Structural subset of an addresses row — any address-like object works. */
export interface SavedAddress {
  id: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface NewAddressFields {
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  pincode: string;
}

export const EMPTY_NEW_ADDRESS: NewAddressFields = {
  address_line_1: "",
  address_line_2: "",
  city: "",
  state: "",
  pincode: "",
};

interface AddressPickerProps {
  /** Displayed in the saved-addresses label ("Select an address for …"). */
  customerName?: string | null;
  /** An existing customer was matched — toggles the saved/new UI. */
  hasExistingCustomer: boolean;
  addresses: SavedAddress[];
  addressesLoading?: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  showNewForm: boolean;
  onShowNewFormChange: (show: boolean) => void;
  newAddress: NewAddressFields;
  onNewAddressChange: (fields: NewAddressFields) => void;
  pinCoords: { lat: number; lng: number } | null;
  onPinCoordsChange: (coords: { lat: number; lng: number } | null) => void;
  skipChecked: boolean;
  onSkipChange: (skip: boolean) => void;
}

const inputCls =
  "w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none";

export function AddressPicker({
  customerName,
  hasExistingCustomer,
  addresses,
  addressesLoading,
  selectedId,
  onSelect,
  showNewForm,
  onShowNewFormChange,
  newAddress,
  onNewAddressChange,
  pinCoords,
  onPinCoordsChange,
  skipChecked,
  onSkipChange,
}: AddressPickerProps) {
  // Internal autocomplete/search state — never submitted directly.
  const [addrSearch, setAddrSearch] = useState("");
  const [addrResults, setAddrResults] = useState<GeocodeAddressResult[]>([]);
  const [addrDropdownOpen, setAddrDropdownOpen] = useState(false);
  const [addrSearching, setAddrSearching] = useState(false);
  const [flyTo, setFlyTo] = useState<
    { lat: number; lng: number; nonce: number } | undefined
  >(undefined);
  const [reverseLookupLoading, setReverseLookupLoading] = useState(false);
  const addrSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyNonceRef = useRef(0);

  return (
    <div className="space-y-3 pb-4">
      {/* ── Toggle: "Select existing" vs "Add new" ───────────────────── */}
      {hasExistingCustomer && addresses.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              onShowNewFormChange(false);
              onSkipChange(false);
              onNewAddressChange(EMPTY_NEW_ADDRESS);
              setAddrSearch("");
              onPinCoordsChange(null);
              setFlyTo(undefined);
            }}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              !showNewForm
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy/30"
            }`}
          >
            Saved addresses ({addresses.length})
          </button>
          <button
            onClick={() => {
              onShowNewFormChange(true);
              onSkipChange(false);
              onSelect("");
            }}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              showNewForm
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy/30"
            }`}
          >
            + Add new address
          </button>
        </div>
      )}

      {/* ── Existing user addresses ──────────────────────────────────── */}
      {hasExistingCustomer && addresses.length > 0 && !showNewForm && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted">
            Select an address for {customerName ?? "this customer"}
          </label>
          {addressesLoading && <div className="text-xs text-muted">Loading addresses…</div>}
          {addresses.map((addr) => (
            <label
              key={addr.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                selectedId === addr.id
                  ? "border-ink-navy bg-mist-navy/20"
                  : "border-hairline-strong bg-chalk-white hover:bg-mist-navy/10"
              }`}
            >
              <input
                type="radio"
                name="address"
                value={addr.id}
                checked={selectedId === addr.id}
                onChange={(e) => {
                  onSkipChange(false);
                  onSelect(e.target.value);
                }}
                className="mt-0.5"
              />
              <div className="text-xs text-ink">
                <div className="font-medium">{addr.address_line_1 ?? "—"}</div>
                {addr.address_line_2 && <div>{addr.address_line_2}</div>}
                <div className="text-muted">
                  {[addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") || "—"}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {/* ── New address form (for new users or when toggled) ─────────── */}
      {(showNewForm || !hasExistingCustomer || addresses.length === 0) && (
        <div className="space-y-3 rounded-lg border border-hairline bg-mist-navy/10 p-3">
          <div className="text-xs font-semibold text-ink-navy">New Address</div>

          {/* ── Address autocomplete search ────────────────────────────── */}
          <div className="relative">
            <label className="mb-1 block text-[11px] font-medium text-muted">
              Search address <span className="text-muted">(type like Google Maps)</span>
            </label>
            <input
              type="text"
              value={addrSearch}
              onChange={(e) => {
                const v = e.target.value;
                setAddrSearch(v);
                if (addrSearchTimer.current) clearTimeout(addrSearchTimer.current);
                if (v.trim().length < 3) {
                  setAddrResults([]);
                  setAddrDropdownOpen(false);
                  return;
                }
                setAddrSearching(true);
                addrSearchTimer.current = setTimeout(async () => {
                  const results = await searchAddresses(v);
                  setAddrResults(results);
                  setAddrDropdownOpen(results.length > 0);
                  setAddrSearching(false);
                }, 400);
              }}
              onFocus={() => addrResults.length > 0 && setAddrDropdownOpen(true)}
              onBlur={() => setTimeout(() => setAddrDropdownOpen(false), 250)}
              placeholder="e.g. 5th Avenue, HSR Layout, Bangalore"
              className={inputCls}
            />
            {addrSearching && (
              <div className="mt-0.5 text-[10px] text-muted">Searching…</div>
            )}
            {addrDropdownOpen && addrResults.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-hairline-strong bg-chalk-white shadow-lg">
                {addrResults.map((r, i) => (
                  <button
                    key={`${r.lat},${r.lng}-${i}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setAddrSearch(r.label);
                      setAddrDropdownOpen(false);
                      setAddrResults([]);
                      // Autofill address fields
                      onNewAddressChange({
                        address_line_1: r.addressLine1 ?? "",
                        address_line_2: r.addressLine2 ?? "",
                        city: r.city ?? "",
                        state: r.state ?? "",
                        pincode: r.pincode ?? "",
                      });
                      // Set pin + fly to location
                      onPinCoordsChange({ lat: r.lat, lng: r.lng });
                      flyNonceRef.current += 1;
                      setFlyTo({ lat: r.lat, lng: r.lng, nonce: flyNonceRef.current });
                    }}
                    className="block w-full px-3 py-2 text-left text-xs transition hover:bg-mist-navy/30"
                  >
                    <div className="font-medium text-ink">{r.label.split(",")[0]}</div>
                    <div className="text-muted text-[10px] truncate">
                      {r.label.split(",").slice(1).join(",").trim()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Map pin picker ─────────────────────────────────────────── */}
          <MapPinPicker
            lat={pinCoords?.lat}
            lng={pinCoords?.lng}
            onPinChange={(lat, lng) => {
              onPinCoordsChange({ lat, lng });
              // Reverse geocode to autofill (debounced via quick check)
              setReverseLookupLoading(true);
              reverseGeocode(lat, lng)
                .then((result) => {
                  if (result) {
                    onNewAddressChange({
                      address_line_1: result.addressLine1 ?? newAddress.address_line_1,
                      address_line_2: result.addressLine2 ?? newAddress.address_line_2,
                      city: result.city ?? newAddress.city,
                      state: result.state ?? newAddress.state,
                      pincode: result.pincode ?? newAddress.pincode,
                    });
                  }
                })
                .finally(() => setReverseLookupLoading(false));
            }}
            flyTo={flyTo}
          />
          {reverseLookupLoading && (
            <div className="text-[10px] text-muted">Updating address from pin…</div>
          )}

          {/* ── Editable address fields (autofilled, but editable) ─────── */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">
                Address Line 1 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newAddress.address_line_1}
                onChange={(e) => onNewAddressChange({ ...newAddress, address_line_1: e.target.value })}
                placeholder="House no, building, street"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">Address Line 2</label>
              <input
                type="text"
                value={newAddress.address_line_2}
                onChange={(e) => onNewAddressChange({ ...newAddress, address_line_2: e.target.value })}
                placeholder="Area, landmark (optional)"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted">
                  City <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newAddress.city}
                  onChange={(e) => onNewAddressChange({ ...newAddress, city: e.target.value })}
                  placeholder="Bangalore"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted">
                  State <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newAddress.state}
                  onChange={(e) => onNewAddressChange({ ...newAddress, state: e.target.value })}
                  placeholder="Karnataka"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">
                Pincode <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newAddress.pincode}
                onChange={(e) => onNewAddressChange({ ...newAddress, pincode: e.target.value })}
                placeholder="560102"
                className={inputCls}
              />
            </div>
          </div>
        </div>
      )}

      {hasExistingCustomer && addressesLoading && addresses.length === 0 && (
        <div className="text-center text-xs text-muted py-2">Loading addresses…</div>
      )}

      {/* ── Skip (like the Measurement Job step) ─────────────────────── */}
      <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
        skipChecked
          ? "border-ink-navy bg-mist-navy/20"
          : "border-hairline-strong bg-chalk-white hover:bg-mist-navy/10"
      }`}>
        <input
          type="radio"
          name="addressChoice"
          value="skip"
          checked={skipChecked}
          onChange={() => onSkipChange(true)}
          className="mt-0.5"
        />
        <div>
          <div className="text-sm font-medium text-ink-navy">Skip for now</div>
          <div className="text-[11px] text-muted">
            Create the order without an address — add it later from the order page.
          </div>
        </div>
      </label>
    </div>
  );
}
