"use client";

/**
 * InstallPrompt — "Download the app" popup on persona home + login pages.
 *
 * Chrome/Chromium fires `beforeinstallprompt` once the PWA is installable;
 * we defer that event and offer a one-tap install from the popup. Tapping
 * Install shows the native install sheet and adds the WebAPK to the home
 * screen. iOS Safari never fires the event, so the popup never appears
 * there — no iOS tutorial is shown (intentional; ask if that changes).
 *
 * Frequency: at most once per browser session, ~1.2s after landing on a
 * qualifying page. Dismissing (Install-less close) hides it for 3 days;
 * a completed install hides it forever. Never shown when already running
 * as the installed app.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { BottomSheet } from "@/components/ui/BottomSheet";

/** Chrome-only API — not in the TS DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Popup shows on each persona's home + login pages (product decision:
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
const DISMISSED_KEY = "draep-install-dismissed-at";
const SHOWN_KEY = "draep-install-shown";
const DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 1200;

function isTriggerPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return TRIGGER_PATHS.has(pathname);
}

function isRunningAsInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const standalone =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || standalone;
}

export function InstallPrompt() {
  const pathname = usePathname();
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Capture (and re-capture on refire) the deferred install prompt.
  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setHasPrompt(true);
    };
    const onInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, "1");
      setOpen(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Design preview: append ?preview=install to any URL to see the sheet
  // without waiting for Chrome's install event (Install tap is a no-op then).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") === "install") setOpen(true);
  }, []);

  // Decide whether to show, once per session, on qualifying pages.
  useEffect(() => {
    if (!hasPrompt || !isTriggerPath(pathname)) return;
    if (isRunningAsInstalledApp()) return;
    if (localStorage.getItem(INSTALLED_KEY)) return;
    if (sessionStorage.getItem(SHOWN_KEY)) return;
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) return;

    const t = window.setTimeout(() => {
      sessionStorage.setItem(SHOWN_KEY, "1");
      setOpen(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [hasPrompt, pathname]);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setOpen(false);
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
      }
    } finally {
      deferredRef.current = null;
      setHasPrompt(false);
      setInstalling(false);
      setOpen(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={dismiss}
      title="Get the Draep app"
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={dismiss}
            disabled={installing}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy transition disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={install}
            disabled={installing}
            className="tap flex-1 rounded-pill bg-tape px-4 py-3 font-heading font-semibold text-chalk-white shadow-primary transition disabled:opacity-50"
          >
            {installing ? "Installing…" : "Install app"}
          </button>
        </div>
      }
    >
      <p className="pb-3 text-body text-ink">
        It works like a regular app and stays fast even on weak networks.
      </p>
    </BottomSheet>
  );
}
