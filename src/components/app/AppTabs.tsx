"use client";

/**
 * The customer home tab shell, mounted by the /app/(tabs) route-group layout.
 *
 * Each tab is a real URL so they're deeplinkable:
 *
 *   /app/explore  → the design library for blouses (LibraryBrowser, shared
 *                   with the standalone /library page).
 *   /app/create   → the MYOD launch pad — hands off to the full-screen
 *                   configurator at /myod/blouse.
 *   /app/profile  → the account dashboard as-is (audit C2/C3): greeting +
 *                   profile, inline login, order history with status,
 *                   invoices and one-tap re-order from the design library.
 *
 * /app itself redirects to /app/explore. The active tab comes from the
 * pathname; the three panes live HERE (in the layout, above the routed
 * pages) and mount on first visit, staying mounted-but-hidden afterwards —
 * so in-progress work (an MYOD configuration, library scroll position)
 * survives switching, which plain route changes alone would not preserve.
 *
 * Auth (Profile tab): reuses the customer session from the auth store
 * (anonymous → OTP upgrade). Anonymous visitors get an inline phone+OTP card
 * instead of a redirect — the booking flow's /otp page is step-scoped with no
 * return-to. OTP goes through the MSG91 widget (lib/msg91.ts) when configured;
 * the legacy test-mode endpoints are the fallback.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";

import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { MyodSheet, type HostedStep } from "@/components/myod/MyodSheet";
import { OrderStatusPills } from "@/components/order/OrderStatus";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { MonoNumber } from "@/components/ui/MonoNumber";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronRight,
  Scissors,
  ShieldCheck,
  Sparkle,
  Sparkles,
  Thread,
  User,
} from "@/components/ui/icons";
import { ordersApi } from "@/lib/api";
import { track } from "@/lib/analytics";
import { useAuthHydrated, useAuthStore } from "@/lib/auth-store";
import { normalizePhoneInput } from "@/lib/phone";
import { msg91Enabled, otpLength, sendOtpViaMsg91, verifyOtpViaMsg91 } from "@/lib/msg91";
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

/* ============================================================ */

/** The three bottom tabs — each one a real path under /app. */
type AppTab = "explore" | "create" | "profile";

const TAB_PATHS: Record<AppTab, string> = {
  explore: "/app/explore",
  create: "/app/create",
  profile: "/app/profile",
};

function tabFromPathname(pathname: string): AppTab {
  if (pathname.startsWith("/app/create")) return "create";
  if (pathname.startsWith("/app/profile")) return "profile";
  return "explore";
}

/**
 * Height of the bottom tab bar (1px hairline border + 52px tab buttons +
 * 2×8px bar padding + safe-area inset). Lifts MyodSheet's fixed step CTA
 * above the bar inside the Create tab.
 */
const TAB_BAR_INSET = "calc(69px + env(safe-area-inset-bottom))";

