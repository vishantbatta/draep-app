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

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AddressForm } from "@/components/contact/AddressForm";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import {
  ArrowLeft,
  Check,
  MapPin,
  Pencil,
  Plus,
  Sparkle,
  Trash,
} from "@/components/ui/icons";
import { addressesApi } from "@/lib/api";
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

        <BottomSheet
          open={showForm}
          onClose={() => setShowForm(false)}
          title={strings.account.addAddressTitle}
        >
          <AddressForm
            active={showForm}
            saveAddress={(fields, pin) =>
              addressesApi.createAddress({
                address_line_1: fields.address_line_1,
                address_line_2: fields.address_line_2 || null,
                city: fields.city,
                state: fields.state,
                pincode: fields.pincode,
                coordinates: pin,
              })
            }
            onSaved={(addr) => {
              if (addr) {
                setAddresses((list) => [...list, addr]);
                setShowForm(false);
              }
            }}
          />
        </BottomSheet>

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
