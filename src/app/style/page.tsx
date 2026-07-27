"use client";

/**
 * Style selection — the first screen after tapping the landing CTA.
 *
 * Split layout:
 *   Top 30%    → "Share your design preference" heading
 *                Primary CTA: "Upload your design" (orange button)
 *                Secondary CTA: "Build from scratch" (text-only link)
 *   --- dotted "or" divider ---
 *   Bottom 70% → scrollable grid of library designs (Design Library spec §A).
 *
 * Library flow:
 *   1. listLibrary()        → grid of cards (hero image + price + chips)
 *   2. Tap card             → getLibraryDetail() → BottomSheet (items + price)
 *   3. "Draft this design"  → draftFromLibrary() → hydrateFromLibraryOrder()
 *                              → router.replace("/review")
 *
 * Filters: horizontal category chips at the top of the grid. Tapping a chip
 * re-runs listLibrary() with the category param. The "All" chip clears it.
 *
 * Scroll-collapse: top section shrinks to a slim bar when the grid scrolls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Upload, ArrowLeft, Sparkle, Close } from "@/components/ui/icons";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { libraryApi } from "@/lib/api";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { DESIGN_ROUTES, REVIEW_ROUTE } from "@/lib/routing";
import type {
  LibraryDetailOut,
  LibraryListItemOut,
  ResolvedItemOut,
} from "@/types/api";

/* ─── Category filter chips ──────────────────────────────────────────────── */
//
// These mirror the `category` column on the BE design_libraries table. The
// list is intentionally static — the catalog grows slowly and we don't want
// a /filters endpoint for V0.
const CATEGORIES = ["bridal", "festive", "contemporary", "classical"] as const;
type CategoryFilter = (typeof CATEGORIES)[number] | "all";

/* ============================================================ */

