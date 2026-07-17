"use client";

/**
 * Design layout — gates on a local `mounted` flag plus Zustand `hydrated`.
 *
 * Why both: persist's `onRehydrateStorage` callback can be unreliable in some
 * edge cases (empty storage, dev HMR). A simple `useEffect(() => setMounted(true))`
 * guarantees the skeleton disappears after the first client paint, regardless.
 *
 * Middleware redirects empty drafts before reaching here.
 */

import { useEffect, useState } from "react";
import { useBookingStore } from "@/lib/booking-store";

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const hydrated = useBookingStore((s) => s.hydrated);
  const draft = useBookingStore((s) => s.draft);
  const initDraft = useBookingStore((s) => s.initDraft);

  useEffect(() => {
    setMounted(true);
  }, []);

  // After mount, if no draft exists yet (fresh visit), initialize one.
  // Landing also does this on CTA click — this covers hard reloads.
  useEffect(() => {
    if (mounted && hydrated && !draft) {
      initDraft();
    }
  }, [mounted, hydrated, draft, initDraft]);

  if (!mounted) {
    return <LoadingSkeleton />;
  }

  return <>{children}</>;
}

function LoadingSkeleton() {
  return (
    <div className="column flex min-h-dvh items-center justify-center">
      <div
        aria-hidden
        className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver"
      >
        <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
      </div>
    </div>
  );
}
