"use client";

/**
 * LibraryOrderPreviewSheet — the "Review your selection" step between
 * "Order now" (library detail sheet / try-on result) and the PENDING order.
 *
 * It IS the order page's edit-selections sheet — the same
 * GarmentSelectionSheet the admin dashboard and /app/orders/{id} use — run
 * in draft mode: the customer can tweak any selection or add-on against the
 * live catalog, then the apply CTA (labelled "Order now") creates the order.
 *
 * Creation sequence on apply: POST /library/{id}/order seeds the order with
 * the design's defaults, then the desired-vs-seed diff is written through
 * the same customer selection endpoints the order page's editor uses
 * (updateSelection / upsertAddon / resetSelection / removeAddon), then the
 * customer is routed into visit booking. The order page's own editor stays
 * available for later changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  GarmentSelectionSheet,
  type DraftItem,
  type SelectionSeedItem,
} from "@/components/admin/GarmentSelectionSheet";
import { ExistingOrderChoiceSheet } from "@/components/order/ExistingOrderChoiceSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { orderFromLibrary, getLibraryDetail } from "@/lib/api/library";
import { ordersApi } from "@/lib/api";
import { addGarmentToOrder, listOpenOrders } from "@/lib/api/orders";
import { useAuthStore } from "@/lib/auth-store";
import { strings } from "@/lib/strings";
import type { LibraryDetailOut, OpenOrder } from "@/types/api";

/**
 * Ceiling (ms) on how long "Add to this order" waits for the tweak calls
 * before redirecting anyway. The append is the step that counts — a flaky
 * dev-proxy hop mid-tweak-chain must not strand the user on a spinner when
 * the backend already added the garment.
 */
const TWEAK_APPLY_BUDGET_MS = 6_000;

interface Props {
  open: boolean;
  onClose: () => void;
  libraryId: string | null;
  /** Already-loaded design (the library detail sheet's copy) — skips the fetch. */
  initialDetail?: LibraryDetailOut | null;
  /**
   * Fires once the PENDING order exists (before the tweaks are applied) —
   * the caller's order-scoped extras: analytics, the try-on photo upload.
   * Failures are swallowed by this sheet; extras are best-effort.
   */
  onCreated?: (orderId: string, garmentOrderId: string | null) => void;
}

