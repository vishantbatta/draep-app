"use client";

/**
 * DesignScreenShell — the shared layout for every /design/* screen (spec §6 intro).
 *
 * Tape progress header → BlousePreview (collapsing on scroll to 64px strip)
 * → H1 → selectors → contextual `Style it up` card → sticky PriceBar.
 *
 * Page-local state for ghost-preview (`pendingLayerId`) lives here so the
 * BlousePreview and selectors share one source without prop-drilling through
 * the page boundary.
 */

import { useEffect, useState } from "react";

import { TapeProgress } from "@/components/layout/TapeProgress";
import { PriceBar } from "@/components/layout/PriceBar";
import { BlousePreview } from "@/components/preview/BlousePreview";
import { ScreenShell } from "@/components/layout/ScreenShell";
import {
  BodyFront,
  Neck,
  Plus,
  Ruler,
  Scissors,
  Thread,
} from "@/components/ui/icons";
import type { BookingDraft } from "@/types/booking";

interface DesignScreenShellProps {
  draft: BookingDraft;
  route: string;
  title: string;
  activeLayerPrefix?: string | null;
  children: React.ReactNode;
  ctaLabel?: string;
}

// How far the user scrolls before the preview collapses to the 64px strip.
const COLLAPSE_THRESHOLD = 220;

const ROUTE_ICON: Record<string, React.FC<{ size?: number }>> = {
  "/design/cut": Scissors,
  "/design/length": Ruler,
  "/design/front-neck": Neck,
  "/design/back": Neck,
  "/design/tying": Thread,
  "/design/fit": BodyFront,
  "/design/add-ons": Plus,
};

export function DesignScreenShell({
  draft,
  route,
  title,
  activeLayerPrefix,
  children,
  ctaLabel,
}: DesignScreenShellProps) {
  const [pendingLayerId, setPendingLayerId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Collapse the preview to a 64px strip when scrolled past it (spec §5.5).
  // Using window.scrollY directly. The preview uses `invisible` (not `hidden`)
  // when collapsed so it still occupies its layout space — this prevents the
  // document height from changing mid-scroll and causing vibration.
  useEffect(() => {
    let ticking = false;
    const handler = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setCollapsed(window.scrollY > COLLAPSE_THRESHOLD);
        ticking = false;
      });
    };
    window.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    handler();
    return () => {
      window.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

  const Icon = ROUTE_ICON[route] ?? Ruler;

  return (
    <>
      <TapeProgress currentRoute={route} />

      <ScreenShell hasPriceBar className="pt-4">
        <div>
          <BlousePreview
            draft={draft}
            route={route}
            pendingLayerId={pendingLayerId}
            activeLayerPrefix={activeLayerPrefix}
            className={collapsed ? "invisible w-full" : "w-full"}
          />
          {/* Collapsed strip when scrolled past preview */}
          {collapsed && (
            <div className="fixed left-0 right-0 top-14 z-20 border-b border-tape-silver bg-chalk-white/95 backdrop-blur">
              <div className="column flex h-16 items-center gap-3 px-4">
                <span
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-orange-fill text-draep-orange"
                  aria-hidden
                >
                  <Icon size={18} />
                </span>
                <div className="flex-1">
                  <p className="font-heading text-h3 font-semibold text-ink-navy">{title}</p>
                </div>
                {/* Rivet terminator */}
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-draep-orange" />
              </div>
            </div>
          )}
        </div>

        <div className="mt-5">
          <h1 className="font-heading text-h1 text-ink-navy">
            {title}
          </h1>
        </div>

        <div className="mt-4">
          <PreviewContextProvider value={setPendingLayerId}>
            {children}
          </PreviewContextProvider>
        </div>
      </ScreenShell>

      <PriceBar draft={draft} currentRoute={route} ctaLabel={ctaLabel} />
    </>
  );
}

/* ---- Tiny context for ghost-preview signaling ---- */

import { createContext, useContext } from "react";

const PreviewContext = createContext<(id: string | null) => void>(() => {});

function PreviewContextProvider({
  value,
  children,
}: {
  value: (id: string | null) => void;
  children: React.ReactNode;
}) {
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreviewSetter() {
  return useContext(PreviewContext);
}
