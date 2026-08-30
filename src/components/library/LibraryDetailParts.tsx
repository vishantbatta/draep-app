"use client";

/**
 * Library detail parts — shared by the full-page detail view
 * (LibraryDetailPage) and any other surface that renders a design detail.
 * Extracted from LibraryBrowser when the detail sheet became a full page.
 */

import { useState } from "react";

import { Calendar, Sparkle, Sparkles } from "@/components/ui/icons";
import { strings } from "@/lib/strings";
import type {
  LibraryDetailOut,
  ResolvedItemOut,
} from "@/types/api";

export function DetailBody({ detail }: { detail: LibraryDetailOut }) {
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

      {/* Ideal for (body shapes) + Worn on (occasions) — the same labels
          the Explore filters use, presented as labeled chip groups */}
      {((detail.ideal_body_types?.length ?? 0) > 0 ||
        (detail.occasions?.length ?? 0) > 0) && (
        <div className="mb-3 rounded-card border border-hairline bg-chalk-white p-3">
          {(detail.ideal_body_types?.length ?? 0) > 0 && (
            <div className={detail.occasions?.length ? "pb-3" : ""}>
              <p className="flex items-center gap-1.5 font-mono text-eyebrow uppercase tracking-wider text-muted">
                <Sparkle size={12} />
                Ideal for
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(detail.ideal_body_types ?? []).map((t) => (
                  <span
                    key={`bt-${t}`}
                    className="rounded-pill bg-mist-navy px-2.5 py-1 text-caption font-medium text-ink-navy"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(detail.occasions?.length ?? 0) > 0 && (
            <div
              className={
                (detail.ideal_body_types?.length ?? 0) > 0
                  ? "border-t border-hairline pt-3"
                  : ""
              }
            >
              <p className="flex items-center gap-1.5 font-mono text-eyebrow uppercase tracking-wider text-muted">
                <Calendar size={12} />
                Occasions
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(detail.occasions ?? []).map((o) => (
                  <span
                    key={`oc-${o}`}
                    className="rounded-pill bg-warm-sand px-2.5 py-1 text-caption text-ink"
                  >
                    {o}
                  </span>
                ))}
              </div>
            </div>
          )}
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


/**
 * Sticky footer CTAs for the design detail sheet. "Order now" is the primary
 * (tape-gradient pill — the only gradient CTA per Brand Book §8) and opens
 * the "Review your selection" editor (creation happens there); "Try it on"
 * is the secondary outline pill. Both are login-gated by the caller
 * (LoginGateSheet) before firing.
 */
export function DetailFooter({
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


export function DetailSkeleton() {
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


export function ListError({
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
