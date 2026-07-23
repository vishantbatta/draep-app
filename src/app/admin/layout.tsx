"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAdminToken, getAdminToken } from "@/lib/admin-api";

// ─── Primary nav tab definitions ──────────────────────────────────────────────

interface PrimaryTab {
  label: string;
  href: string;
  icon: React.ReactNode;
  matchPrefix: string;
}

const PRIMARY_TABS: PrimaryTab[] = [
  {
    label: "Data",
    href: "/admin",
    matchPrefix: "/admin",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
        <ellipse cx="10" cy="5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 10v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    label: "Actions",
    href: "/admin/actions/garments",
    matchPrefix: "/admin/actions",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 2v3M10 15v3M2 10h3M15 10h3M4.2 4.2l2.1 2.1M13.7 13.7l2.1 2.1M4.2 15.8l2.1-2.1M13.7 6.3l2.1-2.1"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
];

// ─── Layout component ─────────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const token = getAdminToken();
    const isLoginPage = pathname === "/admin/login";

    if (!token && !isLoginPage) {
      router.replace("/admin/login");
      return;
    }

    if (token && isLoginPage) {
      router.replace("/admin");
      return;
    }

    setReady(true);
  }, [router, pathname]);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-warm-sand">
        <div className="text-caption text-muted">Loading…</div>
      </div>
    );
  }

  // Login page renders standalone
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  function handleLogout() {
    clearAdminToken();
    router.replace("/admin/login");
  }

  // Determine active primary tab
  const activeTab =
    PRIMARY_TABS.find((t) =>
      t.href === "/admin"
        ? pathname === "/admin"
        : pathname.startsWith(t.matchPrefix),
    ) ?? PRIMARY_TABS[0];

  return (
    <div className="flex min-h-dvh flex-col bg-warm-sand md:flex-row">
      {/* ─── Mobile top bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-hairline bg-chalk-white px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-pill bg-tape" aria-hidden />
          <span className="font-heading text-body font-semibold text-ink-navy">
            Draep admin
          </span>
        </div>
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          className="tap flex h-9 w-9 items-center justify-center rounded-lg border border-hairline-strong text-ink-navy"
          aria-label="Toggle navigation"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
            {drawerOpen ? (
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            ) : (
              <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {/* ─── Mobile drawer overlay ──────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ═══ Dual sidebar ═════════════════════════════════════════════════ */}
      <div
        className={`fixed left-0 top-0 z-40 flex h-dvh shrink-0 transition-transform duration-200 md:sticky md:top-0 md:h-dvh md:self-start md:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* ── Column 1: Primary nav (dark icon rail) ────────────────────── */}
        <nav className="flex w-14 shrink-0 flex-col bg-ink-navy md:w-20">
          {/* Brand mark */}
          <div className="flex shrink-0 items-center justify-center border-b border-white/10 py-3 md:py-4">
            <div className="h-7 w-7 rounded-pill bg-tape md:h-8 md:w-8" aria-hidden />
          </div>

          {/* Scrollable primary tabs */}
          <div className="flex-1 overflow-y-auto py-2">
            <div className="flex flex-col items-center gap-1 px-1">
              {PRIMARY_TABS.map((tab) => (
                <button
                  key={tab.label}
                  onClick={() => router.push(tab.href)}
                  className={`tap flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 transition ${
                    activeTab.label === tab.label
                      ? "bg-white/15 text-chalk-white"
                      : "text-chalk-white/80 hover:bg-white/10 hover:text-chalk-white"
                  }`}
                >
                  {tab.icon}
                  <span className="text-[10px] font-medium leading-tight md:text-[11px]">
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Logout — always visible at bottom of icon rail */}
          <div className="shrink-0 border-t border-white/10 p-2">
            <button
              onClick={handleLogout}
              className="tap mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-chalk-white/70 transition hover:bg-white/15 hover:text-chalk-white md:h-11 md:w-11"
              aria-label="Logout"
              title="Logout"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
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
        </nav>

        {/* ── Column 2: Secondary nav ──────────────────────────────────── */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-hairline bg-chalk-white md:w-56">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-3 md:px-4 md:py-4">
            <div className="min-w-0">
              <div className="font-heading text-[15px] font-semibold text-ink-navy">
                {activeTab.label}
              </div>
              <div className="truncate text-[11px] leading-tight text-muted">
                admin@draep.com
              </div>
            </div>
            {/* Close button — mobile only */}
            <button
              onClick={() => setDrawerOpen(false)}
              className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-mist-navy md:hidden"
              aria-label="Close navigation"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Scrollable secondary list */}
          <SecondaryNavSlot />
        </aside>
      </div>

      {/* ═══ Main content area ════════════════════════════════════════════ */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

// ─── Secondary nav: fed by page via CustomEvent ─────────────────────────────

type NavItem = {
  label: string;
  active: boolean;
  onClick: () => void;
};

type NavDetail = {
  items: NavItem[];
} | null;

function SecondaryNavSlot() {
  const [detail, setDetail] = useState<NavDetail>(null);

  useEffect(() => {
    function handler(e: Event) {
      setDetail((e as CustomEvent).detail as NavDetail);
    }
    window.addEventListener("admin-sidebar-update", handler);
    return () => window.removeEventListener("admin-sidebar-update", handler);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {!detail ? (
        <div className="px-3 py-2 text-[13px] text-muted">Loading…</div>
      ) : detail.items.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-muted">No items</div>
      ) : (
        <div className="space-y-0.5">
          {detail.items.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className={`block w-full truncate rounded-lg px-3 py-2 text-left font-mono text-[13px] leading-relaxed transition ${
                item.active
                  ? "bg-ink-navy font-medium text-chalk-white"
                  : "text-ink hover:bg-mist-navy"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
