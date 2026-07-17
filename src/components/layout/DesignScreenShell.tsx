"use client";

/**
 * DesignScreenShell — the shared layout for every /design/* screen (spec §6 intro).
 *
 * Tape progress header → sticky BlousePreview (stays pinned under the tape
 * and smoothly shrinks to a compact strip as the user scrolls, so the preview
 * is always visible without eating option-list space) → H1 → selectors →
 * contextual `Style it up` card → sticky PriceBar.
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
import type { BookingDraft } from "@/types/booking";

interface DesignScreenShellProps {
  draft: BookingDraft;
  route: string;
  title: string;
  activeLayerPrefix?: string | null;
  children: React.ReactNode;
  ctaLabel?: string;
}

// How far the user scrolls before the preview finishes collapsing.
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

  // Collapse the preview smoothly as the user scrolls past it.
  // The preview stays sticky under the TapeProgress header but shrinks
  // (height + scale) so it remains visible without covering content.
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
        {/* Sticky preview wrapper — sits directly under the tape progress
            header and smoothly shrinks on scroll instead of being replaced
            by a separate translucent top bar. */}
        <div
          className="sticky top-14 z-20 -mx-4 mb-1 bg-chalk-white px-4 pb-3 pt-1 transition-[padding,box-shadow] duration-300 ease-brand"
          style={{
            boxShadow: collapsed ? "var(--shadow-brand)" : "none",
          }}
        >
          <div
            className={
              "mx-auto origin-top transition-all duration-300 ease-brand " +
              (collapsed ? "max-w-[140px]" : "max-w-full")
            }
            style={{
              transform: collapsed ? "scale(0.5)" : "scale(1)",
            }}
          >
            <BlousePreview
              draft={draft}
              route={route}
              pendingLayerId={pendingLayerId}
              activeLayerPrefix={activeLayerPrefix}
              className="w-full"
            />
          </div>
        </div>

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
