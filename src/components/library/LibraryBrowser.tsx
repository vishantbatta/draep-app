"use client";

/**
 * LibraryBrowser — read-only gallery of every design in the library.
 *
 * Shared surface: /library renders it full-viewport; the /app Explore tab
 * renders it inside the tabbed shell (root is h-full — the host provides
 * the height).
 *
 * Mirrors /style exactly minus:
 *   • No Upload / Build-from-scratch / Draft-this-design CTAs — the detail
 *     sheet footer carries its own instead: "Order now" (primary — creates a
 *     PENDING order and routes to /app/orders/{id}) with "Try it on" demoted
 *     to the secondary pill. Both are login-gated when logged out.
 *   • No prices on cards or in the detail sheet
 *   • No back button (relies on browser history)
 *
 * Layout: collapsed header → infinite-scroll grid → detail sheet.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { LoginGateSheet } from "@/components/auth/LoginGateSheet";
import { Sparkle, Sparkles, Close, ChevronRight, Tune } from "@/components/ui/icons";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TryOnSheet } from "@/components/tryon/TryOnSheet";
import {
  EMPTY_FILTERS,
  FilterSheet,
  countFilters,
  isEmptyFilters,
  type LibraryFilters,
  type QuickFilterSection,
} from "@/components/library/FilterSheet";
import { LibraryOrderPreviewSheet } from "@/components/library/LibraryOrderPreviewSheet";
import { libraryApi } from "@/lib/api";
import { useAuthHydrated, useAuthStore } from "@/lib/auth-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type {
  LibraryDetailOut,
  LibraryFacetsOut,
  LibraryListItemOut,
  ResolvedItemOut,
} from "@/types/api";

/* ============================================================ */

/* Slim navy bar the header settles into once fully collapsed (px). */
const HEADER_COLLAPSED_PX = 36;
/* Expanded height lives here too so the scroll handler can restore it
 * verbatim when the list returns to the top (clearing the inline style
 * would fall back to auto, losing the dvh sizing). */
const HEADER_EXPANDED_H = "30dvh";

