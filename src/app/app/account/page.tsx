"use client";

/**
 * /app/account — the customer's account: profile + saved addresses.
 *
 * Reached from the dashboard header's Account button. The profile card
 * carries the identity (editable name via PATCH /auth/me, login phone,
 * Stitch Club membership since) and sign-out lives here — quiet, at the
 * bottom, away from the things you do often.
 *
 * Addresses follow the same flow as admin order creation: type like Google
 * Maps → Nominatim suggestions → pick one to prefill the form + drop the
 * map pin → drag the pin to reverse-geocode → edit anything → save.
 * Opening the sheet also asks for browser location — granted, the pin flies
 * there and the reverse-geocode prefills the form; denied, the default
 * flow (search or drag) is untouched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MapPinPicker } from "@/components/contact/MapPinPicker";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import {
  ArrowLeft,
  Check,
  MapPin,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Sparkle,
  Trash,
} from "@/components/ui/icons";
import { addressesApi } from "@/lib/api";
import { reverseGeocode, searchAddresses } from "@/lib/api/geocode";
import type { GeocodeAddressResult } from "@/lib/api/geocode";
import { useAuthHydrated, useAuthStore } from "@/lib/auth-store";
import { strings } from "@/lib/strings";
import type { Address } from "@/types/api";

/* ============================================================ */

/** ISO datetime → "Jun 26" (Stitch Club member since). */
function formatMemberSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "2-digit",
  }).format(date);
}

/* ============================================================ */

