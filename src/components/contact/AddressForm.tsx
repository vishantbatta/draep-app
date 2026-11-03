"use client";

/**
 * Add-address form, in two steps:
 *
 *   1. Pin the location — autocomplete search and/or the map (drag, tap,
 *      "Use my location", or the one-time GPS ask on activation).
 *   2. Confirm the address — the pin's reverse-geocoded address prefills
 *      the fields, with the map + pin still visible. Moving the pin here
 *      only updates the coordinates that get saved; it never rewrites the
 *      fields (the user may have already corrected them).
 *
 * Extracted from the account page so the same form powers both the account
 * bottom sheet and the full-page order address flow. The host supplies the
 * save behavior: the account sheet POSTs /addresses, the order page PUTs
 * the order's contact (which saves the address AND attaches it to the
 * order, like the admin dashboard does). `active` gates the fresh-form
 * reset and the geolocation ask — a reopened sheet starts clean, a full
 * page asks once on mount.
 */

import { useEffect, useRef, useState } from "react";

import { MapPinPicker } from "@/components/contact/MapPinPicker";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, Maximize2, Minimize2 } from "@/components/ui/icons";
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

  // Step 1 = pin the location; step 2 = confirm/edit the prefilled address.
  const [step, setStep] = useState<1 | 2>(1);

  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; nonce: number } | null>(null);
  const flyNonce = useRef(0);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(true);
  const [locating, setLocating] = useState(false);
  // Set when the user picks a suggestion, so a slow geolocation fix doesn't
  // fly the pin away from a position they already chose.
  const userPicked = useRef(false);
  // Coords key of the pin the fields were prefilled from. Decides whether
  // (re-)entering step 2 should prefill again (pin changed / fields empty)
  // or keep the user's edits (same pin, fields already confirmed).
  const prefilledFrom = useRef<string | null>(null);
  const [prefillFailed, setPrefillFailed] = useState(false);

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
    setStep(1);
    setSearch("");
    setResults([]);
    setDropdownOpen(false);
    setSearching(false);
    setPin(null);
    setFlyTo(null);
    setMapExpanded(true);
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
    setPrefillFailed(false);
    userPicked.current = false;
    prefilledFrom.current = null;

    // Ask for location once per activation. On grant, drive the same flyTo →
    // onPinChange path a suggestion pick uses, so the pin lands without
    // duplicated logic. A denial or timeout is not an error — the
    // search/drag flow stands on its own.
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
    // The suggestion's parsed parts ARE the address of this pin — step 2
    // must keep them, not overwrite them with a reverse geocode.
    prefilledFrom.current = `${r.lat},${r.lng}`;
    setPrefillFailed(false);
    flyNonce.current += 1;
    setFlyTo({ lat: r.lat, lng: r.lng, nonce: flyNonce.current });
  };

  // Any deliberate map interaction (drag end / tap / fly-to). In step 1 it
  // moves the candidate pin (continue re-prefills from it). In step 2 the
  // fields are frozen by design — adopt the new pin as the fields' pin so a
  // back → continue round-trip keeps the user's entries; only a pin moved
  // back in step 1 re-prefills.
  const handlePinChange = (lat: number, lng: number) => {
    userPicked.current = true;
    setPin({ lat, lng });
    if (step === 2) prefilledFrom.current = `${lat},${lng}`;
  };

  // Step 1 → 2: prefill the fields from the pin — only when the pin changed
  // since the last prefill or the fields are empty. Otherwise keep the
  // user's edits (they went back to peek, or re-pinned the same spot).
  const goStep2 = async () => {
    if (!pin || reverseLoading) return;
    const key = `${pin.lat},${pin.lng}`;
    const fieldsEmpty =
      !fields.address_line_1 && !fields.city && !fields.state && !fields.pincode;
    if (key !== prefilledFrom.current || fieldsEmpty) {
      setReverseLoading(true);
      setPrefillFailed(false);
      let result: GeocodeAddressResult | null = null;
      try {
        result = await reverseGeocode(pin.lat, pin.lng);
      } catch {
        result = null;
      }
      setReverseLoading(false);
      if (result) {
        setFields({
          address_line_1: result.addressLine1 ?? "",
          address_line_2: result.addressLine2 ?? "",
          city: result.city ?? "",
          state: result.state ?? "",
          pincode: result.pincode ?? "",
        });
        prefilledFrom.current = key;
      } else {
        setPrefillFailed(true);
      }
    }
    setMapExpanded(false);
    setStep(2);
  };

  const goStep1 = () => {
    setStep(1);
    setMapExpanded(true);
    setPrefillFailed(false);
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
      {/* ── Step indicator ─────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center gap-1.5" aria-hidden>
        <span
          className={`flex-1 rounded-pill px-2 py-1 text-center text-caption font-medium ${
            step === 1 ? "bg-ink-navy text-chalk-white" : "bg-mist-navy text-muted"
          }`}
        >
          {strings.account.stepPin}
        </span>
        <span
          className={`flex-1 rounded-pill px-2 py-1 text-center text-caption font-medium ${
            step === 2 ? "bg-ink-navy text-chalk-white" : "bg-mist-navy text-muted"
          }`}
        >
          {strings.account.stepDetails}
        </span>
      </div>

      {step === 2 && (
        <button
          type="button"
          onClick={goStep1}
          className="mb-1 flex min-h-[38px] items-center gap-1.5 text-caption font-semibold text-navy-interactive transition hover:text-ink-navy"
        >
          <ArrowLeft size={14} aria-hidden />
          {strings.account.backToMap}
        </button>
      )}

      {/* ── Step 1 · Autocomplete search (type like Google Maps) ───────────── */}
      {step === 1 && (
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
      )}

      {/* ── Map pin picker — shared by both steps, never unmounted between them ── */}
      <div className="relative mt-3">
        <MapPinPicker
          lat={pin?.lat}
          lng={pin?.lng}
          onPinChange={handlePinChange}
          flyTo={flyTo ?? undefined}
          mapClassName={mapExpanded ? "aspect-[4/3]" : "h-44"}
          emitInitial={false}
        />
        <button
          type="button"
          onClick={() => setMapExpanded((v) => !v)}
          aria-label={mapExpanded ? strings.account.shrinkMap : strings.account.expandMap}
          className="absolute right-2 top-2 z-[1001] flex h-9 w-9 items-center justify-center rounded-pill bg-chalk-white text-ink-navy shadow-card transition hover:bg-mist-navy"
        >
          {mapExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        {step === 1 && locating && (
          <p className="mt-1 text-caption text-muted">{strings.account.locating}</p>
        )}
        {step === 2 && (
          <p className="mt-1 text-caption text-muted">{strings.account.pinFrozenNote}</p>
        )}
      </div>

      {/* ── Step 2 · Editable address fields (prefilled from the pin) ───────── */}
      {step === 2 && (
        <div className="mt-3 space-y-3">
          {prefillFailed && (
            <p className="text-caption text-muted">{strings.account.prefillFailedNote}</p>
          )}
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
      )}

      {/* ── Sticky action bar — Continue (step 1) / Save (step 2) ──────────── */}
      <div className="sticky bottom-0 mt-4 border-t border-hairline bg-chalk-white pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
        {step === 1 ? (
          <>
            {!pin && (
              <p className="mb-2 text-caption text-muted">{strings.account.pinFirstHint}</p>
            )}
            <Button
              fullWidth
              loading={reverseLoading}
              disabled={!pin}
              onClick={() => void goStep2()}
            >
              {strings.account.continueCta}
            </Button>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
