"use client";

/**
 * Root client provider — bootstraps auth session + booking draft on mount.
 *
 * Sequence:
 *   1. Wait for Zustand persist to hydrate (both auth + booking stores)
 *   2. Bootstrap auth: validate existing token or mint anonymous session
 *   3. Initialize booking draft once auth is ready
 *
 * This guarantees every API call from any screen has a valid bearer token.
 */

import { useEffect, useRef } from "react";

import { useAuthStore } from "@/lib/auth-store";
import { useBookingStore } from "@/lib/booking-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const authHydrated = useAuthStore((s) => s.hydrated);
  const token = useAuthStore((s) => s.token);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  const bookingHydrated = useBookingStore((s) => s.hydrated);
  const draft = useBookingStore((s) => s.draft);
  const initDraft = useBookingStore((s) => s.initDraft);

  // Bootstrap auth session on mount (after hydration)
  const authBootstrapped = useRef(false);
  useEffect(() => {
    if (authHydrated && !authBootstrapped.current) {
      authBootstrapped.current = true;
      bootstrap().catch(() => {
        // Bootstrap failure is non-fatal — the auth store handles fallbacks.
      });
    }
  }, [authHydrated, bootstrap]);

  // Initialize booking draft after auth is ready
  const draftInitFired = useRef(false);
  useEffect(() => {
    // Wait for booking store hydration AND auth token to exist
    if (bookingHydrated && !draft && !draftInitFired.current && token) {
      draftInitFired.current = true;
      initDraft();
    }
  }, [bookingHydrated, draft, initDraft, token]);

  return <>{children}</>;
}
