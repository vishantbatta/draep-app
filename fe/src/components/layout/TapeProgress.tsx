"use client";

/**
 * TapeProgress — the horizontal measuring-tape progress header (spec §5.1).
 *
 * - 7 ticks for the design steps
 * - Rivet dot on the current step (Rivet Pulse, 2s)
 * - Tape Gradient fill behind completed ticks (Tape Unroll on advance, 600ms)
 * - Left: back chevron (navy)
 * - Right: step counter in mono "3/7"
 *
 * Geometry: 7 ticks evenly spaced. First tick center at 0%, last at 100%.
 * Gradient fill spans from 0% to the current tick's position.
 *
 * Brand Book §1: ticks are the core graphic motif, the rivet terminates lines.
 * Brand Book §7: Tape Unroll 600ms ease-out, Rivet Pulse 2s.
 */

import { useRouter } from "next/navigation";

import {
  DESIGN_ROUTES,
  TOTAL_DESIGN_STEPS,
  prevRouteBefore,
} from "@/lib/routing";
import { ArrowLeft } from "@/components/ui/icons";
import { strings } from "@/lib/strings";
import { MonoNumber } from "@/components/ui/MonoNumber";

interface TapeProgressProps {
  currentRoute: string;
}

const TICK_COUNT: number = DESIGN_ROUTES.length;

/** Position of tick idx's center along the tape, as a percentage. */
function tickPercent(idx: number): number {
  if (TICK_COUNT <= 1) return 0;
  return (idx / (TICK_COUNT - 1)) * 100;
}

export function TapeProgress({ currentRoute }: TapeProgressProps) {
  const router = useRouter();
  const currentIdx = DESIGN_ROUTES.indexOf(
    currentRoute as (typeof DESIGN_ROUTES)[number],
  );
  const isReview = currentRoute === "/review";

  // For review, we show the tape as fully filled with the last rivet active.
  const effectiveIdx = isReview ? TICK_COUNT - 1 : Math.max(0, currentIdx as number);
  const fillEnd = tickPercent(effectiveIdx);

  const displayStep = isReview ? TOTAL_DESIGN_STEPS : Math.max(1, currentIdx + 1);

  const handleBack = () => {
    if (isReview) {
      router.back();
      return;
    }
    const prev = prevRouteBefore(currentRoute);
    if (prev) router.push(prev);
    else router.push("/");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-warm-sand/95 backdrop-blur">
      <div className="column flex h-14 items-center gap-2 px-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label={strings.tape.back}
          className="tap flex flex-none items-center justify-center rounded-pill text-ink-navy hover:bg-mist-navy"
        >
          <ArrowLeft size={20} strokeWidth={2.25} />
        </button>

        <div className="relative flex-1">
          {/* Track line — 1px tape-silver behind everything */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-tape-silver"
          />

          {/* Gradient fill — spans 0% to current tick position (Tape Unroll) */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-[3px] -translate-y-1/2 rounded-pill bg-tape"
            style={{
              left: 0,
              width: `${fillEnd}%`,
              transition: "width 600ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />

          {/* Ticks — absolutely positioned at their % so they sit on the line */}
          <div className="relative h-6">
            {DESIGN_ROUTES.map((route, idx) => {
              const completed = idx < effectiveIdx;
              const isCurrent = idx === effectiveIdx;
              const percent = tickPercent(idx);

              return (
                <span
                  key={route}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${percent}%` }}
                >
                  <span
                    className={
                      "block h-2 w-2 rounded-full transition-colors duration-500 ease-brand " +
                      (completed || isCurrent
                        ? "bg-draep-orange"
                        : "bg-tape-silver")
                    }
                  />
                  {isCurrent && (
                    <span
                      aria-hidden
                      className="absolute inset-0 -m-1 animate-rivet rounded-full border-2 border-draep-orange/40"
                    />
                  )}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex-none">
          <MonoNumber className="text-data font-medium text-ink-navy">
            {strings.tape.counter(displayStep, TOTAL_DESIGN_STEPS)}
          </MonoNumber>
        </div>
      </div>
    </header>
  );
}
