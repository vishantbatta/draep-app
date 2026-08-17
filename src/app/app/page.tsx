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
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { OrderStatusPills } from "@/components/order/OrderStatus";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { Calendar, ChevronRight, Sparkle, Thread } from "@/components/ui/icons";
import { libraryApi, ordersApi } from "@/lib/api";
import { useAuthHydrated, useAuthStore } from "@/lib/auth-store";
import { useBookingStore } from "@/lib/booking-store";
import { displayOrderNumber, formatDate, slotVisitLabel } from "@/lib/order-display";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import type { OrderListItem } from "@/types/api";

/* ============================================================ */

export default function AppDashboardPage() {
  const router = useRouter();
  const hydrated = useAuthHydrated();
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);
  const activeOrderId = useAuthStore((s) => s.activeOrderId);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const logout = useAuthStore((s) => s.logout);
  const hydrateFromLibraryOrder = useBookingStore((s) => s.hydrateFromLibraryOrder);

  const isLoggedIn = sessionType === "user";

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
    if (hydrated && isLoggedIn) {
      void loadOrders(1);
    } else if (hydrated) {
      setOrders([]);
      setLoading(false);
    }
  }, [hydrated, isLoggedIn, loadOrders]);

  /* ── Inline login (anonymous → user via OTP) ─────────────────────────── */
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    if (phone.length !== 10) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      await sendOtp(phone);
      setOtpSent(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setLoginBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      await verifyOtp(phone, otp);
      // sessionType flips to "user" in the store → the effect above loads orders.
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setLoginBusy(false);
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

  const handleLogout = async () => {
    await logout();
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
          <button
            onClick={() => void handleLogout()}
            className="rounded-pill px-3 py-1.5 text-caption font-semibold text-navy-interactive underline"
          >
            {strings.dashboard.logout}
          </button>
        )}
      </header>

      {/* Anonymous → inline OTP login card */}
      {!isLoggedIn && (
        <section className="mt-6 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-accent-fill text-chalk-white"
            >
              <Sparkle size={20} />
            </span>
            <div>
              <h2 className="font-heading text-h3 text-ink-navy">
                {strings.dashboard.loginTitle}
              </h2>
              <p className="mt-1 text-body text-ink/85">{strings.dashboard.loginBody}</p>
            </div>
          </div>

          {!otpSent ? (
            <div className="mt-4">
              <label htmlFor="dash-phone" className="text-caption text-muted">
                {strings.dashboard.phoneLabel}
              </label>
              <input
                id="dash-phone"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="98765 43210"
                className="mt-1 w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 font-heading text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none"
              />
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
            <div className="mt-4">
              <label htmlFor="dash-otp" className="text-caption text-muted">
                {strings.dashboard.otpLabel}
              </label>
              <input
                id="dash-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-1 w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 text-center font-mono text-data tracking-[0.4em] text-ink-navy focus:border-navy-interactive focus:outline-none"
              />
              <Button
                fullWidth
                className="mt-3"
                loading={loginBusy}
                disabled={otp.length !== 6}
                onClick={() => void handleVerifyOtp()}
              >
                {strings.dashboard.verify}
              </Button>
            </div>
          )}

          <p className="mt-3 text-center text-caption text-muted">
            {strings.dashboard.demoHint}
          </p>
          {loginError && (
            <p className="mt-2 text-center text-caption text-error-text" role="alert">
              {loginError}
            </p>
          )}
        </section>
      )}

      {isLoggedIn && (
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
