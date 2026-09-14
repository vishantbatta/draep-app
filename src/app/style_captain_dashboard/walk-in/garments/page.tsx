"use client";

/**
 * /style_captain_dashboard/walk-in/garments — garment cards + library.
 *
 * Pre-order (?order= absent): the draft store carries the confirmed user +
 * address choice; the FIRST finished garment (configurator Done or a library
 * design) creates the pending order in one call and navigates to /review.
 * With ?order=: garments append to the existing order; `?edit=<goid>` opens
 * the configurator straight in edit mode (the review screen's Edit link).
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { WalkInConfigurator } from "@/components/style-captain/WalkInConfigurator";
import { WalkInLibrarySheet } from "@/components/style-captain/WalkInLibrarySheet";
import { ArrowLeft } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { listGarments } from "@/lib/api/catalog";
import { formatPrice } from "@/lib/pricing";
import { garmentName } from "@/lib/sc-helpers";
import { useWalkInDraft } from "@/lib/walkin-draft-store";
import {
  scWalkInOrderSnapshot,
  type SCWalkInOrderSnapshot,
} from "@/lib/style-captain-api";
import type { GarmentListItem } from "@/types/api";

const bannerCls =
  "rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text";

function GarmentsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draft = useWalkInDraft();

  const orderId = searchParams.get("order");
  const editGoid = searchParams.get("edit");

  const [catalogue, setCatalogue] = useState<GarmentListItem[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SCWalkInOrderSnapshot | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [configureGid, setConfigureGid] = useState<string | null>(null);
  const [editingGoid, setEditingGoid] = useState<string | null>(editGoid);
  const [pageError, setPageError] = useState<string | null>(null);

  // Pre-order with no draft (direct load / refresh) → front door.
  useEffect(() => {
    if (!orderId && !draft.userId) {
      router.replace("/style_captain_dashboard/walk-in");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, draft.userId]);

  // Catalogue — public list carries asset_urls + base_price for the cards.
  useEffect(() => {
    let cancelled = false;
    listGarments()
      .then((res) => {
        if (!cancelled) setCatalogue(res.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalogueError(err instanceof Error ? err.message : "Could not load the catalogue");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSnapshot = useCallback(async (id: string) => {
    try {
      const snap = await scWalkInOrderSnapshot(id);
      setSnapshot(snap);
      return snap;
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not refresh the order");
      return null;
    }
  }, []);

  // Existing order → snapshot (garment list, review readiness).
  useEffect(() => {
    if (orderId) void refreshSnapshot(orderId);
  }, [orderId, refreshSnapshot]);

  const hasGarments = (snapshot?.garments.length ?? 0) > 0;

  /** Configurator Done — first garment creates the order; navigate to review. */
  const handleConfigDone = useCallback(
    (created?: { orderId: string; orderNumber: string }) => {
      setConfigureGid(null);
      setEditingGoid(null);
      if (created) {
        draft.setOrderId(created.orderId);
        router.push(
          `/style_captain_dashboard/walk-in/review?order=${encodeURIComponent(created.orderId)}`,
        );
        return;
      }
      if (orderId) {
        void refreshSnapshot(orderId);
        router.push(
          `/style_captain_dashboard/walk-in/review?order=${encodeURIComponent(orderId)}`,
        );
      } else {
        router.back();
      }
    },
    [orderId, draft, router, refreshSnapshot],
  );

  const handleConfigCancel = useCallback(() => {
    setConfigureGid(null);
    setEditingGoid(null);
  }, []);

  const handleLibraryAdded = useCallback(
    (r: { orderId: string; createdOrder: boolean }) => {
      setLibraryOpen(false);
      if (r.createdOrder) {
        draft.setOrderId(r.orderId);
        router.push(
          `/style_captain_dashboard/walk-in/review?order=${encodeURIComponent(r.orderId)}`,
        );
        return;
      }
      if (orderId) void refreshSnapshot(orderId);
    },
    [orderId, draft, router, refreshSnapshot],
  );

  const editingGarment = editingGoid
    ? (snapshot?.garments.find((g) => g.garment_order_id === editingGoid) ?? null)
    : null;

  const orderContext = orderId
    ? { orderId }
    : draft.userId
      ? { create: { userId: draft.userId, address: draft.addressChoice } }
      : undefined;

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() =>
            orderId
              ? router.push(
                  `/style_captain_dashboard/walk-in/review?order=${encodeURIComponent(orderId)}`,
                )
              : router.back()
          }
          aria-label="Go back"
          className="rounded-full border border-hairline-strong bg-chalk-white p-2 text-ink transition hover:bg-mist-navy/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <div className="text-eyebrow text-accent-text">Walk-in</div>
          <h1 className="font-heading text-head-3 text-ink">Choose a garment</h1>
        </div>
      </div>

      {pageError && <div className={`mb-4 ${bannerCls}`}>{pageError}</div>}

      <div className="space-y-4">
        {orderId ? (
          <div className="text-caption text-muted">
            Add to order {snapshot?.order_number ?? ""} — tap a garment to configure it
            with the customer; it&apos;s saved when you finish.
          </div>
        ) : (
          <div className="text-caption text-muted">
            Tap a garment the customer wants — you&apos;ll configure it together
            step by step. The order is created (pending) with your first
            finished garment; nothing is saved before that.
          </div>
        )}
        {catalogueError && <div className={bannerCls}>{catalogueError}</div>}
        {catalogue.length === 0 && !catalogueError && (
          <div className="rounded-card border border-hairline bg-mist-navy/10 px-4 py-6 text-center text-caption text-muted">
            Loading garments…
          </div>
        )}
        {/* Photo cards — same shape as the customer /create garment grid. */}
        <div className="grid grid-cols-2 gap-3">
          {catalogue.map((g) => (
            <button
              key={g.id}
              onClick={() => setConfigureGid(g.id)}
              className="tap flex flex-col overflow-hidden rounded-card border border-hairline-strong bg-chalk-white text-left transition hover:bg-mist-navy/10"
            >
              <div className="relative aspect-square w-full bg-mist-navy">
                {g.asset_urls?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.asset_urls[0]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="font-heading text-h2 font-bold text-navy-interactive/25">
                      {garmentName(g).charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="text-body font-medium leading-tight text-ink">
                  {garmentName(g)}
                </span>
                {g.base_price != null && (
                  <span className="text-caption text-muted">
                    From {formatPrice(g.base_price)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
        {orderId && hasGarments && (
          <Button
            fullWidth
            variant="secondary"
            onClick={() =>
              router.push(
                `/style_captain_dashboard/walk-in/review?order=${encodeURIComponent(orderId)}`,
              )
            }
          >
            Review order
          </Button>
        )}
        <Button fullWidth variant="secondary" onClick={() => setLibraryOpen(true)}>
          Choose from library
        </Button>
      </div>

      {/* Configure a fresh garment (sheet) — nothing server-side until Done. */}
      {configureGid && orderContext && (
        <WalkInConfigurator
          garmentId={configureGid}
          order={orderContext}
          onClose={handleConfigCancel}
          onDone={handleConfigDone}
        />
      )}

      {/* Edit a saved garment (sheet) — seeded from the snapshot rows. */}
      {editingGarment?.garment_id && (
        <WalkInConfigurator
          garmentId={editingGarment.garment_id}
          garmentOrderId={editingGarment.garment_order_id}
          selections={editingGarment.selections}
          availableAddons={editingGarment.available_addons}
          onClose={handleConfigCancel}
          onDone={handleConfigDone}
        />
      )}

      {/* Design library — first design creates the order, later ones append. */}
      {orderContext && (
        <WalkInLibrarySheet
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          order={orderContext}
          onAdded={handleLibraryAdded}
        />
      )}
    </div>
  );
}

export default function WalkInGarmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 py-10 text-center text-caption text-muted">
          Loading…
        </div>
      }
    >
      <GarmentsScreen />
    </Suspense>
  );
}
