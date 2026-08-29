"use client";

/**
 * Add-address form: autocomplete search → map pin → editable fields.
 *
 * Extracted from the account page so the same form powers both the account
 * bottom sheet and the full-page order address flow. The host supplies the
 * save behavior: the account sheet POSTs /addresses, the order page PUTs the
 * order's contact (which saves the address AND attaches it to the order,
 * like the admin dashboard does). `active` gates the fresh-form reset and
 * the geolocation ask — a reopened sheet starts clean, a full page asks
 * once on mount.
 */

import { useEffect, useRef, useState } from "react";

import { MapPinPicker } from "@/components/contact/MapPinPicker";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Maximize2, Minimize2 } from "@/components/ui/icons";
import { reverseGeocode, searchAddresses } from "@/lib/api/geocode";
import type { GeocodeAddressResult } from "@/lib/api/geocode";
import { strings } from "@/lib/strings";
import type { Address } from "@/types/api";

/** The five text fields the form collects and hands to `saveAddress` (trimmed). */
export type AddressFormFields = {
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  pincode: string;
};

export function AddressForm({
  active,
  saveAddress,
  onSaved,
}: {
  active: boolean;
  saveAddress: (
    fields: AddressFormFields,
    pin: { lat: number; lng: number } | null,
  ) => Promise<Address | null>;
  onSaved: (addr: Address | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GeocodeAddressResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<number | null>(null);

  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; nonce: number } | null>(null);
  const flyNonce = useRef(0);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [locating, setLocating] = useState(false);
  // Set when the user picks a suggestion, so a slow geolocation fix doesn't
  // fly the pin away from a position they already chose.
  const userPicked = useRef(false);

  const [fields, setFields] = useState<AddressFormFields>({
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    pincode: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Layer-1 verdict from the save response: the address IS saved, but sits
  // outside the serviceable area — shown here and/or by the host on the row.
  const [savedOut, setSavedOut] = useState(false);

  useEffect(() => {
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, []);

  // A fresh form every time the form becomes active — nothing carries over
  // from a previous abandoned draft.
  useEffect(() => {
    if (!active) return;
    setSearch("");
    setResults([]);
    setDropdownOpen(false);
    setSearching(false);
    setPin(null);
    setFlyTo(null);
    setMapExpanded(false);
    setFields({
      address_line_1: "",
      address_line_2: "",
      city: "",
      state: "",
      pincode: "",
    });
    setSaving(false);
    setError(null);
    setSavedOut(false);
    setLocating(false);
    userPicked.current = false;

    // Ask for location once per activation. On grant, drive the same flyTo →
    // onPinChange → reverse-geocode path a suggestion pick uses, so the
    // form prefills without duplicated logic. A denial or timeout is not
    // an error — the search/drag flow stands on its own.
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          if (userPicked.current) return;
          const { latitude, longitude } = pos.coords;
          setPin({ lat: latitude, lng: longitude });
          flyNonce.current += 1;
          setFlyTo({ lat: latitude, lng: longitude, nonce: flyNonce.current });
        },
        () => setLocating(false),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    }
  }, [active]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (value.trim().length < 3) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(async () => {
      const found = await searchAddresses(value);
      setResults(found);
      setDropdownOpen(found.length > 0);
      setSearching(false);
    }, 400);
  };

  const pickSuggestion = (r: GeocodeAddressResult) => {
    userPicked.current = true;
    setSearch(r.label);
    setDropdownOpen(false);
    setResults([]);
    setFields({
      address_line_1: r.addressLine1 ?? "",
      address_line_2: r.addressLine2 ?? "",
      city: r.city ?? "",
      state: r.state ?? "",
      pincode: r.pincode ?? "",
    });
    setPin({ lat: r.lat, lng: r.lng });
    flyNonce.current += 1;
    setFlyTo({ lat: r.lat, lng: r.lng, nonce: flyNonce.current });
  };

  const handlePinChange = (lat: number, lng: number) => {
    setPin({ lat, lng });
    setReverseLoading(true);
    reverseGeocode(lat, lng)
      .then((result) => {
        if (result) {
          setFields((f) => ({
            address_line_1: result.addressLine1 ?? f.address_line_1,
            address_line_2: result.addressLine2 ?? f.address_line_2,
            city: result.city ?? f.city,
            state: result.state ?? f.state,
            pincode: result.pincode ?? f.pincode,
          }));
        }
      })
      .finally(() => setReverseLoading(false));
  };

  const requiredFilled =
    fields.address_line_1.trim().length > 0 &&
    fields.city.trim().length > 0 &&
    fields.state.trim().length > 0 &&
    /^\d{6}$/.test(fields.pincode.trim());

  const handleSave = async () => {
    if (!requiredFilled || saving) return;
    setSaving(true);
    setError(null);
    setSavedOut(false);
    try {
      const created = await saveAddress(
        {
          address_line_1: fields.address_line_1.trim(),
          address_line_2: fields.address_line_2.trim(),
          city: fields.city.trim(),
          state: fields.state.trim(),
          pincode: fields.pincode.trim(),
        },
        pin,
      );
      // Saving never blocks — surface the area verdict, then hand the saved
      // row to the host (sheet closes / page navigates as it pleases).
      if (created && created.serviceable === false) setSavedOut(true);
      onSaved(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.account.saveError);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none";
  const labelClass = "block text-caption text-muted";

  return (
    <div>
      {/* ── Autocomplete search (type like Google Maps) ─────────────────── */}
      <div className="relative">
        <label htmlFor="addr-search" className={labelClass}>
          {strings.account.searchLabel}{" "}
          <span className="text-muted/70">({strings.account.searchHint})</span>
        </label>
        <input
          id="addr-search"
          type="text"
          autoComplete="off"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => results.length > 0 && setDropdownOpen(true)}
          onBlur={() => window.setTimeout(() => setDropdownOpen(false), 250)}
          placeholder={strings.account.searchPlaceholder}
          className={`${inputClass} mt-1`}
        />
        {searching && (
          <p className="mt-0.5 text-caption text-muted">{strings.account.searching}</p>
        )}
        {dropdownOpen && results.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-card border border-hairline bg-chalk-white shadow-card">
            {results.map((r, i) => (
              <button
                key={`${r.lat},${r.lng}-${i}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSuggestion(r)}
                className="block w-full px-3 py-2.5 text-left transition hover:bg-mist-navy/40"
              >
                <span className="block text-caption font-semibold text-ink-navy">
                  {r.label.split(",")[0]}
                </span>
                <span className="block truncate text-caption text-muted">
                  {r.label.split(",").slice(1).join(",").trim()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Map pin picker — compact, expandable ────────────────────────── */}
      <div className="relative mt-3">
        <MapPinPicker
          lat={pin?.lat}
          lng={pin?.lng}
          onPinChange={handlePinChange}
          flyTo={flyTo ?? undefined}
          mapClassName={mapExpanded ? "aspect-[4/3]" : "h-44"}
        />
        <button
          type="button"
          onClick={() => setMapExpanded((v) => !v)}
          aria-label={mapExpanded ? strings.account.shrinkMap : strings.account.expandMap}
          className="absolute right-2 top-2 z-[1001] flex h-9 w-9 items-center justify-center rounded-pill bg-chalk-white text-ink-navy shadow-card transition hover:bg-mist-navy"
        >
          {mapExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        {(locating || reverseLoading) && (
          <p className="mt-1 text-caption text-muted">
            {locating ? strings.account.locating : strings.account.updatingFromPin}
          </p>
        )}
      </div>

      {/* ── Editable address fields ─────────────────────────────────────── */}
      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="addr-line1" className={labelClass}>
            {strings.account.line1Label}
          </label>
          <input
            id="addr-line1"
            type="text"
            autoComplete="address-line1"
            value={fields.address_line_1}
            onChange={(e) => setFields({ ...fields, address_line_1: e.target.value })}
            placeholder={strings.account.line1Placeholder}
            className={`${inputClass} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="addr-line2" className={labelClass}>
            {strings.account.line2Label}
          </label>
          <input
            id="addr-line2"
            type="text"
            autoComplete="address-line2"
            value={fields.address_line_2}
            onChange={(e) => setFields({ ...fields, address_line_2: e.target.value })}
            placeholder={strings.account.line2Placeholder}
            className={`${inputClass} mt-1`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="addr-city" className={labelClass}>
              {strings.account.cityLabel}
            </label>
            <input
              id="addr-city"
              type="text"
              autoComplete="address-level2"
              value={fields.city}
              onChange={(e) => setFields({ ...fields, city: e.target.value })}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="addr-state" className={labelClass}>
              {strings.account.stateLabel}
            </label>
            <input
              id="addr-state"
              type="text"
              autoComplete="address-level1"
              value={fields.state}
              onChange={(e) => setFields({ ...fields, state: e.target.value })}
              className={`${inputClass} mt-1`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="addr-pincode" className={labelClass}>
            {strings.account.pincodeLabel}
          </label>
          <input
            id="addr-pincode"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            value={fields.pincode}
            onChange={(e) =>
              setFields({ ...fields, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })
            }
            placeholder="560102"
            className={`${inputClass} mt-1`}
          />
        </div>
      </div>

      {/* ── Sticky save bar — stays pinned at the bottom while the form scrolls */}
      <div className="sticky bottom-0 mt-4 border-t border-hairline bg-chalk-white pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
        {savedOut && (
          <Banner variant="error" className="mb-3">
            <p className="text-caption">{strings.serviceability.notServiceableYet}</p>
          </Banner>
        )}
        {error && (
          <Banner variant="error" className="mb-3">
            <p className="text-caption">{error}</p>
          </Banner>
        )}
        <Button
          fullWidth
          loading={saving}
          disabled={!requiredFilled}
          onClick={() => void handleSave()}
        >
          {strings.account.saveAddress}
        </Button>
      </div>
    </div>
  );
}
