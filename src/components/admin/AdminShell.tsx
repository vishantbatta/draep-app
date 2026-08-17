"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { clearAdminToken, getAdminToken } from "@/lib/admin-api";

// ─── Primary nav tab definitions ──────────────────────────────────────────────

interface PrimaryTab {
  label: string;
  href: string;
  icon: React.ReactNode;
  matchPrefix: string;
  /** Additional path prefixes that should also activate this tab */
  altPrefixes?: string[];
}

const PRIMARY_TABS: PrimaryTab[] = [
  {
    label: "Orders",
    href: "/admin/orders",
    matchPrefix: "/admin/orders",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
        <path d="M4 5h12l-1 10H5L4 5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M7 5V3.5a3 3 0 0 1 6 0V5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    label: "Users",
    href: "/admin/users",
    matchPrefix: "/admin/users",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 17c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Catalogue",
    href: "/admin/catalogue",
    matchPrefix: "/admin/catalogue",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    label: "Configure",
    href: "/admin/actions/slot-scheduling",
    matchPrefix: "/admin/actions",
    altPrefixes: ["/admin/measurements", "/admin/catalogue/validation-rules"],
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
  {
    label: "Calendar",
    href: "/admin/calendar",
    matchPrefix: "/admin/calendar",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 8.5h14" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M6.5 11.5h2M11.5 11.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Data",
    href: "/admin/data",
    matchPrefix: "/admin/data",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
        <ellipse cx="10" cy="5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 10v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
];

// ─── Shell component ──────────────────────────────────────────────────────────

export function AdminShell({ children }: { children: React.ReactNode }) {
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
      router.replace("/admin/orders");
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

  // Determine active primary tab.
  // altPrefixes win over matchPrefix so a route nested under another tab's
  // prefix (e.g. /admin/catalogue/validation-rules) can highlight a different tab.
  const activeTab =
    PRIMARY_TABS.find((t) =>
      t.altPrefixes?.some((p) => pathname.startsWith(p)),
    ) ??
    PRIMARY_TABS.find((t) => pathname.startsWith(t.matchPrefix)) ??
    PRIMARY_TABS[0];

  return (
    <div className="flex min-h-dvh flex-col bg-warm-sand md:flex-row">
      {/* ─── Mobile top bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-hairline bg-chalk-white px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Image
            src="/logo_alpha_icon.png"
            alt=""
            width={560}
            height={606}
            priority
            className="h-6 w-6 object-contain"
          />
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
            <Image
              src="/logo_alpha_icon.png"
              alt="Draep"
              width={560}
              height={606}
              priority
              className="h-7 w-7 object-contain md:h-8 md:w-8"
            />
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
                      ? "bg-white/15 text-white"
                      : "text-white/50 hover:bg-white/10 hover:text-white/90"
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

        {/* ── Column 2: Secondary nav (conditional — hidden when no items) ─── */}
        <ConditionalSecondaryNav activeTabLabel={activeTab.label} onCloseDrawer={() => setDrawerOpen(false)} />
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

function ConditionalSecondaryNav({
  activeTabLabel,
  onCloseDrawer,
}: {
  activeTabLabel: string;
  onCloseDrawer: () => void;
}) {
  const [detail, setDetail] = useState<NavDetail>(null);

  useEffect(() => {
    function handler(e: Event) {
      setDetail((e as CustomEvent).detail as NavDetail);
    }
    window.addEventListener("admin-sidebar-update", handler);
    return () => window.removeEventListener("admin-sidebar-update", handler);
  }, []);

  // Hide the sidebar entirely when there are no items (or detail is null/empty)
  const hasItems = detail?.items && detail.items.length > 0;
  if (!hasItems) return null;

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-hairline bg-chalk-white md:w-56">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-3 md:px-4 md:py-4">
        <div className="min-w-0">
          <div className="font-heading text-[15px] font-semibold text-ink-navy">
            {activeTabLabel}
          </div>
          <div className="truncate text-[11px] leading-tight text-muted">
            admin@draep.com
          </div>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={onCloseDrawer}
          className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-mist-navy md:hidden"
          aria-label="Close navigation"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scrollable secondary list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          {detail!.items.map((item) => (
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
      </div>
    </aside>
  );
}