/** Add-address form in a bottom sheet: autocomplete search → map pin → editable fields. */
function AddressForm({
  open,
  onCreated,
  onClose,
}: {
  open: boolean;
  onCreated: (addr: Address) => void;
  onClose: () => void;
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

  const [fields, setFields] = useState({
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    pincode: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, []);

  // A fresh form every time the sheet opens — nothing carries over from a
  // previous abandoned draft.
  useEffect(() => {
    if (!open) return;
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
    setLocating(false);
    userPicked.current = false;

    // Ask for location once per open. On grant, drive the same flyTo →
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
  }, [open]);

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
    try {
      const created = await addressesApi.createAddress({
        address_line_1: fields.address_line_1.trim(),
        address_line_2: fields.address_line_2.trim() || null,
        city: fields.city.trim(),
        state: fields.state.trim(),
        pincode: fields.pincode.trim(),
        coordinates: pin,
      });
      onCreated(created);
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
    <BottomSheet
      open={open}
      onClose={onClose}
      title={strings.account.addAddressTitle}
      footer={
        <>
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
      }
    >
      <div className="pb-2">
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

      {/* ── Map pin picker — compact in the sheet, expandable ───────────── */}
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
      </div>
    </BottomSheet>
  );
}

/* ============================================================ */

export default function AccountPage() {
  const router = useRouter();
  const hydrated = useAuthHydrated();
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const logout = useAuthStore((s) => s.logout);

  const isLoggedIn = sessionType === "user";
  const needsProfile = isLoggedIn && !user?.name;

  // Account is for named, signed-in customers — everyone else goes to /app.
  useEffect(() => {
    if (hydrated && (!isLoggedIn || needsProfile)) {
      router.replace("/app");
    }
  }, [hydrated, isLoggedIn, needsProfile, router]);

  /* ── Name edit ─────────────────────────────────────────────────────── */
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const startEditName = () => {
    setNameDraft(user?.name ?? "");
    setNameError(null);
    setNameSaved(false);
    setEditingName(true);
  };

  const handleSaveName = async () => {
    const name = nameDraft.trim();
    if (!name || nameBusy) return;
    setNameBusy(true);
    setNameError(null);
    try {
      await updateProfile(name);
      setEditingName(false);
      setNameSaved(true);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : strings.account.nameError);
    } finally {
      setNameBusy(false);
    }
  };

  /* ── Addresses ─────────────────────────────────────────────────────── */
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const loadAddresses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAddresses(await addressesApi.listAddresses());
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.account.loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hydrated && isLoggedIn && !needsProfile) {
      void loadAddresses();
    }
  }, [hydrated, isLoggedIn, needsProfile, loadAddresses]);

  const handleRemove = async (id: string) => {
    if (removeBusy) return;
    setRemoveBusy(true);
    try {
      await addressesApi.deleteAddress(id);
      setAddresses((list) => list.filter((a) => a.id !== id));
      setRemovingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.account.removeError);
    } finally {
      setRemoveBusy(false);
    }
  };

  /* ── Skeleton / redirect guard ─────────────────────────────────────── */
  if (!hydrated || !isLoggedIn || needsProfile) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  const memberSince = formatMemberSince(user?.created_at);
  const phoneDisplay = user?.phone
    ? user.phone.length === 10
      ? `${user.phone.slice(0, 5)} ${user.phone.slice(5)}`
      : user.phone
    : null;

  return (
    <ScreenShell className="px-4 pt-6">
      {/* Header — back to orders + identity */}
      <header className="flex items-center gap-3">
        <Link
          href="/app"
          aria-label="Back to your orders"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-pill text-ink-navy transition hover:bg-mist-navy"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <p className="eyebrow">{strings.account.title}</p>
          <h1 className="mt-1 truncate font-heading text-h2 text-ink-navy">
            {user?.name ?? strings.account.title}
          </h1>
        </div>
      </header>

      {/* ── Profile card ─────────────────────────────────────────────── */}
      <section className="mt-6 overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
        <div className="flex items-center gap-3 p-4">
          <span
            aria-hidden
            className="flex h-14 w-14 flex-none items-center justify-center rounded-pill bg-warm-sand"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo_alpha_icon.png"
              alt=""
              className="block h-10 w-10 object-contain"
            />
          </span>

          {editingName ? (
            <div className="min-w-0 flex-1">
              <label htmlFor="account-name" className="block text-caption text-muted">
                {strings.account.editName}
              </label>
              <input
                id="account-name"
                autoFocus
                maxLength={160}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value.slice(0, 160))}
                onKeyDown={(e) => e.key === "Enter" && void handleSaveName()}
                className="mt-1 min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 font-heading text-body text-ink-navy focus:border-navy-interactive focus:outline-none"
              />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-h3 text-ink-navy">{user?.name}</p>
              {phoneDisplay && (
                <p className="mt-0.5 text-caption text-muted">
                  <MonoNumber className="text-data">
                    {user?.country_code ?? "+91"} {phoneDisplay}
                  </MonoNumber>
                </p>
              )}
            </div>
          )}

          {!editingName && (
            <button
              type="button"
              onClick={startEditName}
              aria-label={strings.account.editName}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-pill text-navy-interactive transition hover:bg-mist-navy"
            >
              <Pencil size={16} />
            </button>
          )}
        </div>

        {editingName && (
          <div className="flex items-center gap-2 px-4 pb-4">
            <Button
              loading={nameBusy}
              disabled={!nameDraft.trim()}
              onClick={() => void handleSaveName()}
              className="!min-h-[38px] flex-1 px-4"
            >
              {strings.account.save}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setEditingName(false)}
              className="!min-h-[38px] flex-1 px-4"
            >
              {strings.account.cancel}
            </Button>
          </div>
        )}

        {nameError && editingName && (
          <div className="px-4 pb-4">
            <Banner variant="error">
              <p className="text-caption">{nameError}</p>
            </Banner>
          </div>
        )}

        {/* Membership — the tape footer */}
        <div className="flex items-center gap-2 border-t border-hairline bg-mist-navy/50 px-4 py-3">
          <Sparkle size={14} className="flex-none text-accent-text" aria-hidden />
          <p className="text-caption font-medium text-ink-navy">
            {memberSince
              ? strings.account.memberSince(memberSince)
              : strings.account.memberSince("day one")}
          </p>
          {nameSaved && !editingName && (
            <span className="ml-auto flex items-center gap-1 text-caption text-success-text">
              <Check size={12} aria-hidden /> {strings.account.nameSaved}
            </span>
          )}
        </div>
      </section>

      {/* ── Addresses ────────────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-h3 text-ink-navy">
            {strings.account.addressesTitle}
          </h2>
          {!loading && addresses.length > 0 && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="flex min-h-[38px] items-center gap-1 rounded-pill border-[1.5px] border-ink-navy px-3 text-caption font-semibold text-ink-navy transition hover:bg-mist-navy"
            >
              <Plus size={13} aria-hidden />
              {strings.account.addAddress}
            </button>
          )}
        </div>
        <p className="mt-0.5 text-caption text-muted">{strings.account.addressesHint}</p>

        <AddressForm
          open={showForm}
          onCreated={(addr) => {
            setAddresses((list) => [...list, addr]);
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />

        {loading ? (
          <div className="mt-3 space-y-3" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-card bg-mist-navy/60" />
            ))}
          </div>
        ) : error && addresses.length === 0 ? (
          <div
            role="alert"
            className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 text-body text-error-text shadow-card"
          >
            {strings.account.loadError} {error}
            <Button variant="secondary" className="mt-3" onClick={() => void loadAddresses()}>
              {strings.account.retry}
            </Button>
          </div>
        ) : addresses.length === 0 ? (
          /* Empty state — dashed tape border, per Brand Book */
          <div className="mt-3 rounded-card border border-dashed border-hairline-strong bg-chalk-white/70 p-6 text-center">
            <span
              aria-hidden
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-pill bg-mist-navy text-ink-navy"
            >
              <MapPin size={20} />
            </span>
            <p className="mt-3 font-heading text-body text-ink-navy">
              {strings.account.emptyTitle}
            </p>
            <p className="mt-0.5 text-caption text-muted">{strings.account.emptyBody}</p>
            <Button className="mt-4" onClick={() => setShowForm(true)}>
              {strings.account.addAddress}
            </Button>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {addresses.map((addr) => (
              <li
                key={addr.id}
                className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
                  >
                    <MapPin size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-ink-navy">
                      {addr.address_line_1}
                    </p>
                    {addr.address_line_2 && (
                      <p className="text-caption text-muted">{addr.address_line_2}</p>
                    )}
                    <p className="mt-0.5 text-caption text-muted">
                      {addr.city}
                      {addr.city && addr.state ? ", " : ""}
                      {addr.state}
                      {addr.pincode ? (
                        <>
                          {" — "}
                          <MonoNumber className="text-data">{addr.pincode}</MonoNumber>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {removingId !== addr.id && (
                    <button
                      type="button"
                      aria-label={strings.account.remove}
                      onClick={() => {
                        setRemovingId(addr.id);
                        setError(null);
                      }}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-pill text-muted transition hover:bg-error-bg hover:text-error-text"
                    >
                      <Trash size={15} />
                    </button>
                  )}
                </div>

                {removingId === addr.id && (
                  <div className="mt-3 flex items-center gap-2 rounded-card bg-error-bg/60 px-3 py-2.5">
                    <p className="min-w-0 flex-1 text-caption text-ink-navy">
                      {strings.account.removeConfirm}{" "}
                      <span className="text-muted">{strings.account.removeConfirmBody}</span>
                    </p>
                    <Button
                      variant="secondary"
                      loading={removeBusy}
                      onClick={() => void handleRemove(addr.id)}
                      className="!min-h-[34px] flex-none !border-error-text px-3 text-caption !text-error-text"
                    >
                      {strings.account.remove}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={removeBusy}
                      onClick={() => setRemovingId(null)}
                      className="!min-h-[34px] flex-none px-3 text-caption"
                    >
                      {strings.account.keep}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && addresses.length > 0 && (
          <Banner variant="error" className="mt-3">
            <p className="text-caption">{error}</p>
          </Banner>
        )}
      </section>

      {/* ── Sign out — quiet, at the end ─────────────────────────────── */}
      <button
        type="button"
        onClick={() => void logout()}
        className="mx-auto mt-8 block rounded-pill px-3 py-2 text-caption font-semibold text-navy-interactive underline"
      >
        {strings.account.signOut}
      </button>
    </ScreenShell>
  );
}
