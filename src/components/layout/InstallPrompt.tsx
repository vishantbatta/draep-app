"use client";

/**
 * InstallPrompt — store-style install card (app icon, name, tagline, CTA —
 * like the native App Store / Play Store prompt) above the persona home +
 * login pages. Banner and page share one h-dvh flex column: the page
 * contracts to the space left under the banner instead of being pushed past
 * the fold (full-height shells like the /app tab shell use h-full and shrink
 * to fit; long scrolling pages simply start below it).
 *
 * Chrome/Chromium fires `beforeinstallprompt` once the PWA is installable;
 * we defer that event and the banner's Install button offers a one-tap
 * install (WebAPK to the home screen on Android). iOS Safari never fires
 * the event, so the banner never appears there — intentional.
 *
 * The banner shows on every qualifying page view until installed. The cross
 * hides it for the current browser session only. A completed install hides
 * it forever, and it never shows when already running as the installed app.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

// Banner shows on each persona's home + login pages (product decision:
// right after login / on the dashboard they land on). Exact matches only —
// deeper work screens (e.g. the SC measure flow) never trigger it.
const TRIGGER_PATHS = new Set([
  "/admin/orders",
  "/admin/login",
  "/style_captain_dashboard",
  "/style_captain_dashboard/login",
  "/app",
]);

const INSTALLED_KEY = "draep-install-installed";
const HIDDEN_KEY = "draep-install-banner-hidden";

/** Chrome-only API — not in the TS DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isTriggerPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return TRIGGER_PATHS.has(pathname);
}

// Chrome fires `beforeinstallprompt` only once per navigation and may fire it
// before React hydration runs — a listener attached inside useEffect would
// miss it forever, leaving the banner unable to show naturally. Capture it
// from module scope (the moment this chunk executes) so the component can
// claim it on mount.
let earlyPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    earlyPrompt = e as BeforeInstallPromptEvent;
  });
}

export function InstallPrompt({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [preview, setPreview] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [hiddenThisSession, setHiddenThisSession] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Read persisted state once on mount.
  useEffect(() => {
    setInstalled(Boolean(localStorage.getItem(INSTALLED_KEY)));
    setHiddenThisSession(Boolean(sessionStorage.getItem(HIDDEN_KEY)));
    const standalone =
      typeof navigator !== "undefined" &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches || standalone,
    );
  }, []);

  // Design preview: append ?preview=install to any URL to see the banner
  // without waiting for Chrome's install event (Install tap is a no-op then).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") === "install") setPreview(true);
  }, []);

  // Capture (and re-capture on refire) the deferred install prompt. If Chrome
  // already fired it before hydration, claim the module-scope copy instead.
  useEffect(() => {
    if (earlyPrompt) {
      deferredRef.current = earlyPrompt;
      setCanInstall(true);
    }
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, "1");
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // The cross wins in every mode — including ?preview=install, where it would
  // otherwise be a no-op because `preview` forces the banner visible.
  const visible =
    !hiddenThisSession &&
    (preview ||
      (canInstall && isTriggerPath(pathname) && !installed && !standalone));

  const dismiss = () => {
    sessionStorage.setItem(HIDDEN_KEY, "1");
    setHiddenThisSession(true);
  };

  const install = async () => {
    const ev = deferredRef.current;
    if (!ev || installing) return;
    setInstalling(true);
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      if (choice.outcome === "accepted") {
        localStorage.setItem(INSTALLED_KEY, "1");
        setInstalled(true);
      }
    } finally {
      deferredRef.current = null;
      setCanInstall(false);
      setInstalling(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      {/* Enter-only animation, no AnimatePresence exit: its exit retention
          never resolves in this app, so a dismissed banner would linger
          invisibly and keep contracting the page below it. Unmounting
          instantly on dismiss hands the space straight back. */}
      {visible && (
        <motion.div
          className="w-full flex-none px-3 pt-3"
          initial={{ y: -16, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Store-style install card. Brand Book: chalk-white card on 12px
                radius (rounded-xl) with the single navy@8% elevation; tape
                gradient stays reserved for the CTA. Centered max-w-sm card,
                not edge-to-edge. */}
          <div className="mx-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-mist-navy bg-chalk-white px-3 py-3 shadow-brand">
            {/* Rounded-square app-icon tile, like an OS icon on a store
                  card. The logo is a transparent emblem (not full-bleed), so
                  it sits on Warm Sand inside the tile. */}
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[12px] bg-warm-sand ring-1 ring-mist-navy">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo_alpha_icon.png"
                alt=""
                className="h-9 w-9 object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-sm font-semibold leading-tight text-ink-navy">
                Draep
              </p>
              <p className="text-caption leading-snug text-ink-navy/60">
                Install the app for uninterrupted access
              </p>
            </div>
            <button
              type="button"
              onClick={install}
              disabled={installing}
              className="tap shrink-0 rounded-pill bg-tape px-4 py-2 text-caption font-heading font-semibold text-chalk-white shadow-primary transition disabled:opacity-50"
            >
              {installing ? "Installing…" : "Install"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              disabled={installing}
              className="tap shrink-0 rounded-full p-1.5 text-ink-navy/40 transition hover:text-ink-navy disabled:opacity-50"
            >
              <svg
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                aria-hidden
              >
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
      {/* The page lives in the space left under the banner, so h-full shells
          contract instead of being pushed off-screen. */}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
