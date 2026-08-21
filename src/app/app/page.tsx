"use client";

/**
 * /app — the customer account dashboard.
 *
 * The post-payment home the product was missing (audit C2/C3): greeting +
 * profile, a resume banner for the active draft, order history with status,
 * invoices and one-tap re-order from the design library.
 *
 * Auth: reuses the customer session from the auth store (anonymous → OTP
 * upgrade). Anonymous visitors get an inline phone+OTP card instead of a
 * redirect — the booking flow's /otp page is step-scoped with no return-to.
 * OTP goes through the MSG91 widget (lib/msg91.ts) when configured; the
 * legacy test-mode endpoints are the fallback.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { OrderStatusPills } from "@/components/order/OrderStatus";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { MonoNumber } from "@/components/ui/MonoNumber";
import {
  Calendar,
  Check,
  ChevronRight,
  ShieldCheck,
  Sparkle,
  Thread,
  User,
} from "@/components/ui/icons";
import { libraryApi, ordersApi } from "@/lib/api";
import { useAuthHydrated, useAuthStore } from "@/lib/auth-store";
import { msg91Enabled, otpLength, sendOtpViaMsg91, verifyOtpViaMsg91 } from "@/lib/msg91";
import { useBookingStore } from "@/lib/booking-store";
import { displayOrderNumber, formatDate, slotVisitLabel } from "@/lib/order-display";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import type { OrderListItem } from "@/types/api";

/* ============================================================ */

/** "9876543210" → "98765 43210" for display only. */
function formatPhoneDisplay(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;
}

/** Seconds before "Resend code" re-enables — matches MSG91's own resend pacing. */
const RESEND_COOLDOWN_S = 30;

/** users.gender column allows exactly these values (be/app/models/user.py). */
const GENDER_OPTIONS = [
  { value: "male", label: strings.dashboard.genderMale },
  { value: "female", label: strings.dashboard.genderFemale },
  { value: "other", label: strings.dashboard.genderOther },
] as const;

