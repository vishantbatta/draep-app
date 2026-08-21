"use client";

/**
 * Root client provider — bootstraps the auth session on mount.
 *
 * Sequence:
 *   1. Wait for Zustand persist to hydrate the auth store
 *   2. Bootstrap auth: validate existing token or mint anonymous session
 *
 * This guarantees every API call from any screen has a valid bearer token.
 *
 * NOTE: the booking draft is intentionally NOT initialized here. Doing so
 * created a server-side draft order (POST /orders) on every full page load,
 * leaking orphan `draft` rows into the DB. Drafts are now created lazily by
 * the actual entry points that need them: the /design layout, and the
 * "Build from scratch" / "Upload" CTAs on /style (see booking-store.initDraft).
 */

import { useEffect, useRef } from "react";

import { useAuthStore } from "@/lib/auth-store";

import { InstallPrompt } from "@/components/layout/InstallPrompt";

export function Providers({ children }: { children: React.ReactNode }) {
  const authHydrated = useAuthStore((s) => s.hydrated);
  const bootstrap = useAuthStore((s) => s.bootstrap);

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

  return (
    <>
      {children}
      <InstallPrompt />
    </>
  );
}
