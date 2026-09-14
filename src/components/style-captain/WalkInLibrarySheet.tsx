"use client";

/**
 * WalkInLibrarySheet — "Choose from library" for the walk-in wizard.
 *
 * The customer /app/explore design library in a bottom sheet on the captain
 * dashboard: the captain scrolls the grid with the customer, taps a design,
 * and the preview sheet opens on top in APPEND mode — its apply CTA ("Add to
 * walk-in order") puts the reviewed design into the walk-in order through the
 * captain API. Nothing is created until apply; closing either sheet leaves
 * the order untouched.
 */

import { useCallback, useEffect, useState } from "react";

import { LibraryOrderPreviewSheet } from "@/components/library/LibraryOrderPreviewSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { listLibrary } from "@/lib/api/library";
import { formatPrice } from "@/lib/pricing";
import type { LibraryListItemOut } from "@/types/api";

const PAGE_LIMIT = 20;

export function WalkInLibrarySheet({
  open,
  onClose,
  order,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  /** Existing walk-in order, or the confirmed user (+ chosen address) when
   *  the order doesn't exist yet (the first added design creates it). */
  order:
    | { orderId: string }
    | { create: { userId: string; address: { addressId: string } | { newAddress: unknown } | null } };
  /** Fires after a design is added — with the order ids when it was the
   *  first garment (createdOrder: true). */
  onAdded: (r: {
    orderId: string;
    orderNumber: string | null;
    garmentOrderId: string;
    createdOrder: boolean;
  }) => void;
}) {
  const orderId = "orderId" in order ? order.orderId : null;
  const createIfMissing = "create" in order ? order.create : undefined;
  const [items, setItems] = useState<LibraryListItemOut[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await listLibrary({ limit: PAGE_LIMIT, cursor: cursor ?? undefined });
        setItems((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setNextCursor(res.next_cursor ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the library");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  // Fresh load each time the sheet opens.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="Design library">
        <p className="pb-3 text-caption text-muted">
          Browse Draep designs with the customer — tap one to review and add
          it to order.
        </p>

        {error && (
          <div className="mb-3 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-2 font-semibold underline"
            >
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-3 pb-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="aspect-[3/4] animate-pulse rounded-card bg-mist-navy/70"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 pb-4">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setSelectedId(it.id)}
                className="tap flex flex-col overflow-hidden rounded-card border border-hairline-strong bg-chalk-white text-left shadow-card transition hover:bg-mist-navy/10 active:scale-[0.99]"
              >
                <div className="relative aspect-[3/4] w-full bg-mist-navy">
                  {it.hero_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.hero_image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="font-heading text-h2 font-bold text-navy-interactive/25">
                        Design
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2.5">
                  <span className="line-clamp-2 text-body font-medium leading-tight text-ink">
                    {it.labels?.en ?? "Design"}
                  </span>
                  <span className="text-caption text-muted">
                    {formatPrice(it.price)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && nextCursor && (
          <Button
            fullWidth
            variant="secondary"
            loading={loadingMore}
            onClick={() => void load(nextCursor)}
          >
            Load more designs
          </Button>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="rounded-card border border-hairline bg-mist-navy/10 px-4 py-6 text-center text-caption text-muted">
            No designs in the library yet.
          </p>
        )}
      </BottomSheet>

      {/* Design review — append mode: apply adds it to the walk-in order. */}
      {selectedId && open && (
        <LibraryOrderPreviewSheet
          open
          onClose={() => setSelectedId(null)}
          libraryId={selectedId}
          appendToOrder={{
            orderId,
            ...(createIfMissing ? { createIfMissing } : {}),
            onAdded: (r) => {
              setSelectedId(null);
              onAdded(r);
            },
          }}
          applyLabel="Add to walk-in order"
        />
      )}
    </>
  );
}
