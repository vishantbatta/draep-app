"use client";

/**
 * AutoDesignOrderSheet — the "Review your design" step of "Share a design
 * with us", between the photo analysis and the PENDING order.
 *
 * It IS the order page's edit-selections sheet (GarmentSelectionSheet) in
 * draft mode, seeded with everything the photos settled: the customer can
 * change any selection or add-on against the live catalog, then the apply
 * CTA ("Order now") creates the order through the SAME endpoint a hand-built
 * MYOD design uses (/myod/order), with the hosted photos as the design's
 * inspiration images. Logged-in customers with open orders are first
 * offered to add this design to one of them — the LibraryOrderPreviewSheet
 * contract, minus the library.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  GarmentSelectionSheet,
  type DraftItem,
  type SelectionSeedItem,
} from "@/components/admin/GarmentSelectionSheet";
import { ExistingOrderChoiceSheet } from "@/components/order/ExistingOrderChoiceSheet";
import { track } from "@/lib/analytics";
import { createMyodOrder, serializeMyodSelections } from "@/lib/api/myod";
import { addGarmentToOrder, listOpenOrders } from "@/lib/api/orders";
import { draftItemsToSelections } from "@/lib/auto-design";
import { useAuthStore } from "@/lib/auth-store";
import { strings } from "@/lib/strings";
import type { OpenOrder } from "@/types/api";

interface Props {
  open: boolean;
  onClose: () => void;
  garmentId: string;
  basePrice: number | null;
  /** Everything the analysis (plus any gap steps) settled, as editor seeds. */
  seeds: SelectionSeedItem[];
  /** Hosted photo URLs (/designs/ai/ref_…) — the order's inspiration images. */
  assets: string[];
  /** Fires once the order exists, before the redirect (analytics etc.). */
  onCreated?: (orderId: string) => void;
}

export function AutoDesignOrderSheet({
  open,
  onClose,
  garmentId,
  basePrice,
  seeds,
  assets,
  onCreated,
}: Props) {
  const router = useRouter();
  const sessionType = useAuthStore((s) => s.sessionType);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const isLoggedIn = sessionType === "user";

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [adding, setAdding] = useState(false);
  // applyDraft() calls onDraftChange then onClose() in the same tick — a ref
  // is the only way onClose sees "busy" and keeps the sheet (and the user's
  // tweaks) on screen while the order is created. Also single-flights re-taps.
  const creatingRef = useRef(false);
  const addingRef = useRef(false);
  const lastDesiredRef = useRef<DraftItem[] | null>(null);
  const lastAddTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) setCreateError(null);
  }, [open]);

  /** Fresh PENDING order — no open-orders check (the choice sheet's "Create
      new order" calls this directly, so it can never loop back). */
  const createNewOrder = useCallback(
    async (desired: DraftItem[]) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      lastDesiredRef.current = desired;
      setCreating(true);
      setCreateError(null);
      try {
        const order = await createMyodOrder({
          garmentId,
          selections: draftItemsToSelections(desired),
          assets,
        });
        track({ event: "auto_design_order_created", order_id: order.id });
        try {
          onCreated?.(order.id);
        } catch {
          // caller extras are best-effort
        }
        setChoiceOpen(false);
        router.push(`/app/orders/${order.id}`);
        // No reset on success — the route change unmounts this sheet; until
        // then the apply CTA stays pinned on its saving state.
      } catch (err) {
        setChoiceOpen(false);
        setCreateError(
          err instanceof Error && err.message ? err.message : strings.autoDesign.orderError,
        );
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [garmentId, assets, onCreated, router],
  );

  /** Confirm entry point: logged-in users with open orders get the choice
      sheet; everyone else goes straight to creation. Fail-open. */
  const createOrder = useCallback(
    async (desired: DraftItem[]) => {
      if (creatingRef.current) return;
      lastDesiredRef.current = desired;
      lastAddTargetRef.current = null;
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
    [authHydrated, isLoggedIn, createNewOrder],
  );

  /** Append the reviewed design to the chosen open order, then walk there. */
  const handleAddToOrder = useCallback(
    async (targetOrderId: string) => {
      if (addingRef.current) return;
      addingRef.current = true;
      lastAddTargetRef.current = targetOrderId;
      setAdding(true);
      setCreateError(null);
      const desired = lastDesiredRef.current ?? [];
      try {
        const res = await addGarmentToOrder(targetOrderId, {
          source: "myod",
          garment_id: garmentId,
          selections: serializeMyodSelections(draftItemsToSelections(desired)),
          assets,
        });
        track({ event: "auto_design_order_created", order_id: res.order_id, appended: true });
        try {
          onCreated?.(res.order_id);
        } catch {
          // best-effort
        }
        setChoiceOpen(false);
        router.push(`/app/orders/${res.order_id}`);
      } catch (err) {
        setChoiceOpen(false);
        setCreateError(
          err instanceof Error && err.message ? err.message : strings.existingOrders.addError,
        );
        addingRef.current = false;
        setAdding(false);
      }
    },
    [garmentId, assets, onCreated, router],
  );

  const handleCreateNew = useCallback(() => {
    lastAddTargetRef.current = null;
    const desired = lastDesiredRef.current;
    if (desired) void createNewOrder(desired);
  }, [createNewOrder]);

  /** Close only when idle — during creation the sheet stays put. */
  const handleSheetClose = useCallback(() => {
    if (creatingRef.current) return;
    onClose();
  }, [onClose]);

  return (
    <>
      <GarmentSelectionSheet
        open={open}
        garmentId={garmentId}
        garmentOrderId="auto-design-preview"
        initialItems={seeds}
        basePrice={basePrice}
        draftMode
        draftSaving={creating}
        title={strings.autoDesign.reviewTitle}
        titleClassName="text-h2"
        draftApplyLabel={strings.autoDesign.orderCta}
        onClose={handleSheetClose}
        onDraftChange={(items) => void createOrder(items)}
      />

      <ExistingOrderChoiceSheet
        open={choiceOpen}
        onClose={() => setChoiceOpen(false)}
        orders={openOrders}
        busy={adding ? "add" : creating ? "create" : null}
        onAdd={(id) => void handleAddToOrder(id)}
        onCreateNew={handleCreateNew}
      />

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
              // A failed create retries the create itself — re-running
              // createOrder would re-open the choice sheet the user already
              // answered.
              const desired = lastDesiredRef.current;
              if (desired) void createNewOrder(desired);
            }}
            className="flex-none rounded-pill bg-chalk-white px-3 py-1 text-caption font-semibold text-ink-navy active:scale-95"
          >
            {strings.autoDesign.errorRetry}
          </button>
        </div>
      )}
    </>
  );
}
