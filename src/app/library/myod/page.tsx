"use client";

/**
 * /library/myod — Make Your Own Draep (full page).
 *
 * A full-screen page: navy header with a back chevron + MYOD title, and a
 * scrollable body that mounts the MyodSheet configurator directly (not a
 * bottom sheet). The MYOD garment starts as the pre-generated default and is
 * refined as the user makes selections.
 *
 * On "Try it on", the current garment (data URI or default asset URL) is handed
 * to the existing TryOnSheet, which composites it onto a user-uploaded photo.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { MyodSheet } from "@/components/myod/MyodSheet";
import { TryOnSheet } from "@/components/tryon/TryOnSheet";
import { ArrowLeft } from "@/components/ui/icons";

export default function MyodPage() {
  const router = useRouter();

  // Try-on handoff state.
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const [tryOnDesignUrl, setTryOnDesignUrl] = useState<string | null>(null);

  const handleTryItOn = useCallback((garmentImage: string) => {
    setTryOnDesignUrl(garmentImage);
    setTryOnOpen(true);
  }, []);

  const closeTryOn = useCallback(() => {
    setTryOnOpen(false);
    setTimeout(() => setTryOnDesignUrl(null), 250);
  }, []);

  const onTryOnDone = useCallback(() => {
    setTryOnOpen(false);
    setTimeout(() => setTryOnDesignUrl(null), 220);
  }, []);

  return (
    <div className="column flex h-dvh flex-col bg-warm-sand">
      {/* ───── Slim header ───── */}
      <header className="relative flex flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-md"
          style={{ background: "var(--tape-gradient)" }}
        />

        <div className="relative z-10 flex items-center gap-3 px-4 py-4">
          <button
            type="button"
            onClick={() => router.push("/library")}
            aria-label="Back to library"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-chalk-white/25 bg-chalk-white/10 text-chalk-white transition-colors hover:bg-chalk-white/20"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-chalk-white/80">
              MYOD
            </span>
            <h1 className="font-heading text-h3 font-semibold text-chalk-white">
              Make Your Own Draep
            </h1>
          </div>
        </div>

        {/* Tape-gradient seam (Brand Book §6) */}
        <div aria-hidden className="lp-tape-strip absolute inset-x-0 bottom-0 z-10" />
      </header>

      {/* ───── Body: full-page configurator ───── */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        <MyodSheet onTryItOn={handleTryItOn} />
      </div>

      {/* ───── Try-on handoff ───── */}
      {tryOnDesignUrl && (
        <TryOnSheet
          open={tryOnOpen}
          onClose={closeTryOn}
          onDone={onTryOnDone}
          designImageUrl={tryOnDesignUrl}
          designTitle="Your MYOD blouse"
        />
      )}
    </div>
  );
}