export function LibraryOrderPreviewSheet({
  open,
  onClose,
  libraryId,
  initialDetail,
  onCreated,
}: Props) {
  const router = useRouter();
  const sessionType = useAuthStore((s) => s.sessionType);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const isLoggedIn = sessionType === "user";

  const [detail, setDetail] = useState<LibraryDetailOut | null>(
    initialDetail ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Add-to-existing choice sheet state — populated when the confirm-time
  // open-orders check finds merge targets.
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [adding, setAdding] = useState(false);
  // applyDraft() calls onDraftChange then onClose() in the same tick — a ref
  // (not state) is the only way onClose sees "busy" and swallows the close,
  // keeping the sheet (and the user's tweaks) on screen while the order is
  // created. It also single-flights re-taps of the apply CTA.
  const creatingRef = useRef(false);
  const addingRef = useRef(false);
  const lastDesiredRef = useRef<DraftItem[] | null>(null);
  // The order the last append targeted — routes the error toast's Retry back
  // to the add (not to a fresh create) when an append fails.
  const lastAddTargetRef = useRef<string | null>(null);

  // Load the design on open. The library path hands us its loaded detail;
  // the try-on path has none, so the sheet fetches it (garment id + seeds
  // are required before the editor can open).
  useEffect(() => {
    if (!open) return;
    if (initialDetail && initialDetail.id === libraryId) {
      setDetail(initialDetail);
      setLoadError(null);
      return;
    }
    if (!libraryId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getLibraryDetail(libraryId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setLoadError(strings.libraryOrder.previewError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, libraryId, initialDetail, reloadKey]);

  // Reset the creation error when the sheet closes.
  useEffect(() => {
    if (!open) setCreateError(null);
  }, [open]);

  /** The design's items as editor seeds — LabelOut ids are catalog ids. */
  const seeds = useMemo<SelectionSeedItem[]>(
    () =>
      detail?.items
        .filter((i) =>
          i.type === "variation"
            ? i.variation?.id != null
            : i.add_on?.id != null,
        )
        .map((i) => ({
          type: i.type,
          garment_style_component_id: i.component?.id ?? null,
          variation_id: i.variation?.id ?? null,
          variation_type_id: i.variation_type?.id ?? null,
          addon_id: i.add_on?.id ?? null,
          addon_variation_id: i.add_on_variation?.id ?? null,
          placement: i.placement,
        })) ?? [],
    [detail],
  );

  // The BE composes the design price as base + Σ additive item prices, so
  // the difference recovers the base the editor's total math needs.
  const basePrice = useMemo(() => {
    if (!detail) return null;
    return (
      detail.price - detail.items.reduce((sum, i) => sum + (i.price ?? 0), 0)
    );
  }, [detail]);

  /** Apply the customer's tweaks to the just-created order. */
  const applyTweaks = useCallback(
    async (
      orderId: string,
      garmentOrderId: string | null,
      desired: DraftItem[],
    ) => {
      const goId = garmentOrderId ?? undefined;
      const key = (
        type: "variation" | "add_on",
        componentId: string | null | undefined,
        addonId: string | null | undefined,
        placement: string[] | null | undefined,
      ) =>
        type === "variation"
          ? `variation:${componentId}`
          : `add_on:${addonId}:${placement?.[0] ?? ""}`;

      const seedByKey = new Map(
        seeds.map((s) => [
          key(
            s.type === "add_on" ? "add_on" : "variation",
            s.garment_style_component_id,
            s.addon_id,
            Array.isArray(s.placement) ? s.placement : null,
          ),
          s,
        ]),
      );
      const desiredKeys = new Set(
        desired.map((d) =>
          key(
            d.type,
            d.garment_style_component_id,
            d.addon_id,
            Array.isArray(d.placement) ? d.placement : null,
          ),
        ),
      );

      // Removed rows first (mirror of the editor's save diff).
      for (const s of seeds) {
        if (
          desiredKeys.has(
            key(
              s.type === "add_on" ? "add_on" : "variation",
              s.garment_style_component_id,
              s.addon_id,
              Array.isArray(s.placement) ? s.placement : null,
            ),
          )
        ) {
          continue;
        }
        if (s.type === "add_on") {
          const placement = Array.isArray(s.placement) ? s.placement : null;
          await ordersApi.removeAddon(
            orderId,
            s.addon_id ?? "",
            placement?.[0] ?? null,
            goId,
          );
        } else {
          // The customer API has no component removal — DELETE resets the
          // component to its catalog default (same semantics as the order
          // page's editor).
          await ordersApi.resetSelection(
            orderId,
            s.garment_style_component_id ?? "",
            goId,
          );
        }
      }

      // Added / changed rows.
      for (const d of desired) {
        const s = seedByKey.get(
          key(d.type, d.garment_style_component_id, d.addon_id, d.placement),
        );
        const changed =
          !s ||
          s.variation_id !== d.variation_id ||
          s.variation_type_id !== d.variation_type_id ||
          s.addon_variation_id !== d.addon_variation_id;
        if (!changed) continue;
        if (d.type === "add_on") {
          await ordersApi.upsertAddon(
            orderId,
            d.addon_id ?? "",
            d.addon_variation_id ?? null,
            d.placement?.[0] ?? null,
            goId,
          );
        } else {
          await ordersApi.updateSelection(
            orderId,
            d.garment_style_component_id ?? "",
            d.variation_id ?? "",
            d.variation_type_id ?? null,
            goId,
          );
        }
      }
    },
    [seeds],
  );

  /** Create a fresh PENDING order from the design — no open-orders check.
      The choice sheet's "Create new order" calls this directly, so it can
      never re-open the choice sheet (infinite loop). */
  const createNewOrder = useCallback(
    async (desired: DraftItem[]) => {
      if (!libraryId || creatingRef.current) return;
      creatingRef.current = true;
      lastDesiredRef.current = desired;
      setCreating(true);
      setCreateError(null);
      try {
        const out = await orderFromLibrary(libraryId);
        // Garment-order scoping for the selection writes (single garment
        // order, but pass the id when we can). Non-fatal on failure.
        let garmentOrderId: string | null = null;
        try {
          const od = await ordersApi.getOrderDetail(out.order_id);
          garmentOrderId = od.garment_orders[0]?.id ?? null;
        } catch {
          // writes fall back to the unscoped endpoints
        }
        try {
          onCreated?.(out.order_id, garmentOrderId);
        } catch {
          // caller extras (track, photo attach) are best-effort
        }
        await applyTweaks(out.order_id, garmentOrderId, desired);
        router.push(`/app/orders/${out.order_id}`);
        // No creatingRef reset on success — the route change unmounts this
        // sheet; until then the apply CTA stays pinned on "Saving order…".
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : strings.libraryOrder.error,
        );
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [libraryId, onCreated, applyTweaks, router],
  );

  /** Confirm entry point: logged-in users with open orders get the choice
      sheet; everyone else goes straight to creation. */
  const createOrder = useCallback(
    async (desired: DraftItem[]) => {
      if (!libraryId || creatingRef.current) return;
      lastAddTargetRef.current = null;
      // Add-to-existing check: fetch failure or empty list falls through to
      // the normal create — ordering is never blocked by this feature.
      if (authHydrated && isLoggedIn) {
        creatingRef.current = true;
        setCreating(true);
        try {
          const res = await listOpenOrders();
          if (res.items.length) {
            setOpenOrders(res.items);
            setChoiceOpen(true);
            return;
          }
        } catch {
          // fail open — create a new order as before
        } finally {
          creatingRef.current = false;
          setCreating(false);
        }
      }
      await createNewOrder(desired);
    },
    [libraryId, authHydrated, isLoggedIn, createNewOrder],
  );

  /** Append the reviewed design to the chosen open order, then walk there
      no matter how the tweak calls fare — the append is the step that
      counts. applyTweaks targets the new garment_order_id with the same
      customer selection endpoints the order page's editor uses. */
  const handleAddToOrder = useCallback(
    async (targetOrderId: string) => {
      if (!libraryId || addingRef.current) return;
      addingRef.current = true;
      lastAddTargetRef.current = targetOrderId;
      setAdding(true);
      setCreateError(null);
      const desired = lastDesiredRef.current ?? [];
      try {
        const res = await addGarmentToOrder(targetOrderId, {
          source: "library",
          library_id: libraryId,
        });
        try {
          onCreated?.(res.order_id, res.garment_order_id);
        } catch {
          // caller extras (try-on photo attach) are best-effort
        }
        // The garment is already in the order — the redirect happens from
        // here regardless. Tweaks ride along best-effort behind a bounded
        // wait; anything unapplied is re-editable on the order page.
        try {
          await Promise.race([
            applyTweaks(res.order_id, res.garment_order_id, desired),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("tweak apply exceeded budget")),
                TWEAK_APPLY_BUDGET_MS,
              ),
            ),
          ]);
        } catch {
          // partial/no tweaks — still land the user on the order page
        }
        setChoiceOpen(false);
        router.push(`/app/orders/${res.order_id}`);
      } catch (err) {
        setChoiceOpen(false);
        setCreateError(
          err instanceof Error && err.message
            ? err.message
            : strings.existingOrders.addError,
        );
        addingRef.current = false;
        setAdding(false);
      }
    },
    [libraryId, onCreated, applyTweaks, router],
  );

  const handleCreateNew = useCallback(() => {
    setChoiceOpen(false);
    lastAddTargetRef.current = null;
    const desired = lastDesiredRef.current;
    if (desired) void createNewOrder(desired);
  }, [createNewOrder]);

  /** Close only when idle — during creation the sheet stays put. */
  const handleSheetClose = useCallback(() => {
    if (creatingRef.current) return;
    onClose();
  }, [onClose]);

  const garmentId = detail?.garment_id ?? null;
  const editorReady = detail != null && garmentId != null;

  return (
    <>
      {/* Loader / load-error sheet — only until the design is in hand (the
          try-on path fetches it; the library path skips straight through). */}
      {!editorReady && (
        <BottomSheet
          open={open}
          onClose={onClose}
          title={strings.libraryOrder.previewSheetTitle}
        >
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <div
                aria-hidden
                className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver"
              >
                <div className="h-full w-1/2 animate-pulse bg-tape" />
              </div>
              <p className="text-caption text-muted">
                {strings.libraryOrder.previewLoading}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-center text-body text-ink">
                {loadError ?? strings.libraryOrder.previewError}
              </p>
              {loadError && (
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-semibold text-ink-navy transition-all ease-brand active:scale-[0.98]"
                >
                  {strings.libraryOrder.previewRetry}
                </button>
              )}
            </div>
          )}
        </BottomSheet>
      )}

      {/* The editor — the order page's edit-selections sheet in draft mode,
          seeded with the library design. Apply = create the order. */}
      {editorReady && detail && garmentId && (
        <GarmentSelectionSheet
          open={open}
          garmentId={garmentId}
          garmentOrderId="library-preview"
          initialItems={seeds}
          basePrice={basePrice}
          draftMode
          draftSaving={creating}
          title={strings.libraryOrder.previewSheetTitle}
          titleClassName="text-h2"
          draftApplyLabel={strings.libraryOrder.cta}
          onClose={handleSheetClose}
          onDraftChange={(items) => void createOrder(items)}
        />
      )}

      {/* Add-to-existing choice — over the editor; picking an order appends
          the reviewed design to it (inheriting its visit). */}
      <ExistingOrderChoiceSheet
        open={choiceOpen}
        onClose={() => setChoiceOpen(false)}
        orders={openOrders}
        busy={adding ? "add" : creating ? "create" : null}
        onAdd={(id) => void handleAddToOrder(id)}
        onCreateNew={handleCreateNew}
      />

      {/* Creation error — pinned above the sheet; the user's tweaks are
          still in the editor underneath, so retry resubmits them as-is. */}
      {createError && (
        <div className="fixed inset-x-0 bottom-6 z-[80] mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-pill bg-ink-navy px-4 py-2.5 shadow-card">
          <p className="min-w-0 text-caption text-chalk-white">{createError}</p>
          <button
            type="button"
            onClick={() => {
              const target = lastAddTargetRef.current;
              if (target) {
                void handleAddToOrder(target);
                return;
              }
              const desired = lastDesiredRef.current;
              if (desired) void createOrder(desired);
            }}
            className="flex-none rounded-pill bg-chalk-white px-3 py-1 text-caption font-semibold text-ink-navy active:scale-95"
          >
            {strings.libraryOrder.previewRetry}
          </button>
        </div>
      )}
    </>
  );
}
