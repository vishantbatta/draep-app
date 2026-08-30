"use client";

/**
 * LibraryBrowser — read-only gallery of every design in the library.
 *
 * Shared surface: /library renders it full-viewport; the /app Explore tab
 * renders it inside the tabbed shell (root is h-full — the host provides
 * the height).
 *
 * Mirrors /style exactly minus:
 *   • Card tap navigates to the full-page detail view
 *     (/app/explore/[libraryId] — like the create flow) instead of opening
 *     a sheet; order / try-on flows live on that page.
 *   • No prices on cards
 *
 * Layout: collapsed header → infinite-scroll grid.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Sparkle, Sparkles, Close, ChevronRight, Tune } from "@/components/ui/icons";
import {
  EMPTY_FILTERS,
  FilterSheet,
  countFilters,
  isEmptyFilters,
  type LibraryFilters,
  type QuickFilterSection,
} from "@/components/library/FilterSheet";
import { libraryApi } from "@/lib/api";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { ListError } from "@/components/library/LibraryDetailParts";
import type {
  LibraryFacetsOut,
  LibraryListItemOut,
} from "@/types/api";

/* ============================================================ */

/* Slim navy bar the header settles into once fully collapsed (px). */
const HEADER_COLLAPSED_PX = 36;
/* Expanded height lives here too so the scroll handler can restore it
 * verbatim when the list returns to the top (clearing the inline style
 * would fall back to auto, losing the dvh sizing). */
const HEADER_EXPANDED_H = "30dvh";

export function LibraryBrowser() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const headerContentRef = useRef<HTMLDivElement>(null);
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

  /* ── Card tap → full-page detail (like the create flow) ───────────── */
  const openDetail = useCallback((id: string) => {
    track({ event: "library_card_tapped", library_id: id });
    router.push(`/app/explore/${id}`);
  }, [router]);

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
