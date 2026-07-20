"use client";

/**
 * DesignScreenShell — the shared layout for every /design/* screen (spec §6 intro).
 *
 * Tape progress header → BlousePreview (collapses to a small sticky chip on
 * scroll) → H1 → selectors → contextual `Style it up` card → sticky PriceBar.
 *
 * Page-local state for ghost-preview (`pendingLayerId`) lives here so the
 * BlousePreview and selectors share one source without prop-drilling through
 * the page boundary.
 *
 * Scroll behavior note: the in-flow preview uses `visibility: hidden` (not
 * `display: none`) when collapsed so the document height does NOT change
 * mid-scroll. Changing real height would create a feedback loop:
 *   scroll → height shrinks → document shorter → scrollY drops below
 *   threshold → height expands → document taller → scrollY back over
 *   threshold → repeat = pulsating/vibrating.
 *
 * The collapsed state renders a separate fixed-position mini chip that floats
 * under the TapeProgress header. Because that chip is `position: fixed` it
 * participates in no flow and cannot affect scrollY.
 */

import { useEffect, useState } from "react";

import { TapeProgress } from "@/components/layout/TapeProgress";
import { PriceBar } from "@/components/layout/PriceBar";
import { BlousePreview } from "@/components/preview/BlousePreview";
import { ScreenShell } from "@/components/layout/ScreenShell";
import type { BookingDraft } from "@/types/booking";

interface DesignScreenShellProps {
  draft: BookingDraft;
  route: string;
  title: string;
  activeLayerPrefix?: string | null;
  children: React.ReactNode;
  ctaLabel?: string;
}

// How far the user scrolls before the preview collapses.
const COLLAPSE_THRESHOLD = 220;

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

  return (
    <>
      <TapeProgress currentRoute={route} />

      <ScreenShell hasPriceBar className="pt-4">
        {/* In-flow preview. Uses `visibility: hidden` when collapsed so the
            element keeps reserving its layout box — document height stays
            constant, which prevents the scroll feedback loop. */}
        <div className={collapsed ? "invisible w-full" : "w-full"}>
          <BlousePreview
            draft={draft}
            route={route}
            pendingLayerId={pendingLayerId}
            activeLayerPrefix={activeLayerPrefix}
            className="w-full"
          />
        </div>

        {/* Collapsed mini-preview — `position: fixed` so it sits out of
            normal flow and cannot influence scrollY. Renders a small blouse
            thumbnail anchored under the TapeProgress header. */}
        {collapsed && (
          <div
            className="fixed left-0 right-0 top-14 z-20 border-b border-hairline bg-warm-sand/95 backdrop-blur"
            aria-hidden
          >
            <div className="column flex h-16 items-center gap-3 px-4">
              <div className="h-12 w-12 flex-none overflow-hidden rounded-card bg-warm-sand">
                <div className="origin-top-left scale-[0.18]">
                  <BlousePreview
                    draft={draft}
                    route={route}
                    pendingLayerId={pendingLayerId}
                    activeLayerPrefix={activeLayerPrefix}
                    className="w-[260px]"
                  />
                </div>
              </div>
              <div className="flex-1">
                <p className="font-heading text-h3 font-semibold text-ink-navy">
                  {title}
                </p>
              </div>
              {/* Rivet terminator */}
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-draep-orange" />
            </div>
          </div>
        )}

        <div className="mt-3">
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
