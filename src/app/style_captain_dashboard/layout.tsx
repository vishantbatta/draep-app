"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearSCToken,
  getSCToken,
  getSCUser,
  scLogout,
  type SCUser,
} from "@/lib/style-captain-api";

const LOGIN_PATH = "/style_captain_dashboard/login";

export default function StyleCaptainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SCUser | null>(null);

  useEffect(() => {
    const token = getSCToken();
    const isLoginPage = pathname === LOGIN_PATH;

    if (!token && !isLoginPage) {
      router.replace(LOGIN_PATH);
      return;
    }
    if (token && isLoginPage) {
      router.replace("/style_captain_dashboard");
      return;
    }
    setUser(getSCUser());
    setReady(true);
  }, [router, pathname]);

  // Terminal-auth listener: the API client dispatches "sc:unauthorized" when a
  // refresh fails (refresh token invalid/expired/stolen). The client has
  // already cleared local creds; we just redirect to login. No per-page change.
  useEffect(() => {
    const onUnauthorized = () => {
      clearSCToken();
      if (pathname !== LOGIN_PATH) router.replace(LOGIN_PATH);
    };
    window.addEventListener("sc:unauthorized", onUnauthorized);
    return () => window.removeEventListener("sc:unauthorized", onUnauthorized);
  }, [router, pathname]);

  const handleLogout = useCallback(() => {
    // Local creds cleared first inside scLogout for instant UX; the server
    // revoke is fire-and-forget. Ignore errors either way.
    void scLogout();
    router.replace(LOGIN_PATH);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-warm-sand">
        <div className="text-caption text-muted">Loading…</div>
      </div>
    );
  }

  // Login page renders standalone (no app shell)
  if (pathname === LOGIN_PATH) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh bg-warm-sand">
      {/* ─── Sticky mweb header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-ink-navy text-chalk-white">
        <div className="mx-auto flex max-w-[480px] items-center justify-between px-4 py-3">
          <button
            onClick={() => router.push("/style_captain_dashboard")}
            className="tap flex items-center gap-2"
          >
            <div className="h-6 w-6 rounded-pill bg-tape" aria-hidden />
            <span className="font-heading text-body font-semibold">
              Style Captain
            </span>
          </button>

          <div className="flex items-center gap-2">
            {user && (
              <span className="hidden text-caption text-chalk-white/70 sm:inline">
                {user.name ?? user.phone ?? "Captain"}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="tap flex h-8 w-8 items-center justify-center rounded-pill bg-white/10 text-chalk-white/80 hover:bg-white/20"
              aria-label="Logout"
              title="Logout"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
                <path
                  d="M12 14l4-4-4-4M16 10H7M7 4H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main content (mweb column) ─────────────────────────────────── */}
      <main className="mx-auto max-w-[480px] px-4 pb-24 pt-4">{children}</main>
    </div>
  );
}