export function AppTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const active = tabFromPathname(pathname);

  // Tabs mount on first visit and stay mounted (hidden, not unmounted) so
  // in-progress work — an MYOD configuration, library scroll position —
  // survives switching between them. The URL is the source of truth for
  // which pane is visible (back/forward included); visited only gates each
  // pane's first mount.
  const [visited, setVisited] = useState<AppTab[]>([active]);

  useEffect(() => {
    setVisited((prev) => (prev.includes(active) ? prev : [...prev, active]));
  }, [active]);

  const select = useCallback(
    (next: AppTab) => {
      router.push(TAB_PATHS[next]);
    },
    [router],
  );

  return (
    <div className="flex h-dvh w-full flex-col">
      {/* Tab content — each tab owns its own scrolling. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {visited.includes("explore") && (
          <div className={active === "explore" ? "h-full" : "hidden"}>
            <LibraryBrowser />
          </div>
        )}
        {visited.includes("create") && (
          <div className={active === "create" ? "h-full" : "hidden"}>
            <CreateTab />
          </div>
        )}
        {visited.includes("profile") && (
          <div className={active === "profile" ? "h-full" : "hidden"}>
            <ProfileTab />
          </div>
        )}
      </div>

      <BottomTabBar tab={active} onChange={select} />
    </div>
  );
}

/* ============================================================ */
/*  Bottom tab bar                                               */
/* ============================================================ */

/**
 * Three-section bottom navigation — quiet chrome, one brand moment.
 *
 * A chalk surface with a hairline top edge sits under every tab; the tabs
 * themselves are icon-over-label with no backgrounds, so nothing competes
 * for the eye. The active tab carries the only color: a tape-gradient
 * circular well behind its icon (Brand Book §4 — orange as the spice, a
 * small area on a light surface, never flattened) with the ember CTA glow.
 * Inactive tabs use the Brand Book secondary text color and lift to full
 * ink with a mist-navy wash while pressed.
 */
function BottomTabBar({
  tab,
  onChange,
}: {
  tab: AppTab;
  onChange: (tab: AppTab) => void;
}) {
  const items: { id: AppTab; label: string; icon: ReactNode }[] = [
    { id: "explore", label: strings.appTabs.explore, icon: <Sparkles size={17} /> },
    { id: "create", label: strings.appTabs.create, icon: <Scissors size={17} /> },
    { id: "profile", label: strings.appTabs.profile, icon: <User size={17} /> },
  ];

  return (
    <nav
      role="tablist"
      aria-label={strings.appTabs.navLabel}
      className="mx-auto w-full max-w-column flex-none border-t border-hairline-strong bg-chalk-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_20px_-14px_rgba(8,48,104,0.25)]"
    >
      <div className="grid grid-cols-3 gap-1 px-2 py-2">
        {items.map((it) => {
          const active = tab === it.id;
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(it.id)}
              className="group flex h-[52px] flex-col items-center justify-center gap-[3px] rounded-2xl transition-transform duration-200 ease-brand active:scale-[0.96]"
            >
              <span
                aria-hidden
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ease-brand ${
                  active
                    ? "bg-tape text-chalk-white shadow-primary"
                    : "text-muted group-active:bg-mist-navy group-active:text-ink-navy"
                }`}
              >
                {it.icon}
              </span>
              <span
                className={`text-[11px] leading-none transition-colors duration-200 ease-brand ${
                  active
                    ? "font-semibold text-ink-navy"
                    : "font-medium text-muted group-active:text-ink-navy"
                }`}
              >
                {it.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ============================================================ */
/*  Create tab — the MYOD configurator                           */
/* ============================================================ */

/**
 * The full MYOD flow lives in this tab. Same shape as the standalone
 * /myod/[garment_id] page (slim navy header + scrollable configurator),
 * minus the back button — the tab bar handles navigation. MyodSheet's fixed
 * step-CTA is lifted above the tab bar via footerInset; its completion
 * takeover still covers the whole viewport by design.
 */
function CreateTab() {
  // Mounting the configurator is "opening" MYOD as far as the funnel is
  // concerned — the old launch-pad CTA carried this event.
  useEffect(() => {
    track({ event: "myod_opened", source: "app_create_tab" });
  }, []);

  // Step-back action reported by the configurator. While set, the header
  // shows it in place of the scissors badge; the configurator hides its
  // own in-flow Back pill. Boxed in an object on purpose: a bare function
  // passed to setState would be INVOKED as a state updater (reverting the
  // step it belongs to) — an object is stored as-is.
  const [headerBack, setHeaderBack] = useState<{ back: (() => void) | null }>({
    back: null,
  });
  const handleBackChange = useCallback((back: (() => void) | null) => {
    setHeaderBack({ back });
  }, []);

  // Active step reported by the configurator — the header mirrors it
  // ("STEP n / m" eyebrow + step title) instead of static branding. Null
  // (tree loading / after completion) falls back to the MYOD title.
  const [headerStep, setHeaderStep] = useState<HostedStep | null>(null);
  const handleStepChange = useCallback((step: HostedStep | null) => {
    setHeaderStep(step);
  }, []);

  return (
    <div className="column flex h-full flex-col bg-warm-sand">
      {/* Navy header that doubles as the step banner — the badge/back row
          sits above the component name + its catalogue description, so the
          top nav IS the "choose your …" section (no separate body card). */}
      <header className="relative flex flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white">
        <div
          className={
            "relative z-10 flex flex-col gap-3 px-4 " +
            (headerStep?.description ? "py-6" : "py-3")
          }
        >
          <div className="flex items-center justify-between gap-3">
            {headerBack.back ? (
              <button
                type="button"
                onClick={headerBack.back}
                className="flex flex-none items-center gap-1 rounded-pill px-1 py-1.5 text-caption font-medium text-chalk-white transition-opacity ease-brand active:opacity-70"
              >
                <ArrowLeft size={14} />
                <span>Back</span>
              </button>
            ) : (
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-chalk-white shadow-[0_1px_2px_rgba(208,96,16,0.3)]"
                style={{ backgroundImage: "var(--tape-gradient)" }}
              >
                <Scissors size={18} />
              </span>
            )}
            <span className="font-mono text-caption font-medium uppercase tracking-[0.18em] text-chalk-white/80">
              {headerStep ? `Step ${headerStep.index + 1} / ${headerStep.total}` : "MYOD"}
            </span>
          </div>
          {/* Component photo left, name + description right — the banner
              mirrors the catalogue card for the step's component. */}
          <div className="flex items-center gap-3.5">
            {headerStep?.image ? (
              <img
                src={headerStep.image}
                alt=""
                aria-hidden
                className="h-20 w-20 flex-none rounded-card border border-chalk-white/15 bg-mist-navy object-cover shadow-card"
              />
            ) : null}
            <div className="min-w-0">
              <h2 className="font-heading text-h1 font-semibold leading-tight text-chalk-white">
                {headerStep?.title ?? strings.myod.sheetTitle}
              </h2>
              {headerStep?.description && (
                <HeaderDescription text={headerStep.description} />
              )}
            </div>
          </div>
        </div>
        {/* Tape-gradient seam (Brand Book §6) */}
        <div aria-hidden className="lp-tape-strip absolute inset-x-0 bottom-0 z-10" />
      </header>

      {/* Body: the configurator */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        <MyodSheet
          footerInset={TAB_BAR_INSET}
          onBackChange={handleBackChange}
          onStepChange={handleStepChange}
        />
      </div>
    </div>
  );
}

function HeaderDescription({ text }: { text?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);

  // Reset when the step (text) changes, then measure after paint.
  useEffect(() => {
    setExpanded(false);
  }, [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure the UNCLAMPED height (inline style beats the line-clamp-2
    // class), then restore the clamp and compare against the clamped box.
    el.style.webkitLineClamp = "unset";
    const full = el.scrollHeight;
    el.style.webkitLineClamp = "";
    const clamped = el.clientHeight;
    setOverflows(full > clamped + 1);
  }, [text]);

  if (!text) return null;
  return (
    <div>
      <p
        ref={ref}
        className={
          "max-w-[340px] text-caption leading-relaxed text-chalk-white/85 " +
          (expanded ? "" : "line-clamp-2")
        }
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 font-mono text-caption font-medium uppercase tracking-[0.14em] text-chalk-white underline decoration-chalk-white/40 underline-offset-4 transition-opacity ease-brand active:opacity-70"
        >
          {expanded ? "Read less" : "Read more"}
        </button>
      )}
    </div>
  );
}

/* ============================================================ */
/*  Profile tab — the account dashboard (as-is)                   */
/* ============================================================ */

function ProfileTab() {
  const router = useRouter();
  const hydrated = useAuthHydrated();
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);
  // Hidden along with the active-draft banner below.
  // const activeOrderId = useAuthStore((s) => s.activeOrderId);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const verifyOtpWidget = useAuthStore((s) => s.verifyOtpWidget);
  const updateProfile = useAuthStore((s) => s.updateProfile);

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
      // The OTP field mounts on this state flip — focus it after commit.
      window.setTimeout(() => document.getElementById("dash-otp")?.focus(), 0);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setLoginBusy(false);
    }
  };

  // Auto-send the moment the typed number becomes a valid 10-digit mobile
  // (the card then morphs into the OTP entry — that swap is the once-guard).
  // Fires on paste/autofill too, since normalization lands in one change.
  // The button stays for retries after a failed send or a re-edited number.
  useEffect(() => {
    if (/^[6-9]\d{9}$/.test(phone) && !otpSent && !loginBusy) {
      void handleSendOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, otpSent]);

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

  /* ── Skeleton while the persisted session rehydrates ─────────────────── */
  if (!hydrated) {
    return (
      <div className="column flex h-full items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
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
            className="flex h-11 w-11 flex-none items-center justify-center rounded-pill text-ink-navy transition-all ease-brand active:scale-95 active:bg-mist-navy"
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
                    onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
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
          {/* Active draft banner — hidden for now, re-enable by uncommenting
              (and the activeOrderId selector near the top of the component).
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
          */}

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
                        {/* The whole card opens the order page via the
                            stretched link. */}
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
    </div>
  );
}
