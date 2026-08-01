"use client";

/**
 * /library — read-only gallery of every design in the library.
 *
 * Mirrors /style exactly minus:
 *   • No CTAs (Upload / Build from scratch / Draft this design)
 *   • No prices on cards or in the detail sheet
 *   • No back button (relies on browser history)
 *
 * Layout: collapsed header → infinite-scroll grid → detail sheet.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Sparkle, Sparkles, Close, ChevronRight } from "@/components/ui/icons";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TryOnSheet } from "@/components/tryon/TryOnSheet";
import { libraryApi } from "@/lib/api";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type {
  LibraryDetailOut,
  LibraryListItemOut,
  ResolvedItemOut,
} from "@/types/api";

/* ============================================================ */

export default function LibraryPage() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  /* ── Library list state ─────────────────────────────────────────────── */
  const [items, setItems] = useState<LibraryListItemOut[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

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

  /* ── IntersectionObserver: collapse header when sentinel scrolls out ─ */
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

  /* ── Initial fetch ─────────────────────────────────────────────────── */
  const fetchFirstPage = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const out = await libraryApi.listLibrary({ limit: 24 });
      setItems(out.items);
      setNextCursor(out.next_cursor);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : strings.style.loadError,
      );
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage]);

  /* ── Infinite scroll: fetch next page when loader enters viewport ──── */
  const fetchNextPage = useCallback(async () => {
    if (!nextCursor || listLoading) return;
    const cursor = nextCursor;
    try {
      const out = await libraryApi.listLibrary({ limit: 24, cursor });
      setItems((prev) => [...prev, ...out.items]);
      setNextCursor(out.next_cursor);
    } catch {
      // Best effort — keep what we have; user can retry by scrolling.
    }
  }, [nextCursor, listLoading]);

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

  /* ── Open the try-on sheet using the current detail's hero image ──── */
  // We close the detail sheet visually but KEEP `detailId` / `detail` so that
  // when the user taps Done on the try-on result we can reopen the exact same
  // design sheet without a refetch.
  const openTryOn = useCallback(() => {
    if (!detail?.hero_image_url) return;
    setTryOnDesignUrl(detail.hero_image_url);
    setTryOnDesignTitle(detail.labels?.en ?? undefined);
    setDetailOpen(false);
    setTimeout(() => setTryOnOpen(true), 220);
  }, [detail]);

  const closeTryOn = useCallback(() => {
    setTryOnOpen(false);
    setTimeout(() => {
      setTryOnDesignUrl(null);
      setTryOnDesignTitle(undefined);
    }, 250);
  }, []);

  /* ── Done from try-on: reopen the design detail sheet that launched it ── */
  const onTryOnDone = useCallback(() => {
    setTryOnOpen(false);
    setTimeout(() => {
      setTryOnDesignUrl(null);
      setTryOnDesignTitle(undefined);
      // Reopen the detail sheet if we still have it in context.
      if (detailId) setDetailOpen(true);
    }, 220);
  }, [detailId]);

  return (
    <div className="column flex h-dvh flex-col bg-warm-sand">
      {/* ───── Slim header (collapses to a slimmer bar on scroll) ───── */}
      <header
        className="relative flex flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white transition-[height] duration-300 ease-brand"
        style={{ height: collapsed ? 36 : "30dvh" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-md"
          style={{ background: "var(--tape-gradient)" }}
        />

        {!collapsed && (
          <div className="relative z-10 flex flex-col items-center gap-2 px-4 pb-6">
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
        )}

        {/* Tape-gradient seam with tick overlay — Brand Book §6 (the tape) */}
        <div aria-hidden className="lp-tape-strip absolute inset-x-0 bottom-0 z-10" />
      </header>

      {/* ───── Bottom section (library grid) ───── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={sentinelRef} className="h-px w-full" aria-hidden />

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

        {/* Grid body — one full-bleed hero row per design */}
        <div className="px-4 pt-4">
          {listLoading && items.length === 0 ? (
            <GridSkeleton />
          ) : listError ? (
            <ListError
              message={listError}
              onRetry={() => fetchFirstPage()}
            />
          ) : items.length === 0 ? (
            <EmptyState text={strings.style.emptyLibrary} />
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

          {/* Infinite scroll loader — tape-gradient sliver */}
          <div ref={loaderRef} className="h-1" aria-hidden />
          {nextCursor && listLoading && items.length > 0 && (
            <div className="flex items-center justify-center py-5">
              <div
                aria-hidden
                className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver"
              >
                <div className="h-full w-1/2 animate-pulse bg-tape" />
              </div>
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
            <TryOnFooter
              disabled={!detail?.hero_image_url}
              onClick={openTryOn}
            />
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

      {/* ───── Virtual Try-On sheet ───── */}
      {tryOnDesignUrl && (
        <TryOnSheet
          open={tryOnOpen}
          onClose={closeTryOn}
          onDone={onTryOnDone}
          designImageUrl={tryOnDesignUrl}
          designTitle={tryOnDesignTitle}
          garmentId={detail?.garment_id ?? undefined}
        />
      )}
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

/** Sticky footer CTA that opens the virtual try-on sheet. */
function TryOnFooter({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center justify-center gap-2 rounded-pill bg-tape px-5 py-3 text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
      style={{ backgroundImage: "var(--tape-gradient)" }}
    >
      {/* Animated sparkles */}
      <span className="relative inline-flex">
        <Sparkles size={16} className="text-chalk-white" />
        <span
          aria-hidden
          className="absolute inset-0 animate-rivet text-chalk-white"
        >
          <Sparkles size={16} />
        </span>
      </span>
      {strings.tryOn.cta}
    </button>
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
      className="group flex w-full flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white text-left shadow-card transition-all ease-brand hover:-translate-y-0.5 hover:shadow-brand active:scale-[0.99]"
    >
      {/* ── Image zone — hugs the photo's own aspect ratio ────── */}
      <div className="relative w-full overflow-hidden bg-mist-navy">
        {item.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.hero_image_url}
            alt={title}
            loading="lazy"
            className="relative block h-auto w-full object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.03]"
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
        <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-chalk-white/90 text-ink-navy shadow-card transition-colors group-hover:bg-chalk-white">
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