export default function AppDashboardPage() {
  const router = useRouter();
  const hydrated = useAuthHydrated();
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);
  const activeOrderId = useAuthStore((s) => s.activeOrderId);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const verifyOtpWidget = useAuthStore((s) => s.verifyOtpWidget);
  const updateProfile = useAuthStore((s) => s.updateProfile);  const hydrateFromLibraryOrder = useBookingStore((s) => s.hydrateFromLibraryOrder);

  const isLoggedIn = sessionType === "user";

  // OTP login auto-creates the user row without a name — a signed-in user
  // with no name is a first-timer who still owes us their profile before
  // the orders dashboard unlocks.
  const needsProfile = isLoggedIn && !user?.name;

  /* ── Orders list ─────────────────────────────────────────────────────── */
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reorderId, setReorderId] = useState<string | null>(null);

  const loadOrders = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const out = await ordersApi.listOrders(p);
      setOrders(out.items);
      setPage(out.page);
      setTotalPages(out.total_pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.errors.generic);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hydrated && isLoggedIn && !needsProfile) {
      void loadOrders(1);
    } else if (hydrated) {
      setOrders([]);
      setLoading(false);
    }
  }, [hydrated, isLoggedIn, needsProfile, loadOrders]);

  /* ── Inline login (anonymous → user via OTP) ─────────────────────────── */
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [codeResent, setCodeResent] = useState(false);

  // Resend cooldown — one interval while it counts down, none once it hits 0.
  const coolingDown = resendCooldown > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => {
      setResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  const handleSendOtp = async () => {
    if (phone.length !== 10) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      if (msg91Enabled) {
        // MSG91 identifier = country code + phone, no plus.
        await sendOtpViaMsg91(`91${phone}`);
      } else {
        await sendOtp(phone);
      }
      setOtpSent(true);
      setResendCooldown(RESEND_COOLDOWN_S);
      setCodeResent(false);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setLoginBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loginBusy) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      if (msg91Enabled) {
        await sendOtpViaMsg91(`91${phone}`);
      } else {
        await sendOtp(phone);
      }
      // The new code supersedes whatever was typed — start clean.
      setOtp("");
      setCodeResent(true);
      setResendCooldown(RESEND_COOLDOWN_S);
      document.getElementById("dash-otp")?.focus();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setLoginBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== otpLength) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      if (msg91Enabled) {
        // Widget verifies the code with MSG91 → one-time token → backend
        // re-verifies it and mints the session.
        const otpToken = await verifyOtpViaMsg91(otp);
        await verifyOtpWidget(phone, otpToken);
      } else {
        await verifyOtp(phone, otp);
      }
      // sessionType flips to "user" in the store → the effect above loads orders.
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setLoginBusy(false);
    }
  };

  /* ── First-login profile completion (name + gender) ──────────────────── */
  const [profileName, setProfileName] = useState("");
  const [profileGender, setProfileGender] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const handleSaveProfile = async () => {
    const name = profileName.trim();
    if (!name || !profileGender) return;
    setProfileBusy(true);
    setProfileError(null);
    try {
      await updateProfile(name, profileGender);
      // user.name set in the store → needsProfile flips false → orders load.
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : strings.dashboard.profileError,
      );
    } finally {
      setProfileBusy(false);
    }
  };

  /* ── Re-order: draft from the same library design, land in review ─────── */
  const handleReorder = async (order: OrderListItem) => {
    if (!order.library_id) return;
    setReorderId(order.id);
    setError(null);
    try {
      const out = await libraryApi.draftFromLibrary(order.library_id);
      await hydrateFromLibraryOrder(out.order);
      router.push("/review");
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.errors.generic);
    } finally {
      setReorderId(null);
    }
  };

  /* ── Skeleton while the persisted session rehydrates ─────────────────── */
  if (!hydrated) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  return (
    <ScreenShell className="px-4 pt-6">
      {/* Header — greeting + identity + sign out */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{strings.dashboard.title}</p>
          <h1 className="mt-1 font-heading text-h1 text-ink-navy">
            {strings.dashboard.greeting(user?.name ?? null)}
          </h1>
          {isLoggedIn && user?.phone && (
            <p className="mt-1 text-caption text-muted">
              <MonoNumber className="text-data">
                {user.country_code ?? "+91"} {user.phone}
              </MonoNumber>
            </p>
          )}
        </div>
        {isLoggedIn && (
          <Link
            href="/app/account"
            aria-label={strings.dashboard.account}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-pill text-ink-navy transition hover:bg-mist-navy"
          >
            <User size={18} />
          </Link>
        )}
      </header>

      {/* Anonymous → inline OTP login card */}
      {!isLoggedIn && (
        <section className="mt-6 overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
          {/* Hero — floating brand logo + welcome copy */}
          <div className="flex flex-col items-center border-b border-hairline bg-warm-sand px-4 py-6 text-center">
            <span className="inline-block animate-logo-float motion-reduce:animate-none drop-shadow-[0_12px_14px_rgba(168,80,16,0.28)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="draep" className="block h-[56px] w-auto" />
            </span>
            <h2 className="mt-4 font-heading text-h3 text-ink-navy">
              {strings.dashboard.loginTitle}
            </h2>
            <p className="mt-0.5 font-heading text-body text-accent-text">
              {strings.dashboard.loginTagline}
            </p>
          </div>

          <div className="p-4">
            {!otpSent ? (
              <div>
                <label htmlFor="dash-phone" className="text-caption text-muted">
                  {strings.dashboard.phoneLabel}
                </label>
                <div className="mt-1 flex items-stretch gap-2">
                  <span
                    aria-hidden
                    data-mono
                    className="inline-flex min-w-[56px] items-center justify-center rounded-card border-[1.5px] border-hairline bg-mist-navy px-3 font-heading text-body text-ink-navy"
                  >
                    +91
                  </span>
                  <input
                    id="dash-phone"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="98765 43210"
                    className="min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 font-heading text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none"
                  />
                </div>
                <p className="mt-1.5 text-caption text-muted">
                  We&apos;ll text a {otpLength}-digit code to verify it&apos;s you.
                </p>
                <Button
                  fullWidth
                  className="mt-3"
                  loading={loginBusy}
                  disabled={phone.length !== 10}
                  onClick={() => void handleSendOtp()}
                >
                  {strings.dashboard.sendCode}
                </Button>
              </div>
            ) : (
              <div>
                {/* Sent confirmation — where the code went */}
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-card bg-success-bg px-3 py-2"
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-pill bg-success text-chalk-white"
                  >
                    <Check size={13} />
                  </span>
                  <p className="text-caption text-ink/85">
                    Code sent to{" "}
                    <MonoNumber className="font-semibold text-data text-ink-navy">
                      +91 {formatPhoneDisplay(phone)}
                    </MonoNumber>
                  </p>
                </div>

                <label htmlFor="dash-otp" className="mt-4 block text-caption text-muted">
                  {otpLength}-digit code
                </label>
                <input
                  id="dash-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, otpLength))}
                  className="mt-1 min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 text-center font-mono text-data tracking-[0.4em] text-ink-navy focus:border-navy-interactive focus:outline-none"
                />
                <Button
                  fullWidth
                  className="mt-3"
                  loading={loginBusy}
                  disabled={otp.length !== otpLength}
                  onClick={() => void handleVerifyOtp()}
                >
                  {strings.dashboard.verify}
                </Button>

                {codeResent && (
                  <p role="status" className="mt-2 text-center text-caption text-success-text">
                    {strings.dashboard.codeResent}
                  </p>
                )}

                {resendCooldown > 0 ? (
                  <p className="mt-2 text-center text-caption text-muted">
                    {strings.dashboard.resendCodeIn(resendCooldown)}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={loginBusy}
                    onClick={() => void handleResendOtp()}
                    className="mt-2 w-full text-center text-caption text-navy-interactive underline disabled:no-underline disabled:text-muted"
                  >
                    {strings.dashboard.resendCode}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setResendCooldown(0);
                    setCodeResent(false);
                  }}
                  className="mt-2 w-full text-center text-caption text-navy-interactive underline"
                >
                  {strings.dashboard.useDifferentNumber}
                </button>
              </div>
            )}

            {loginError && (
              <Banner variant="error" className="mt-3">
                <p className="text-caption">{loginError}</p>
              </Banner>
            )}

            {!msg91Enabled && (
              <p className="mt-3 text-center text-caption text-muted">
                {strings.dashboard.demoHint}
              </p>
            )}
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-caption text-muted">
              <ShieldCheck size={14} className="text-accent-text" aria-hidden />
              Your number is used only for your orders
            </p>
          </div>
        </section>
      )}

      {/* First-time user — collect name + gender before the dashboard */}
      {needsProfile && (
        <section className="mt-6 overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
          <div className="flex flex-col items-center border-b border-hairline bg-warm-sand px-4 py-6 text-center">
            <span className="inline-block animate-logo-float motion-reduce:animate-none drop-shadow-[0_12px_14px_rgba(168,80,16,0.28)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo_alpha_icon.png" alt="draep" className="block h-[48px] w-auto" />
            </span>
            <h2 className="mt-4 font-heading text-h3 text-ink-navy">
              {strings.dashboard.profileTitle}
            </h2>
            <p className="mt-0.5 font-heading text-body text-accent-text">
              {strings.dashboard.profileBody}
            </p>
          </div>

          <div className="p-4">
            <label htmlFor="dash-name" className="text-caption text-muted">
              {strings.dashboard.nameLabel}
            </label>
            <input
              id="dash-name"
              autoComplete="name"
              maxLength={160}
              value={profileName}
              onChange={(e) => setProfileName(e.target.value.slice(0, 160))}
              placeholder={strings.dashboard.namePlaceholder}
              className="mt-1 min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 font-heading text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none"
            />

            <p aria-hidden className="mt-4 text-caption text-muted">
              {strings.dashboard.genderLabel}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label={strings.dashboard.genderLabel}>
              {GENDER_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  selected={profileGender === option.value}
                  onClick={() => setProfileGender(option.value)}
                  ariaLabel={option.label}
                >
                  {option.label}
                </Chip>
              ))}
            </div>

            <Button
              fullWidth
              className="mt-4"
              loading={profileBusy}
              disabled={!profileName.trim() || !profileGender}
              onClick={() => void handleSaveProfile()}
            >
              {strings.dashboard.profileSubmit}
            </Button>

            {profileError && (
              <Banner variant="error" className="mt-3">
                <p className="text-caption">{profileError}</p>
              </Banner>
            )}
          </div>
        </section>
      )}

      {isLoggedIn && !needsProfile && (
        <>
          {/* Active draft banner */}
          {activeOrderId && (
            <section className="mt-6 flex items-center gap-3 rounded-card border border-hairline bg-mist-navy p-4 shadow-card">
              <span
                aria-hidden
                className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-accent-fill text-chalk-white"
              >
                <Thread size={20} />
              </span>
              <div className="flex-1">
                <p className="font-heading text-h3 text-ink-navy">
                  {strings.dashboard.activeDraft}
                </p>
                <MonoNumber className="text-caption text-muted">
                  {displayOrderNumber(null, activeOrderId)}
                </MonoNumber>
              </div>
              <Button variant="secondary" onClick={() => router.push("/review")}>
                {strings.dashboard.continueDesign}
              </Button>
            </section>
          )}

          {/* Orders */}
          <section className="mt-6">
            <h2 className="font-heading text-h3 text-ink-navy">
              {strings.dashboard.ordersTitle}
            </h2>

            {loading ? (
              <div className="mt-3 space-y-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-28 animate-pulse rounded-card bg-mist-navy/60"
                  />
                ))}
              </div>
            ) : error ? (
              <div
                role="alert"
                className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 text-body text-error-text shadow-card"
              >
                {strings.dashboard.loadError} {error}
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void loadOrders(page)}
                >
                  {strings.dashboard.retry}
                </Button>
              </div>
            ) : orders.length === 0 ? (
              <div className="mt-3 rounded-card border border-hairline bg-chalk-white p-6 text-center shadow-card">
                <p className="text-body text-ink/85">{strings.dashboard.empty}</p>
                <Button className="mt-4" onClick={() => router.push("/style")}>
                  {strings.dashboard.startDesign}
                </Button>
              </div>
            ) : (
              <>
                <ul className="mt-3 space-y-3">
                  {orders.map((order) => {
                    const visit = slotVisitLabel(order.slot);
                    // Collapse runs of the same garment into "Blouse ×2" chips.
                    const garmentChips = order.garments.reduce<
                      { label: string; count: number }[]
                    >((acc, label) => {
                      const last = acc[acc.length - 1];
                      if (last && last.label === label) last.count += 1;
                      else acc.push({ label, count: 1 });
                      return acc;
                    }, []);
                    return (
                      <li
                        key={order.id}
                        className="relative rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
                      >
                        {/* The whole card opens the order page; the stretched
                            link sits under the Re-order button (z-10). */}
                        <Link
                          href={`/app/orders/${order.id}`}
                          className="after:absolute after:inset-0 after:content-['']"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <MonoNumber className="font-semibold text-ink-navy">
                              {displayOrderNumber(order.order_number, order.id)}
                            </MonoNumber>
                            <span className="flex items-center gap-0.5 text-caption text-muted">
                              {formatDate(order.created_at)}
                              <ChevronRight size={14} />
                            </span>
                          </div>
                        </Link>

                        {garmentChips.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {garmentChips.map((chip) => (
                              <span
                                key={chip.label}
                                className="rounded-pill bg-mist-navy px-2 py-0.5 text-caption font-medium text-ink-navy"
                              >
                                {chip.label}
                                {chip.count > 1 ? ` ×${chip.count}` : ""}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="mt-2.5">
                          <OrderStatusPills
                            fulfillmentStatus={order.fulfillment_status}
                            paymentStatus={order.payment_status}
                          />
                        </div>

                        {visit && (
                          <div className="mt-3 flex items-start gap-2 rounded-card bg-mist-navy/50 p-3">
                            <Calendar size={16} className="mt-0.5 text-accent-text" />
                            <p className="flex-1 text-body text-ink">
                              <span className="text-caption text-muted">Visit — </span>
                              {visit}
                            </p>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="font-heading text-h3 text-ink-navy">
                            {order.total_price != null
                              ? formatPrice(order.total_price)
                              : ""}
                          </p>
                          {order.library_id && (
                            <Button
                              variant="secondary"
                              className="relative z-10"
                              loading={reorderId === order.id}
                              onClick={() => void handleReorder(order)}
                            >
                              {strings.dashboard.reorder}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <Button
                      variant="secondary"
                      disabled={page <= 1}
                      onClick={() => void loadOrders(page - 1)}
                    >
                      ←
                    </Button>
                    <span className="text-caption text-muted">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={page >= totalPages}
                      onClick={() => void loadOrders(page + 1)}
                    >
                      →
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-caption text-muted">
            <Sparkle size={14} />
            Welcome to the Stitch Club
          </p>
        </>
      )}
    </ScreenShell>
  );
}