export function LibraryBrowser() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const headerContentRef = useRef<HTMLDivElement>(null);
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);
  const authHydrated = useAuthHydrated();
  const isLoggedIn = sessionType === "user";
  // Logged in but still owing name/gender — the gate collects these too.
  const profileIncomplete = isLoggedIn && (!user?.name || !user?.gender);

  /* ── Library list state ─────────────────────────────────────────────── */
  const [items, setItems] = useState<LibraryListItemOut[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // True while an infinite-scroll page is in flight (drives the bottom loader).
  const [loadingMore, setLoadingMore] = useState(false);

  /* ── Filter state ───────────────────────────────────────────────────── */
  const [facets, setFacets] = useState<LibraryFacetsOut | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // Upfront pills open a quick sheet scoped to ONE facet; All filters opens
  // the full sheet above.
  const [quickFilter, setQuickFilter] = useState<QuickFilterSection | null>(null);

  /* ── Detail sheet state ─────────────────────────────────────────────── */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryDetailOut | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  /* ── Try-on sheet state ─────────────────────────────────────────────── */
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const [tryOnDesignUrl, setTryOnDesignUrl] = useState<string | null>(null);
  const [tryOnDesignTitle, setTryOnDesignTitle] = useState<string | undefined>(
    undefined,
  );

  /* ── Order + login-gate state ──────────────────────────────────────── */
  const [orderPreviewOpen, setOrderPreviewOpen] = useState(false);
  const [showLoginGate, setShowLoginGate] = useState(false);
  // The CTA that hit the login gate — re-run by the effect below on verify.
  const [actionAfterLogin, setActionAfterLogin] = useState<"order" | "tryon" | null>(
    null,
  );

  /* ── Scroll-linked header collapse ────────────────────────────────────
   * The header shrinks continuously with scroll (not a threshold snap):
   * height interpolates 30dvh → HEADER_COLLAPSED_PX over the first screenful,
   * and the title fades/drifts out with the same progress. Written straight
   * to the DOM inside one rAF so scrolling never re-renders React. At the
   * top the inline styles are dropped again so CSS keeps owning the dvh
   * height (mobile URL-bar resizes stay honest). */
  useEffect(() => {
    const root = scrollRef.current;
    const header = headerRef.current;
    const content = headerContentRef.current;
    if (!root || !header || !content) return;

    let raf = 0;
    let maxPx: number | null = null; // expanded height, measured at rest

    const apply = () => {
      raf = 0;
      const top = root.scrollTop;
      if (top <= 1) {
        if (maxPx !== null) {
          maxPx = null;
          header.style.height = HEADER_EXPANDED_H;
          content.style.opacity = "";
          content.style.transform = "";
        }
        return;
      }
      maxPx ??= header.getBoundingClientRect().height;
      const span = Math.max(maxPx - HEADER_COLLAPSED_PX, 1);
      // 1:1 with the finger (native collapsing-header feel) — the smoothness
      // comes from continuous tracking, not from easing the progress.
      const p = Math.min(top / span, 1);
      header.style.height = `${Math.round(maxPx - p * span)}px`;
      content.style.opacity = (1 - p).toFixed(3);
      content.style.transform = `translateY(${(-14 * p).toFixed(1)}px)`;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /* ── Initial fetch (also re-runs whenever filters change) ──────────── */
  const fetchFirstPage = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const out = await libraryApi.listLibrary({ limit: 24, ...filters });
      setItems(out.items);
      setNextCursor(out.next_cursor);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : strings.style.loadError,
      );
    } finally {
      setListLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage]);

  /* ── Facets: filter values + catalogue tree — fetched once ─────────── */
  // Failure is non-fatal — the filter bar simply won't open with values.
  useEffect(() => {
    let cancelled = false;
    libraryApi
      .getLibraryFacets()
      .then((f) => {
        if (!cancelled) setFacets(f);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Infinite scroll: fetch next page when loader enters viewport ──── */
  const fetchNextPage = useCallback(async () => {
    if (!nextCursor || listLoading || loadingMore) return;
    const cursor = nextCursor;
    setLoadingMore(true);
    try {
      const out = await libraryApi.listLibrary({ limit: 24, cursor, ...filters });
      setItems((prev) => [...prev, ...out.items]);
      setNextCursor(out.next_cursor);
    } catch {
      // Best effort — keep what we have; user can retry by scrolling.
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, listLoading, loadingMore, filters]);

  useEffect(() => {
    const loader = loaderRef.current;
    const root = scrollRef.current;
    if (!loader || !root) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage();
      },
      { root, rootMargin: "200px" },
    );
    obs.observe(loader);
    return () => obs.disconnect();
  }, [fetchNextPage]);

  /* ── Open detail sheet on card tap ─────────────────────────────────── */
  const openDetail = useCallback((id: string) => {
    setDetailId(id);
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    track({ event: "library_card_tapped", library_id: id });
  }, []);

  /* ── Fetch detail whenever the sheet opens for a new id ────────────── */
  useEffect(() => {
    if (!detailOpen || !detailId) return;
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const d = await libraryApi.getLibraryDetail(detailId);
        if (!cancelled) setDetail(d);
      } catch (err) {
        if (!cancelled) {
          setDetailError(
            err instanceof Error ? err.message : strings.style.detailError,
          );
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailOpen, detailId]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setTimeout(() => {
      setDetailId(null);
      setDetail(null);
      setDetailError(null);
    }, 250);
  }, []);

  /* ── Login gate: both footer CTAs need a user session ──────────────── */
  // Mirrors MyodSheet's Generate gate: while hydrated and logged out — or
  // logged in with the name/gender profile still incomplete — the CTA opens
  // the login sheet instead (it lands on the profile form for the latter);
  // the continuation effect below re-runs the blocked action once the store
  // holds a complete user session.
  const gate = useCallback(
    (action: "order" | "tryon") => {
      if (authHydrated && (!isLoggedIn || profileIncomplete)) {
        setActionAfterLogin(action);
        setShowLoginGate(true);
        return true;
      }
      return false;
    },
    [authHydrated, isLoggedIn, profileIncomplete],
  );

  /* ── Open the try-on sheet using the current detail's hero image ──── */
  // We close the detail sheet visually but KEEP `detailId` / `detail` so that
  // when the user taps Done on the try-on result we can reopen the exact same
  // design sheet without a refetch.
  const openTryOn = useCallback(() => {
    if (gate("tryon")) return;
    if (!detail?.hero_image_url) return;
    setTryOnDesignUrl(detail.hero_image_url);
    setTryOnDesignTitle(detail.labels?.en ?? undefined);
    setDetailOpen(false);
    setTimeout(() => setTryOnOpen(true), 220);
  }, [detail, gate]);

  /* ── Order Now: review (and tweak) the design's selections, then
     create — the CTA opens the "Review your selection" editor; its apply
     creates the PENDING order (LibraryOrderPreviewSheet owns that flow). */
  const startOrderPreview = useCallback(() => {
    if (gate("order")) return;
    setOrderPreviewOpen(true);
  }, [gate]);

  // Fires the moment the order exists — the analytics event only; creation,
  // tweak application and routing live in the preview sheet.
  const handleOrderCreated = useCallback(
    (orderId: string) => {
      if (!detail) return;
      track({
        event: "library_ordered",
        library_id: detail.id,
        order_id: orderId,
      });
    },
    [detail],
  );

  // Gate continuation: the sheet's verify flips sessionType in the store;
  // this effect re-runs the blocked CTA on the next render with a logged-in
  // closure (fresh detail) instead of the stale one from before it opened.
  // Dismissing the gate without verifying clears the pending action. The
  // profileIncomplete guard holds the CTA back until the sheet's profile
  // form saves — without it the effect would fire the instant the gate
  // opens for an already-logged-in incomplete user.
  useEffect(() => {
    if (!actionAfterLogin || !isLoggedIn || profileIncomplete) return;
    const action = actionAfterLogin;
    setActionAfterLogin(null);
    if (action === "order") startOrderPreview();
    else openTryOn();
  }, [actionAfterLogin, isLoggedIn, profileIncomplete, startOrderPreview, openTryOn]);

  const closeTryOn = useCallback(() => {
    setTryOnOpen(false);
    setTimeout(() => {
      setTryOnDesignUrl(null);
      setTryOnDesignTitle(undefined);
    }, 250);
  }, []);

  /* ── Filters: open sheets / apply / remove-one ─────────────────────── */
  // A section opens that pill's quick sheet; null opens the full sheet.
  const openFilterSheet = useCallback((section: QuickFilterSection | null) => {
    if (section) setQuickFilter(section);
    else setFilterSheetOpen(true);
  }, []);

  const applyFilters = useCallback((f: LibraryFilters) => {
    setFilters(f);
    track({ event: "library_filters_applied", count: countFilters(f) });
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const removeFilter = useCallback(
    (key: keyof LibraryFilters, value: string) => {
      setFilters((prev) => ({
        ...prev,
        [key]: prev[key].filter((v) => v !== value),
      }));
    },
    [],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-column flex-col bg-warm-sand">
      {/* ───── Header (collapses smoothly with scroll, see effect above) ──
          Full-bleed navy; its content row re-aligns to the 480px column. */}
      <header
        ref={headerRef}
        className="relative flex w-full flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white"
        style={{ height: HEADER_EXPANDED_H }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-md"
          style={{ background: "var(--tape-gradient)" }}
        />

        {/* Stays mounted — the collapse effect fades/drifts it out by progress. */}
        <div
          ref={headerContentRef}
          className="relative z-10 flex w-full flex-col items-center gap-2 px-4 pb-6"
        >
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-chalk-white/15 px-3 py-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-chalk-white backdrop-blur-sm">
              <RivetDot />
              Design Library
            </span>
            <h1 className="mt-2 font-heading text-h1 font-semibold text-chalk-white">
              Browse every blouse we make
            </h1>
          </div>
        </div>

        {/* Tape-gradient seam with tick overlay — Brand Book §6 (the tape) */}
        <div aria-hidden className="lp-tape-strip absolute inset-x-0 bottom-0 z-10" />
      </header>

      {/* ───── Bottom section (library grid) ───── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* Section header — eyebrow + tick-divider rail ending in a rivet (§6) */}
        <div className="px-4 pt-4">
          <span className="eyebrow">The collection</span>
          <h2 className="mt-1 font-heading text-h3 font-semibold text-ink-navy">
            {strings.style.libraryHeading}
          </h2>
          <p className="mt-0.5 text-caption text-muted">
            {strings.style.librarySubheading}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="tick-divider flex-1" aria-hidden />
            <RivetDot />
          </div>
        </div>

        {/* ── Filter bar — upfront chips + All filters (sticky) ─────── */}
        <div className="sticky top-0 z-20 bg-warm-sand/95 px-4 pb-2 pt-3 backdrop-blur-sm">
          <FilterBar filters={filters} onOpen={openFilterSheet} />
          {!isEmptyFilters(filters) && (
            <ActiveFilterChips
              filters={filters}
              facets={facets}
              onRemove={removeFilter}
              onClearAll={() => applyFilters(EMPTY_FILTERS)}
            />
          )}
        </div>

        {/* Grid body — one full-bleed hero row per design */}
        <div className="px-4 pt-4">
          {/* MYOD banner — hidden for now (re-enable with <MyodBanner />) */}
          {/* <MyodBanner /> */}

          {listLoading && items.length === 0 ? (
            <GridSkeleton />
          ) : listError ? (
            <ListError
              message={listError}
              onRetry={() => fetchFirstPage()}
            />
          ) : items.length === 0 ? (
            isEmptyFilters(filters) ? (
              <EmptyState text={strings.style.emptyLibrary} />
            ) : (
              <NoMatchesState onClear={() => applyFilters(EMPTY_FILTERS)} />
            )
          ) : (
            <div className="flex flex-col gap-4">
              {items.map((it) => (
                <LibraryCard
                  key={it.id}
                  item={it}
                  onSelect={() => openDetail(it.id)}
                />
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel + loader — the spinner tells the user
              the next page of designs is on its way. */}
          <div ref={loaderRef} className="h-1" aria-hidden />
          {loadingMore && items.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-center gap-2 py-6"
            >
              <div
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-tape-silver border-t-draep-orange"
              />
              <span className="text-caption font-medium text-muted">
                {strings.style.loadingMore}
              </span>
            </div>
          )}
        </div>

        <div className="h-6" />
      </div>



      {/* ───── Detail BottomSheet — sticky "Try it on" footer ───── */}
      <BottomSheet
        open={detailOpen}
        onClose={closeDetail}
        title={detail?.labels?.en ?? strings.style.detailLoading}
        footer={
          detail?.hero_image_url ? (
            <DetailFooter onTryOn={openTryOn} onOrder={startOrderPreview} />
          ) : undefined
        }
      >
        {detailLoading ? (
          <DetailSkeleton />
        ) : detailError ? (
          <ListError
            message={detailError}
            onRetry={() => detailId && openDetail(detailId)}
          />
        ) : detail ? (
          <DetailBody detail={detail} />
        ) : null}
      </BottomSheet>

      {/* ───── Order preview — the "Review your selection" editor; apply
             creates the PENDING order with the (possibly tweaked)
             selections and routes into visit booking. ───── */}
      <LibraryOrderPreviewSheet
        open={orderPreviewOpen}
        onClose={() => setOrderPreviewOpen(false)}
        libraryId={detail?.id ?? null}
        initialDetail={detail}
        onCreated={handleOrderCreated}
      />

      {/* ───── Virtual Try-On sheet ───── */}
      {tryOnDesignUrl && (
        <TryOnSheet
          open={tryOnOpen}
          onClose={closeTryOn}
          designImageUrl={tryOnDesignUrl}
          designTitle={tryOnDesignTitle}
          garmentId={detail?.garment_id ?? undefined}
          libraryId={detail?.id ?? undefined}
        />
      )}

      {/* ───── All-filters bottom sheet (every section) ───── */}
      <FilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        facets={facets}
        filters={filters}
        onApply={applyFilters}
      />

      {/* ───── Quick filter sheets — one upfront pill = one facet ───── */}
      <FilterSheet
        open={quickFilter !== null}
        onClose={() => setQuickFilter(null)}
        facets={facets}
        filters={filters}
        singleSection={quickFilter}
        onApply={applyFilters}
      />

      {/* Login gate — both detail-sheet CTAs open this when logged out;
          verify success re-runs the blocked CTA via the effect above. */}
      <LoginGateSheet
        open={showLoginGate}
        onClose={() => {
          setShowLoginGate(false);
          setActionAfterLogin(null);
        }}
        onSuccess={() => setShowLoginGate(false)}
        title={
          actionAfterLogin === "order"
            ? strings.libraryOrder.orderGateTitle
            : strings.libraryOrder.tryOnGateTitle
        }
      />
    </div>
  );
}

/* ============================================================ */
/*  Subcomponents                                                */
/* ============================================================ */

/**
 * Rivet dot — the orange tape-end motif (Brand Book §6 "rivet = timeline
 * end-dot"). Glows on its own halo so it reads on navy and on sand.
 */
function RivetDot({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full bg-draep-orange shadow-[0_0_0_3px_rgba(248,144,16,0.22)] ${className}`}
    />
  );
}

/**
 * Sticky footer CTAs for the design detail sheet. "Order now" is the primary
 * (tape-gradient pill — the only gradient CTA per Brand Book §8) and opens
 * the "Review your selection" editor (creation happens there); "Try it on"
 * is the secondary outline pill. Both are login-gated by the caller
 * (LoginGateSheet) before firing.
 */
function DetailFooter({
  onTryOn,
  onOrder,
}: {
  onTryOn: () => void;
  onOrder: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {/* Secondary — virtual try-on (outline pill) */}
      <button
        type="button"
        onClick={onTryOn}
        className="flex items-center justify-center gap-2 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-semibold text-ink-navy transition-all ease-brand active:scale-[0.98] active:border-navy-interactive disabled:opacity-50"
      >
        <Sparkles size={16} className="text-draep-orange" />
        {strings.tryOn.cta}
      </button>
      {/* Primary — order now (the tape gradient) */}
      <button
        type="button"
        onClick={onOrder}
        className="flex items-center justify-center gap-2 rounded-pill px-4 py-3 text-body font-semibold text-chalk-white shadow-primary transition-all ease-brand active:scale-[0.98] disabled:opacity-60"
        style={{ backgroundImage: "var(--tape-gradient)" }}
      >
        {strings.libraryOrder.cta}
      </button>
    </div>
  );
}

/**
 * Library row card — one design per row (Brand Book §6 .stylecard, wide format).
 *
 * Two clean zones, never overlapping:
 *   • Image zone  — full-bleed photo on the soft catalogue placeholder gradient.
 *                   object-cover + object-top keeps the full blouse visible
 *                   (product shots are top/center weighted) and the grid
 *                   visually consistent. Category + chevron float on it.
 *   • Body zone   — white card surface, navy text. "Worn by", title, tags.
 *                   Solid surface = text can never blend with the photo.
 * Read-only: no price.
 */
function LibraryCard({
  item,
  onSelect,
}: {
  item: LibraryListItemOut;
  onSelect: () => void;
}) {
  const title = item.labels?.en ?? "Untitled design";
  const tags = (item.occasions ?? []).slice(0, 3);
  const wornBy = item.celebrity_name;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white text-left shadow-card transition-all ease-brand active:scale-[0.99] active:shadow-brand"
    >
      {/* ── Image zone — hugs the photo's own aspect ratio ────── */}
      <div className="relative w-full overflow-hidden bg-mist-navy">
        {item.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.hero_image_url}
            alt={title}
            loading="lazy"
            className="relative block h-auto w-full object-cover"
          />
        ) : (
          // No photo — soft catalogue placeholder (Brand Book §6 .ph)
          <div
            className="relative flex aspect-[4/3] w-full items-center justify-center text-muted"
            style={{ backgroundImage: "linear-gradient(135deg,#EAF0F8,#FFF6EA)" }}
          >
            <Sparkle size={32} />
          </div>
        )}

        {/* Category — floats on image, own chip surface */}
        {item.category && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-pill bg-ink-navy/85 px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-chalk-white backdrop-blur-sm">
            <RivetDot className="!h-1.5 !w-1.5 !shadow-none" />
            {item.category}
          </span>
        )}

        {/* Open affordance */}
        <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-chalk-white/90 text-ink-navy shadow-card transition-transform ease-brand active:scale-90">
          <ChevronRight size={14} />
        </span>
      </div>

      {/* ── Body zone — solid white, navy text ─────────────────── */}
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        {wornBy && (
          <div className="flex items-center gap-1.5">
            <Sparkle size={12} className="shrink-0 text-draep-orange" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
              {strings.style.designBy}
            </span>
            <span className="truncate font-heading text-[13px] font-semibold text-ink-navy">
              {wornBy}
            </span>
          </div>
        )}

        <p className="line-clamp-2 text-body font-heading font-semibold leading-snug text-ink-navy">
          {title}
        </p>

        {tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-pill bg-warm-sand px-2 py-0.5 text-[11px] font-medium text-ink-navy"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

/** Detail sheet body — hero, celebrity note, grouped design items, styling notes. NO prices. */
function DetailBody({ detail }: { detail: LibraryDetailOut }) {
  const groups = groupItems(detail.items);
  const [zoomed, setZoomed] = useState(false);

  return (
    <div className="pb-4">
      {/* Hero image — full-bleed inside the sheet, click to zoom */}
      {detail.hero_image_url && (
        <div className="relative -mx-4 mb-3 aspect-[16/9] overflow-hidden bg-mist-navy">
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="absolute inset-0 h-full w-full"
            aria-label="Zoom image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={detail.hero_image_url}
              alt={detail.labels?.en ?? "Design"}
              className="h-full w-full object-contain"
            />
          </button>
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-pill bg-ink-navy/55 px-2 py-0.5 text-[10px] font-medium text-chalk-white backdrop-blur-sm">
            Tap to zoom
          </span>
          {detail.reference_url && (
            <a
              href={detail.reference_url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-2 rounded-pill bg-ink-navy/70 px-2.5 py-1 text-[11px] font-medium text-chalk-white backdrop-blur-sm"
            >
              Source
            </a>
          )}
        </div>
      )}

      {/* Fullscreen zoom overlay */}
      {zoomed && detail.hero_image_url && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-navy/90 backdrop-blur-sm"
          onClick={() => setZoomed(false)}
        >
          <button
            type="button"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-chalk-white/20 text-chalk-white"
            onClick={() => setZoomed(false)}
            aria-label="Close"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={detail.hero_image_url}
            alt={detail.labels?.en ?? "Design"}
            className="max-h-[90vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Celebrity + famous-for */}
      {detail.celebrity_name && (
        <div className="mb-3 rounded-card border border-hairline bg-warm-sand/60 p-3">
          <div className="flex items-center gap-1.5 text-eyebrow font-mono uppercase tracking-wider text-muted">
            <Sparkle size={12} />
            {strings.style.designBy}
          </div>
          <p className="mt-1 font-heading text-h3 font-semibold text-ink-navy">
            {detail.celebrity_name}
          </p>
          {detail.famous_for?.en && (
            <p className="mt-0.5 text-caption text-muted">
              {strings.style.alsoKnownFor}: {detail.famous_for.en}
            </p>
          )}
        </div>
      )}

      {/* Occasions */}
      {detail.occasions && detail.occasions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {detail.occasions.map((o) => (
            <span
              key={o}
              className="rounded-pill bg-warm-sand px-2.5 py-1 text-caption text-ink"
            >
              {o}
            </span>
          ))}
        </div>
      )}

      {/* Design items — grouped, NO prices */}
      <h3 className="mb-2 font-heading text-h3 font-semibold text-ink-navy">
        {strings.style.designIncludes}
      </h3>
      <div className="flex flex-col gap-2">
        {groups.map((g) => (
          <ItemGroup key={g.label} label={g.label} items={g.items} />
        ))}
      </div>

      {/* Styling notes */}
      {detail.styling_notes?.en && (
        <div className="mt-4 rounded-card border border-hairline bg-chalk-white p-3">
          <p className="text-eyebrow font-mono uppercase tracking-wider text-muted">
            Styling notes
          </p>
          <p className="mt-1 text-body text-ink">
            {detail.styling_notes.en}
          </p>
        </div>
      )}
    </div>
  );
}

/** A single group of items inside the design detail. */
function ItemGroup({
  label,
  items,
}: {
  label: string;
  items: ResolvedItemOut[];
}) {
  return (
    <div className="rounded-card border border-hairline bg-chalk-white p-3">
      <p className="text-eyebrow font-mono uppercase tracking-wider text-muted">
        {label}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.map((it) => (
          <ItemRow key={it.item_id} item={it} />
        ))}
      </ul>
    </div>
  );
}

/** One line inside an item group — label only (no price). */
function ItemRow({ item }: { item: ResolvedItemOut }) {
  return (
    <li className="text-body text-ink">{composeItemLabel(item)}</li>
  );
}

/* ============================================================ */
/*  MYOD banner                                                  */
/* ============================================================ */

/**
 * MYOD (Make Your Own Draep) banner — entry point to /myod/blouse where the
 * user can design a blouse step by step (each garment has its own /myod/<id or
 * slug> URL).
 *
 * On-brand per Brand Book §8: white card surface, hairline border, --shadow-card,
 * the tape-strip seam as the signature motif, mono eyebrow, navy heading, and
 * a tape-gradient CTA pill (the only place the gradient appears on a card).
 */
function MyodBanner() {
  return (
    <Link
      href="/myod/blouse"
      onClick={() => track({ event: "myod_opened", source: "library" })}
      className="group mb-4 flex w-full flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white text-left shadow-card transition-all ease-brand active:scale-[0.99] active:shadow-brand"
    >
      {/* Tape-strip seam — the brand signature (draep.html .tape-strip) */}
      <div aria-hidden className="lp-tape-strip" />

      <div className="flex items-start gap-3 p-4">
        {/* Symbol mark — DraepSymbol (Brand Book §1), color variant */}
        <span aria-hidden className="mt-0.5 shrink-0 text-draep-orange">
          <Sparkles size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <span className="eyebrow">{strings.myod.bannerEyebrow}</span>
          <p className="mt-1 font-heading text-h3 font-semibold leading-snug text-ink-navy">
            {strings.myod.bannerTitle}
          </p>
          <p className="mt-0.5 text-caption leading-snug text-muted">
            {strings.myod.bannerBody}
          </p>

          {/* CTA — tape-gradient pill, the single gradient element (Brand Book §8) */}
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-pill bg-tape px-3.5 py-1.5 text-caption font-semibold text-chalk-white shadow-primary"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            {strings.myod.bannerCta}
            <ChevronRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ============================================================ */
/*  Filter bar + active chips                                    */
/* ============================================================ */

/**
 * Upfront filter chips (Occasions, Body Types, Celebrity) + the All-filters
 * button. Each upfront chip opens a QUICK sheet holding only its own facet;
 * the All-filters button — styled heavier on purpose (2px navy outline on
 * sand, sliders glyph, uppercase label) so it reads as a control, not just
 * another category pill — opens the full sheet.
 */
function FilterBar({
  filters,
  onOpen,
}: {
  filters: LibraryFilters;
  onOpen: (section: QuickFilterSection | null) => void;
}) {
  const total = countFilters(filters);
  return (
    <div
      role="group"
      aria-label={strings.libraryFilters.allFilters}
      className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <UpfrontChip
        label={strings.libraryFilters.occasions}
        count={filters.occasion.length}
        onClick={() => onOpen("occasion")}
      />
      <UpfrontChip
        label={strings.libraryFilters.bodyTypes}
        count={filters.body_type.length}
        onClick={() => onOpen("body_type")}
      />
      <UpfrontChip
        label={strings.libraryFilters.celebrity}
        count={filters.celebrity.length}
        onClick={() => onOpen("celebrity")}
      />
      {/* All filters — deliberately heavier than the category pills above */}
      <button
        type="button"
        onClick={() => onOpen(null)}
        className="flex shrink-0 items-center gap-1.5 rounded-pill border-2 border-ink-navy bg-warm-sand px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-navy shadow-card transition-all ease-brand active:scale-[0.97] active:shadow-brand"
      >
        <Tune size={14} className="text-draep-orange" />
        {strings.libraryFilters.allFilters}
        {total > 0 && (
          <span className="rounded-pill bg-draep-orange px-1.5 py-px text-[10px] font-semibold text-chalk-white">
            {total}
          </span>
        )}
      </button>
    </div>
  );
}

function UpfrontChip({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  const active = count > 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-caption font-semibold transition-all active:scale-[0.97] ${
        active
          ? "border-ink-navy bg-ink-navy text-chalk-white"
          : "border-hairline-strong bg-chalk-white text-ink-navy active:border-navy-interactive"
      }`}
    >
      {label}
      {active && (
        <span className="rounded-pill bg-draep-orange px-1.5 py-px text-[10px] font-semibold text-chalk-white">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Removable pills for every active selection, + Clear all. Catalogue
 * selections resolve their labels through the facets tree.
 */
function ActiveFilterChips({
  filters,
  facets,
  onRemove,
  onClearAll,
}: {
  filters: LibraryFilters;
  facets: LibraryFacetsOut | null;
  onRemove: (key: keyof LibraryFilters, value: string) => void;
  onClearAll: () => void;
}) {
  const labels = catalogLabelMap(facets);

  const active: { key: keyof LibraryFilters; value: string; label: string }[] = [
    ...filters.occasion.map((v) => ({ key: "occasion" as const, value: v, label: v })),
    ...filters.body_type.map((v) => ({ key: "body_type" as const, value: v, label: v })),
    ...filters.celebrity.map((v) => ({ key: "celebrity" as const, value: v, label: v })),
    ...filters.variation.map((v) => ({ key: "variation" as const, value: v, label: labels.get(v) ?? "Selection" })),
    ...filters.variation_type.map((v) => ({ key: "variation_type" as const, value: v, label: labels.get(v) ?? "Selection" })),
    ...filters.addon.map((v) => ({ key: "addon" as const, value: v, label: labels.get(v) ?? "Add-on" })),
    ...filters.addon_variation.map((v) => ({ key: "addon_variation" as const, value: v, label: labels.get(v) ?? "Add-on" })),
  ];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {active.map((a) => (
        <button
          key={`${a.key}:${a.value}`}
          type="button"
          onClick={() => onRemove(a.key, a.value)}
          className="flex items-center gap-1 rounded-pill border border-hairline bg-chalk-white px-2.5 py-1 text-[11px] font-medium text-ink-navy transition-all ease-brand active:scale-95 active:border-navy-interactive"
        >
          <span className="max-w-40 truncate">{a.label}</span>
          <Close size={10} className="shrink-0 text-muted" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="rounded-pill px-2 py-1 text-[11px] font-semibold text-draep-orange underline-offset-2 transition-opacity ease-brand active:opacity-60"
      >
        {strings.libraryFilters.clearAll}
      </button>
    </div>
  );
}

/** catalogue id → "Component: Variation" label, for the active-chip pills. */
function catalogLabelMap(facets: LibraryFacetsOut | null): Map<string, string> {
  const m = new Map<string, string>();
  if (!facets) return m;
  for (const c of facets.catalog.components) {
    for (const v of c.variations) {
      m.set(v.id, `${c.labels?.en ?? ""}: ${v.labels?.en ?? v.id}`);
      for (const t of v.types) {
        m.set(
          t.id,
          `${c.labels?.en ?? ""}: ${v.labels?.en ?? ""} — ${t.labels?.en ?? t.id}`,
        );
      }
    }
  }
  for (const a of facets.catalog.addons) {
    m.set(a.id, a.labels?.en ?? a.id);
    for (const av of a.variations) {
      m.set(av.id, `${a.labels?.en ?? ""}: ${av.labels?.en ?? av.id}`);
    }
  }
  return m;
}

/** Zero results WITH filters active — offer to clear them. */
function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Sparkle size={22} className="text-muted" />
      <div>
        <p className="text-body font-heading font-semibold text-ink-navy">
          {strings.libraryFilters.noMatches}
        </p>
        <p className="mt-1 text-caption text-muted">
          {strings.libraryFilters.noMatchesHint}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition-all ease-brand active:scale-[0.97] active:border-navy-interactive"
      >
        {strings.libraryFilters.clearFilters}
      </button>
    </div>
  );
}

/* ============================================================ */
/*  Loading + empty states                                       */
/* ============================================================ */

function GridSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card"
        >
          {/* Image zone */}
          <div className="relative aspect-[4/3] w-full animate-pulse bg-mist-navy">
            <div className="absolute left-3 top-3 h-5 w-16 animate-pulse rounded-pill bg-chalk-white/70" />
          </div>
          {/* Body zone */}
          <div className="space-y-2 p-3.5">
            <div className="h-3 w-1/3 animate-pulse rounded-pill bg-mist-navy" />
            <div className="h-4 w-3/4 animate-pulse rounded-pill bg-mist-navy" />
            <div className="flex gap-1.5 pt-1">
              <div className="h-5 w-16 animate-pulse rounded-pill bg-mist-navy" />
              <div className="h-5 w-14 animate-pulse rounded-pill bg-mist-navy" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="pb-4">
      <div className="-mx-4 mb-3 aspect-[4/5] w-[calc(100%+2rem)] animate-pulse bg-mist-navy" />
      <div className="mb-3 h-16 animate-pulse rounded-card bg-mist-navy" />
      <div className="mb-3 h-5 w-1/2 animate-pulse rounded-pill bg-mist-navy" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-card bg-mist-navy"
          />
        ))}
      </div>
    </div>
  );
}

function ListError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-body text-ink">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition-all ease-brand active:scale-[0.97] active:border-navy-interactive"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <Close size={20} className="text-muted" />
      <p className="text-body text-muted">{text}</p>
    </div>
  );
}

/* ============================================================ */
/*  Helpers                                                      */
/* ============================================================ */

function composeItemLabel(item: ResolvedItemOut): string {
  const en = (s: { label: Record<string, string> | null } | null) =>
    s?.label?.en ?? "";

  if (item.type === "variation") {
    const parts = [en(item.component), en(item.variation)].filter(Boolean);
    const sub = en(item.variation_type);
    if (sub) parts.push(sub);
    return parts.join(" · ") || "—";
  }

  const parts = [en(item.add_on), en(item.add_on_variation)].filter(Boolean);
  if (item.placement.length > 0) {
    parts.push(item.placement.join(", "));
  }
  return parts.join(" · ") || "—";
}

function groupItems(
  items: ResolvedItemOut[],
): { label: string; items: ResolvedItemOut[] }[] {
  const variations = items.filter((i) => i.type === "variation");
  const addons = items.filter((i) => i.type === "add_on");
  const groups: { label: string; items: ResolvedItemOut[] }[] = [];
  if (variations.length) groups.push({ label: "Structure", items: variations });
  if (addons.length) groups.push({ label: "Add-ons", items: addons });
  return groups;
}
