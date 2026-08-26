"use client";

/**
 * TapeProgress — the measuring-tape header on the checkout screens
 * (review → contact → schedule → pay).
 *
 * The /design step ticks are gone (that flow moved to /myod), so the tape
 * renders as a single fully-filled gradient line with just a back chevron.
 *
 * Brand Book §1: the rivet terminates lines.
 */

import { useRouter } from "next/navigation";

import { ArrowLeft } from "@/components/ui/icons";
import { strings } from "@/lib/strings";

export function TapeProgress() {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-warm-sand/95 backdrop-blur">
      <div className="column flex h-14 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => router.back()}
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

          {/* Gradient fill — the tape as a terminal rivet-ended line */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-2 right-2 top-1/2 h-[3px] -translate-y-1/2 rounded-pill bg-tape"
          />
        </div>
      </div>
    </header>
  );
}
