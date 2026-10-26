"use client";

/**
 * GarmentPicker — one card per enabled garment (image, name, description,
 * starting price). Step 0 of /app/create when the catalogue offers a choice,
 * and auto-design's fallback when the photos didn't settle the garment.
 */

import { Button } from "@/components/ui/Button";
import { ChevronRight, Sparkles } from "@/components/ui/icons";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import type { GarmentListItem } from "@/types/api";

export function garmentLabel(g: GarmentListItem): string {
  return g.labels?.en ?? Object.values(g.labels ?? {})[0] ?? g.slug ?? g.id;
}

export function GarmentPicker({
  garments,
  error,
  onRetry,
  onPick,
}: {
  garments: GarmentListItem[] | null;
  error: string | null;
  onRetry: () => void;
  onPick: (g: GarmentListItem) => void;
}) {
  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-column flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body text-muted">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          {strings.myod.pickerRetry}
        </Button>
      </div>
    );
  }
  if (!garments) {
    return (
      <p className="px-4 py-10 text-center text-body text-muted">
        {strings.myod.loadingTree}
      </p>
    );
  }
  if (garments.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-body text-muted">
        {strings.myod.pickerEmpty}
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-3 px-4 pb-6">
      {garments.map((g) => {
        const label = garmentLabel(g);
        const desc =
          g.descriptions?.en ??
          Object.values(g.descriptions ?? {})[0] ??
          null;
        const img = g.asset_urls?.[0] ?? null;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onPick(g)}
            className="group flex w-full items-center gap-3.5 overflow-hidden rounded-card border border-hairline bg-chalk-white p-3 text-left shadow-card transition-all ease-brand active:scale-[0.99] active:shadow-brand"
          >
            <div className="h-28 w-28 flex-none overflow-hidden rounded-card bg-mist-navy">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img}
                  alt={label}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-muted"
                  style={{ backgroundImage: "linear-gradient(135deg,#EAF0F8,#FFF6EA)" }}
                >
                  <Sparkles size={26} />
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 self-stretch py-0.5">
              <p className="font-heading text-[15px] font-semibold leading-snug text-ink-navy">
                {label}
              </p>
              {desc && (
                <p className="line-clamp-3 text-[12.5px] leading-snug text-muted">
                  {desc}
                </p>
              )}
              {g.base_price != null && (
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <span className="rounded-pill bg-warm-sand px-2 py-0.5 text-[11px] font-medium text-ink-navy">
                    {strings.myod.pickerFromPrice} {formatPrice(g.base_price)}
                  </span>
                </div>
              )}
            </div>
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-warm-sand text-ink-navy transition-transform ease-brand active:scale-90">
              <ChevronRight size={14} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
