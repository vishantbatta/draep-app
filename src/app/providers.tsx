"use client";

/**
 * Root client provider — initializes a draft on first mount so client-side
 * navigation and hard reloads on /design/* routes always have state to render.
 *
 * Persist hydrates async; we wait for `hydrated` before auto-creating a draft
 * (otherwise we'd overwrite a valid persisted draft with a fresh one).
 */

import { useEffect } from "react";
import { useBookingStore } from "@/lib/booking-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const hydrated = useBookingStore((s) => s.hydrated);
  const draft = useBookingStore((s) => s.draft);
  const initDraft = useBookingStore((s) => s.initDraft);

  useEffect(() => {
    if (hydrated && !draft) {
      initDraft();
    }
  }, [hydrated, draft, initDraft]);

  return <>{children}</>;
}