export default function StylePage() {
  const router = useRouter();
  const hydrateFromLibraryOrder = useBookingStore((s) => s.hydrateFromLibraryOrder);
  const initDraft = useBookingStore((s) => s.initDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Library list state
  const [items, setItems] = useState<LibraryListItemOut[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryFilter>("all");

  // Detail sheet state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryDetailOut | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Draft action state — "Draft this design" button
  const [draftingId, setDraftingId] = useState<string | null>(null);

  /* ── IntersectionObserver: collapse header when sentinel scrolls out ─── */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  /* ── Initial fetch + refetch on category change ─────────────────────── */
  const fetchFirstPage = useCallback(
    async (cat: CategoryFilter) => {
      setListLoading(true);
      setListError(null);
      try {
        const out = await libraryApi.listLibrary({
          limit: 24,
          category: cat === "all" ? undefined : [cat],
        });
        setItems(out.items);
        setNextCursor(out.next_cursor);
      } catch (err) {
        setListError(
          err instanceof Error ? err.message : strings.style.loadError,
        );
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchFirstPage(category);
  }, [category, fetchFirstPage]);

  /* ── Infinite scroll: fetch next page when loader enters viewport ───── */
  const fetchNextPage = useCallback(async () => {
    if (!nextCursor || listLoading) return;
    const cursor = nextCursor;
    try {
      const out = await libraryApi.listLibrary({
        limit: 24,
        cursor,
        category: category === "all" ? undefined : [category],
      });
      setItems((prev) => [...prev, ...out.items]);
      setNextCursor(out.next_cursor);
    } catch {
      // Best effort — keep what we have; user can retry by scrolling.
    }
  }, [nextCursor, listLoading, category]);

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

  /* ── CTAs (Upload + Build from scratch) ─────────────────────────────── */
  const handleBuildFromScratch = useCallback(async () => {
    await clearDraft();
    await initDraft();
    track({ event: "landing_cta_tapped", resumed: false });
    router.push(DESIGN_ROUTES[0]);
  }, [clearDraft, initDraft, router]);

  const handleUpload = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await clearDraft();
    await initDraft();
    track({ event: "landing_cta_tapped", resumed: false });
    router.replace(REVIEW_ROUTE);
  };

  /* ── Open detail sheet on card tap ──────────────────────────────────── */
  const openDetail = useCallback((id: string) => {
    setDetailId(id);
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    track({ event: "library_card_tapped", library_id: id });
  }, []);

  /* ── Fetch detail whenever the sheet opens for a new id ─────────────── */
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
    // Defer clearing so the BottomSheet exit animation runs smoothly.
    setTimeout(() => {
      setDetailId(null);
      setDetail(null);
      setDetailError(null);
    }, 250);
  }, []);

  /* ── Draft this design → hydrate FE state → navigate to /review ─────── */
  const handleDraft = useCallback(
    async (libraryId: string) => {
      setDraftingId(libraryId);
      try {
        const { order } = await libraryApi.draftFromLibrary(libraryId);
        await hydrateFromLibraryOrder(order);
        track({ event: "library_drafted", library_id: libraryId });
        closeDetail();
        router.replace(REVIEW_ROUTE);
      } catch (err) {
        setDetailError(
          err instanceof Error ? err.message : strings.style.detailError,
        );
      } finally {
        setDraftingId(null);
      }
    },
    [hydrateFromLibraryOrder, router, closeDetail],
  );

  const handleBack = () => router.push("/");

  return (
    <div className="column flex h-dvh flex-col bg-warm-sand">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ───── Top section (30% → collapses to slim bar) ─────
          Brand Book hero: Ink Navy surface, tape-gradient halo, orange badge. */}
      <header
        className="relative flex flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white transition-[height] duration-300 ease-brand"
        style={{ height: collapsed ? 36 : "30dvh" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-md"
          style={{ background: "var(--tape-gradient)" }}
        />

        <button
          type="button"
          onClick={handleBack}
          className="absolute left-3 top-2 z-10 flex items-center gap-1 rounded-pill bg-chalk-white px-2.5 py-1.5 text-caption font-medium text-ink-navy shadow-card transition-colors hover:bg-mist-navy"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        {!collapsed && (
          <div className="relative z-10 flex flex-col items-center gap-3 px-4 pb-4">
            <div className="text-center">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-chalk-white/15 px-3 py-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-chalk-white backdrop-blur-sm">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-tape" />
                {strings.style.subheading}
              </span>
              <h1 className="mt-2 font-heading text-h1 font-semibold text-chalk-white">
                {strings.style.topHeading}
              </h1>
            </div>
            <button
              type="button"
              onClick={handleUpload}
              className="flex w-full max-w-[280px] items-center justify-center gap-2 rounded-pill bg-tape px-5 py-3 font-heading text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98] active:bg-ember active:bg-none"
            >
              <Upload size={18} />
              {strings.style.uploadCta}
            </button>
            <button
              type="button"
              onClick={handleBuildFromScratch}
              className="text-caption font-medium text-chalk-white/80 underline-offset-2 transition-colors hover:text-chalk-white hover:underline"
            >
              {strings.style.buildCta}
            </button>
          </div>
        )}
      </header>

      {/* ───── Dashed "or" divider ───── */}
      {!collapsed && (
        <div className="relative flex flex-none items-center justify-center py-2">
          <div className="h-px flex-1 border-t border-dashed border-tape-silver" />
          <span className="mx-3 font-mono text-caption text-muted">
            {strings.style.or}
          </span>
          <div className="h-px flex-1 border-t border-dashed border-tape-silver" />
        </div>
      )}

      {/* ───── Bottom section (70% — library grid) ───── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={sentinelRef} className="h-px w-full" aria-hidden />

        {/* Section header + filter chips */}
        <div className="px-4 pt-1">
          <h2 className="font-heading text-h3 font-semibold text-ink-navy">
            {strings.style.libraryHeading}
          </h2>
          <p className="mt-0.5 text-caption text-muted">
            {strings.style.librarySubheading}
          </p>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Chip
              selected={category === "all"}
              onClick={() => setCategory("all")}
            >
              {strings.style.filterAll}
            </Chip>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                selected={category === c}
                onClick={() => setCategory(c)}
                className="capitalize"
              >
                {c}
              </Chip>
            ))}
          </div>
        </div>

        {/* Grid body */}
        <div className="px-4 pt-3">
          {listLoading && items.length === 0 ? (
            <GridSkeleton />
          ) : listError ? (
            <ListError message={listError} onRetry={() => fetchFirstPage(category)} />
          ) : items.length === 0 ? (
            <EmptyState text={strings.style.emptyLibrary} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {items.map((it) => (
                <LibraryCard key={it.id} item={it} onSelect={() => openDetail(it.id)} />
              ))}
            </div>
          )}

          {/* Infinite scroll loader — fires when in viewport */}
          <div ref={loaderRef} className="h-1" aria-hidden />
          {nextCursor && listLoading && items.length > 0 && (
            <div className="flex items-center justify-center py-4">
              <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
                <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
              </div>
            </div>
          )}
        </div>

        <div className="h-6" />
      </div>

      {/* ───── Detail BottomSheet ───── */}
      <BottomSheet
        open={detailOpen}
        onClose={closeDetail}
        title={
          detail?.labels?.en ?? strings.style.detailLoading
        }
        footer={
          detail ? (
            <DraftFooter
              detail={detail}
              drafting={draftingId === detail.id}
              onDraft={() => handleDraft(detail.id)}
            />
          ) : null
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
    </div>
  );
}

/* ============================================================ */
/*  Subcomponents                                                */
/* ============================================================ */

