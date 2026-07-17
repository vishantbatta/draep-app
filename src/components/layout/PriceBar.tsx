"use client";

/**
 * PriceBar — sticky bottom bar on all /design/* screens + /review (spec §5.3).
 *
 * - White background, top divider in Tape Silver, single shadow.
 * - Left: Total ₹—— in IBM Plex Mono with Tick animation on change.
 *   Caption "incl. add-ons". Tap to open the bottom-sheet price breakdown.
 * - Right: primary pill button — Next on design screens, Continue on Review.
 *
 * Tick (200ms stepped) animates the amount changes — Brand Book §7.
 */

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { ChevronDown } from "@/components/ui/icons";
import { PriceBreakdown } from "@/components/review/PriceBreakdown";
import { computePrice, formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { nextRouteAfter } from "@/lib/routing";
import { track } from "@/lib/analytics";
import type { BookingDraft } from "@/types/booking";

interface PriceBarProps {
  draft: BookingDraft;
  currentRoute: string;
  ctaLabel?: string;
}

export function PriceBar({ draft, currentRoute, ctaLabel }: PriceBarProps) {
  const router = useRouter();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [navigating, startTransition] = useTransition();
  const price = computePrice(draft);

  const next = nextRouteAfter(currentRoute);
  const label = ctaLabel ?? (next === "/review" ? "Review" : "Next");

  // Prefetch the next route so the tap is instant.
  useEffect(() => {
    if (next) router.prefetch(next);
  }, [next, router]);

  const goNext = () => {
    if (!next) return;
    if (next === "/review") track({ event: "review_viewed" });
    startTransition(() => {
      router.push(next);
    });
  };

  return (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-chalk-white"
        style={{ boxShadow: "var(--shadow-brand)" }}
      >
        <div
          className="absolute left-0 right-0 top-0 h-px"
          style={{ background: "var(--tape-silver)" }}
          aria-hidden
        />
        <div className="column flex items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setBreakdownOpen(true)}
            className="flex flex-col items-start gap-0.5 text-left"
            aria-label={`${strings.priceBar.total}: ${formatPrice(price.total)} ${strings.priceBar.inclAddons}`}
          >
            <span className="flex items-center gap-1 text-caption text-ink-navy/70">
              {strings.priceBar.total}
              <ChevronDown size={12} strokeWidth={2.25} />
            </span>
            <span className="flex items-baseline gap-1">
              <AnimatedAmount amount={price.total} />
              <span className="text-caption text-ink-navy/60">
                {strings.priceBar.inclAddons}
              </span>
            </span>
          </button>
          <Button onClick={goNext} loading={navigating} className="min-w-[120px]">
            {label}
          </Button>
        </div>
      </div>

      <BottomSheet
        open={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        title={strings.priceBar.breakdownTitle}
      >
        <PriceBreakdown draft={draft} />
      </BottomSheet>
    </>
  );
}

/**
 * AnimatedAmount — Tick (200ms stepped) on change.
 * Each digit slot swaps via AnimatePresence for the "counting" effect.
 */
function AnimatedAmount({ amount }: { amount: number }) {
  const formatted = formatPrice(amount);
  return (
    <MonoNumber className="text-h1 font-medium text-ink-navy" aria-live="polite">
      <motion.span
        key={formatted}
        initial={{ y: -6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="inline-block"
      >
        {formatted}
      </motion.span>
    </MonoNumber>
  );
}
