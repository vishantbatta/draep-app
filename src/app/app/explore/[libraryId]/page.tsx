"use client";

/**
 * /app/explore/[libraryId] — design detail as a FULL PAGE (no tab shell),
 * matching the create-flow pattern: circular back button in the header,
 * detail body, sticky "Try it on / Order now" footer. Replaces the old
 * stacked bottom sheet on the Explore grid.
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { ArrowLeft } from "@/components/ui/icons";
import { LibraryDetailPage } from "@/components/library/LibraryDetailPage";
import { strings } from "@/lib/strings";

export default function LibraryDetailRoute() {
  const router = useRouter();
  const params = useParams<{ libraryId: string }>();
  const libraryId = typeof params?.libraryId === "string" ? params.libraryId : undefined;
  // hooks first — the missing-id fallback returns after them
  const [title, setTitle] = useState<string | null>(null);

  if (!libraryId) {
    return (
      <div className="flex h-dvh flex-col bg-warm-sand">
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-body text-muted">
          {strings.style.detailError}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-warm-sand">
      {/* ───── Header — same navy treatment as the create flow ───── */}
      <header className="relative flex flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-md"
          style={{ background: "var(--tape-gradient)" }}
        />

        <div className="relative z-10 flex items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.push("/app/explore")}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-chalk-white/25 bg-chalk-white/10 text-chalk-white transition-all ease-brand active:scale-95 active:bg-chalk-white/20"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-chalk-white/80">
              {strings.style.libraryHeading}
            </span>
            <h1 className="truncate font-heading text-h3 font-semibold text-chalk-white">
              {title ?? "Design"}
            </h1>
          </div>
        </div>

        {/* Tape-gradient seam (Brand Book §6) */}
        <div aria-hidden className="lp-tape-strip absolute inset-x-0 bottom-0 z-10" />
      </header>

      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <LibraryDetailPage libraryId={libraryId} onTitle={setTitle} />
        </Suspense>
      </div>
    </div>
  );
}