/** Library grid card — hero image, price, category + occasion chips. */
function LibraryCard({
  item,
  onSelect,
}: {
  item: LibraryListItemOut;
  onSelect: () => void;
}) {
  const title = item.labels?.en ?? "Untitled design";
  const occasions = (item.occasions ?? []).slice(0, 2);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white text-left transition-all hover:border-navy-interactive hover:shadow-card active:scale-[0.98]"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-mist-navy">
        {item.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.hero_image_url}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <Sparkle size={28} />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        {/* Category + price row — clean, off the image */}
        <div className="flex items-center justify-between gap-2">
          {item.category ? (
            <span className="rounded-pill bg-warm-sand px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-navy">
              {item.category}
            </span>
          ) : (
            <span />
          )}
          <span className="font-mono text-caption font-semibold text-ink-navy">
            {strings.style.fromPrice(item.price)}
          </span>
        </div>
        <p className="line-clamp-1 text-body font-medium text-ink-navy">
          {title}
        </p>
        {occasions.length > 0 && (
          <p className="line-clamp-1 text-caption text-muted">
            {occasions.join(" · ")}
          </p>
        )}
      </div>
    </button>
  );
}

/** Detail sheet body — hero, celebrity note, grouped design items, styling notes. */
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

      {/* Fullscreen zoom overlay — dismiss on backdrop / ✕ click */}
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

      {/* Design items — grouped */}
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

/** One line inside an item group — label + optional price. */
function ItemRow({ item }: { item: ResolvedItemOut }) {
  const label = composeItemLabel(item);
  const priceLabel =
    item.price == null
      ? null
      : item.price === 0
        ? "Included"
        : `+ ${strings.style.fromPrice(item.price)}`;

  return (
    <li className="flex items-baseline justify-between gap-3 text-body">
      <span className="text-ink">{label}</span>
      {priceLabel && (
        <span className="font-mono text-caption text-muted">{priceLabel}</span>
      )}
    </li>
  );
}

/** Sticky footer on the detail sheet — total + Draft CTA. */
function DraftFooter({
  detail,
  drafting,
  onDraft,
}: {
  detail: LibraryDetailOut;
  drafting: boolean;
  onDraft: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-caption text-muted">Total</p>
        <p className="font-heading text-h2 font-semibold text-ink-navy">
          {strings.style.fromPrice(detail.price)}
        </p>
      </div>
      <button
        type="button"
        onClick={onDraft}
        disabled={drafting}
        className="flex items-center gap-2 rounded-pill bg-tape px-5 py-3 font-heading text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98] active:bg-ember active:bg-none disabled:opacity-60"
      >
        {drafting ? strings.style.drafting : strings.style.startFromThis}
      </button>
    </div>
  );
}

/* ============================================================ */
/*  Loading + empty states                                       */
/* ============================================================ */

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-card border border-hairline bg-chalk-white"
        >
          <div className="aspect-[4/5] w-full animate-pulse bg-mist-navy" />
          <div className="space-y-1.5 px-3 py-2">
            <div className="h-3 w-3/4 animate-pulse rounded-pill bg-mist-navy" />
            <div className="h-2.5 w-1/2 animate-pulse rounded-pill bg-mist-navy" />
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
        className="rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition-colors hover:border-navy-interactive"
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

/**
 * Compose a human label from a flat ResolvedItemOut.
 *
 * Examples:
 *   variation:  "Front neck · Round"
 *   variation_type: "Front neck · Round · Deep"
 *   add_on:     "Piping"
 *   add_on + variation: "Lining · Full"
 *   add_on + placement: "Latkan · Back neck"
 */
function composeItemLabel(item: ResolvedItemOut): string {
  const en = (s: { label: Record<string, string> | null } | null) =>
    s?.label?.en ?? "";

  if (item.type === "variation") {
    const parts = [en(item.component), en(item.variation)].filter(Boolean);
    const sub = en(item.variation_type);
    if (sub) parts.push(sub);
    return parts.join(" · ") || "—";
  }

  // add_on
  const parts = [en(item.add_on), en(item.add_on_variation)].filter(Boolean);
  if (item.placement.length > 0) {
    parts.push(item.placement.join(", "));
  }
  return parts.join(" · ") || "—";
}

/**
 * Group resolved items into two buckets — "Structure" (variations) and
 * "Add-ons" — to match the review screen's grouping convention.
 */
function groupItems(
  items: ResolvedItemOut[],
): { label: string; items: ResolvedItemOut[] }[] {
  const variations = items.filter((i) => i.type === "variation");
  const addons = items.filter((i) => i.type === "add_on");
  const groups: { label: string; items: ResolvedItemOut[] }[] = [];
  if (variations.length) {
    groups.push({ label: "Structure", items: variations });
  }
  if (addons.length) {
    groups.push({ label: "Add-ons", items: addons });
  }
  return groups;
}
