"use client";

/**
 * Booking draft store — Zustand with persist + API-backed mutations.
 *
 * Architecture:
 *   - Local state is the source of truth for UI (optimistic updates)
 *   - Selections and add-on changes are batched locally (no immediate API call)
 *   - flushPendingChanges() syncs all dirty selections/add-ons to the server
 *     when the user clicks "Next" or "Review"
 *   - On success: reconcile local state with server response (price breakdown, etc.)
 *
 * Lifecycle:
 *   1. initDraft() → creates local draft with defaults → POST /orders → stores orderId
 *   2. setSelection() → optimistic update only (marks category dirty)
 *   3. setAddOn/updateAddOn/removeAddOn → optimistic update only (marks add-on dirty)
 *   4. flushPendingChanges() → PUT all dirty selections + add-ons → reconcile
 *   5. clearDraft() → DELETE /orders/{id} (if exists) → clear local state
 */

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { ADD_ONS, CATALOG } from "@/lib/catalog";
import { catalogApi, ordersApi } from "@/lib/api";
import {
  getCatalogMapping,
  resolveSelection,
  resolveAddOnId,
  resolveAddOnVariationId,
  clearCatalogMappingCache,
  type CatalogMapping,
} from "@/lib/catalog-map";
import type { OrderOut } from "@/types/api";
import type {
  AddOnState,
  Booking,
  BookingDraft,
  ContactDetails,
  PaymentState,
  Selection,
} from "@/types/booking";

const DRAFT_VERSION = 1 as const;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "draep_draft";

/** Default garment slug — the only garment in V0 (blouse). */
const DEFAULT_GARMENT_SLUG = "blouse";

/** Cached garment UUID — fetched on first order creation. */
let cachedGarmentId: string | null = null;

/** Cached catalog mapping (frontend slugs → backend UUIDs). */
let cachedMapping: CatalogMapping | null = null;

/** Dirty-tracking: categories and add-ons with unflushed local changes. */
const pendingSelections = new Set<string>();
const pendingAddOns = new Set<string>();

interface BookingStoreState {
  draft: BookingDraft | null;
  hydrated: boolean;
  /** True while any API sync is in-flight. */
  syncing: boolean;
  /** Last sync error (cleared on successful sync). */
  syncError: string | null;
  setHydrated: () => void;

  initDraft: () => Promise<void>;
  clearDraft: () => Promise<void>;

  setSelection: (categoryId: string, selection: Selection) => void;
  setAddOn: (addOnId: string, state: AddOnState) => void;
  updateAddOn: (addOnId: string, patch: Partial<AddOnState>) => void;
  removeAddOn: (addOnId: string) => void;

  /** Sync all dirty selections + add-ons to the server. Call on "Next" / "Review". */
  flushPendingChanges: () => Promise<void>;

  /** Ensure catalog mapping is loaded (needed for flushPendingChanges). */
  ensureCatalogMapping: () => Promise<void>;

  setContact: (contact: ContactDetails) => void;
  setPayment: (payment: PaymentState) => void;
  /**
   * Store the server-confirmed booking (POST /orders/{id}/booking response)
   * on the draft. Captured at /schedule BEFORE payment so /confirmed can
   * render the visit summary without another round-trip.
   */
  setBooking: (booking: Booking) => void;

  /**
   * Replace draft.orderId with the authoritative id from the backend
   * (e.g. after OTP verify, when the backend re-parents a different order).
   * No-op if there is no draft or the id is unchanged.
   */
  setActiveOrderId: (orderId: string) => void;

  /** Reconcile local draft with server order response. */
  reconcileFromServer: (order: OrderOut) => void;

  /**
   * Hydrate the local draft from a library-sourced order. Deletes any
   * pre-existing draft order, then translates the server's UUID-based
   * selections/add-ons into the slug-based shape the FE configurator uses.
   *
   * Used by the library design detail BottomSheet after a successful
   * POST /library/:id/draft-order.
   */
  hydrateFromLibraryOrder: (order: OrderOut) => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDefaultSelections(): Record<string, Selection> {
  const out: Record<string, Selection> = {};
  for (const category of CATALOG) {
    if (category.defaultOptionId) {
      const option = category.options.find(
        (o) => o.id === category.defaultOptionId,
      );
      out[category.id] = {
        optionId: option!.id,
        subOptionId: option?.subOptions?.[0]?.id,
      };
    }
  }
  return out;
}

function newDraft(): BookingDraft {
  return {
    version: DRAFT_VERSION,
    orderId: null,
    garmentId: null,
    selections: buildDefaultSelections(),
    addOns: {},
    serverPriceBreakdown: null,
    updatedAt: new Date().toISOString(),
  };
}

function isExpired(draft: BookingDraft | null): boolean {
  if (!draft?.updatedAt) return true;
  return Date.now() - new Date(draft.updatedAt).getTime() > SEVEN_DAYS_MS;
}

function syncCookie(hasValidDraft: boolean) {
  if (typeof document === "undefined") return;
  if (hasValidDraft) {
    const expires = new Date(Date.now() + SEVEN_DAYS_MS).toUTCString();
    document.cookie = `${COOKIE_NAME}=1; expires=${expires}; path=/; SameSite=Lax`;
  } else {
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

function pruneInvalidState(draft: BookingDraft | null): BookingDraft | null {
  if (!draft) return null;
  if (isExpired(draft)) return null;
  if (draft.version !== DRAFT_VERSION) return null;
  const validAddOnIds = new Set(ADD_ONS.map((a) => a.id));
  const cleanedAddOns: Record<string, AddOnState> = {};
  for (const [id, state] of Object.entries(draft.addOns)) {
    if (validAddOnIds.has(id)) cleanedAddOns[id] = state;
  }
  return { ...draft, addOns: cleanedAddOns, updatedAt: new Date().toISOString() };
}

/**
 * Extract a price breakdown from a server OrderOut that matches the
 * frontend's PriceComputation shape.
 */
function extractPriceBreakdown(order: OrderOut): BookingDraft["serverPriceBreakdown"] {
  if (!order.price_breakdown) return null;
  return {
    base: order.price_breakdown.base_price,
    total: order.price_breakdown.total,
    lines: order.price_breakdown.lines.map((l) => ({
      label: l.label["en"] ?? JSON.stringify(l.label),
      amount: l.amount,
    })),
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useBookingStore = create<BookingStoreState>()(
  persist(
    (set, get) => ({
      draft: null,
      hydrated: false,
      syncing: false,
      syncError: null,
      setHydrated: () => set({ hydrated: true }),

      // ── initDraft: create local draft + server order ──────────────────
      initDraft: async () => {
        const state = get();
        const valid = pruneInvalidState(state.draft);
        if (valid && valid.orderId) {
          syncCookie(true);
          set({ draft: valid });
          // Still need to fetch catalog mapping for flushPendingChanges
          if (!cachedMapping && cachedGarmentId) {
            cachedMapping = await getCatalogMapping(cachedGarmentId);
          } else if (!cachedMapping) {
            const garments = await catalogApi.listGarments();
            const blouse = garments.items.find(
              (g) => g.slug === DEFAULT_GARMENT_SLUG,
            );
            if (blouse) {
              cachedGarmentId = blouse.id;
              cachedMapping = await getCatalogMapping(cachedGarmentId);
            }
          }
          return;
        }

        // Draft exists but has no server order — preserve local selections
        // and create the server-side order
        const draft = valid ?? newDraft();
        syncCookie(true);
        set({ draft, syncing: true, syncError: null });

        // Fire API to create server-side order
        try {
          // Resolve garment UUID from catalog (cached after first call)
          if (!cachedGarmentId) {
            const garments = await catalogApi.listGarments();
            const blouse = garments.items.find(
              (g) => g.slug === DEFAULT_GARMENT_SLUG,
            );
            if (!blouse) {
              throw new Error("Blouse garment not found in catalog");
            }
            cachedGarmentId = blouse.id;
          }

          // Fetch catalog mapping (frontend slugs → backend UUIDs)
          if (!cachedMapping) {
            cachedMapping = await getCatalogMapping(cachedGarmentId);
          }

          const order = await ordersApi.createOrder(cachedGarmentId);
          set((s) => ({
            draft: s.draft
              ? {
                  ...s.draft,
                  orderId: order.id,
                  garmentId: order.garment_id,
                  serverPriceBreakdown: extractPriceBreakdown(order),
                }
              : s.draft,
            syncing: false,
          }));

          // If we preserved an existing draft with selections, sync them
          // to the newly created server-side order so validation passes.
          if (valid && cachedMapping) {
            const currentDraft = get().draft;
            if (currentDraft?.orderId === order.id) {
              // Sync all selections using UUID mapping
              for (const [categoryId, sel] of Object.entries(valid.selections)) {
                const resolved = resolveSelection(
                  cachedMapping,
                  categoryId,
                  sel.optionId,
                  sel.subOptionId ?? null,
                );
                if (!resolved) continue;
                try {
                  const updated = await ordersApi.updateSelection(
                    order.id,
                    resolved.componentId,
                    resolved.variationId,
                    resolved.variationTypeId,
                  );
                  get().reconcileFromServer(updated);
                } catch {
                  // Best effort — individual selection sync failures
                  // will surface during order validation
                }
              }
              // Sync all add-ons
              for (const [addOnId, addOnState] of Object.entries(valid.addOns)) {
                if (!addOnState.enabled) continue;
                try {
                  const variationId = addOnState.choiceId ?? null;
                  const updated = await ordersApi.upsertAddon(
                    order.id,
                    addOnId,
                    variationId,
                    null,
                  );
                  get().reconcileFromServer(updated);
                } catch {
                  // Best effort
                }
              }
            }
          }
        } catch (err) {
          // Order creation failed — keep the local draft so the user can
          // still design, and we'll retry on next mutation.
          set({
            syncing: false,
            syncError: err instanceof Error ? err.message : "Failed to create order",
          });
        }
      },

      // ── clearDraft: delete server order + clear local ─────────────────
      clearDraft: async () => {
        const { draft } = get();
        if (draft?.orderId) {
          try {
            await ordersApi.deleteOrder(draft.orderId);
          } catch {
            // Best effort — clear locally regardless
          }
        }
        // Clear dirty tracking
        pendingSelections.clear();
        pendingAddOns.clear();
        clearCatalogMappingCache();
        cachedGarmentId = null;
        cachedMapping = null;
        syncCookie(false);
        set({ draft: null, syncing: false, syncError: null });
      },

      // ── setSelection: optimistic local update (no API call) ──────────
      setSelection: (categoryId, selection) => {
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: {
              ...state.draft,
              selections: { ...state.draft.selections, [categoryId]: selection },
              updatedAt: new Date().toISOString(),
            },
            syncError: null,
          };
        });

        // Mark this category as dirty — will be flushed on "Next"
        pendingSelections.add(categoryId);
      },

      // ── setAddOn: optimistic local update (no API call) ──────────────
      setAddOn: (addOnId, addOnState) => {
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: {
              ...state.draft,
              addOns: { ...state.draft.addOns, [addOnId]: addOnState },
              updatedAt: new Date().toISOString(),
            },
            syncError: null,
          };
        });

        // Mark dirty — will be flushed on "Next"
        pendingAddOns.add(addOnId);
      },

      // ── updateAddOn: optimistic local update (no API call) ───────────
      updateAddOn: (addOnId, patch) => {
        set((state) => {
          if (!state.draft) return {};
          const current = state.draft.addOns[addOnId] ?? { enabled: false };
          return {
            draft: {
              ...state.draft,
              addOns: {
                ...state.draft.addOns,
                [addOnId]: { ...current, ...patch },
              },
              updatedAt: new Date().toISOString(),
            },
          };
        });

        // Mark dirty — will be flushed on "Next"
        pendingAddOns.add(addOnId);
      },

      // ── removeAddOn: optimistic local update (no API call) ───────────
      removeAddOn: (addOnId) => {
        set((state) => {
          if (!state.draft) return {};
          const next = { ...state.draft.addOns };
          delete next[addOnId];
          return {
            draft: { ...state.draft, addOns: next, updatedAt: new Date().toISOString() },
          };
        });

        // Mark dirty — will be flushed on "Next"
        pendingAddOns.add(addOnId);
      },

      // ── ensureCatalogMapping: fetch mapping if not cached ───────────
      ensureCatalogMapping: async () => {
        if (cachedMapping) return;
        try {
          if (!cachedGarmentId) {
            const garments = await catalogApi.listGarments();
            const blouse = garments.items.find(
              (g) => g.slug === DEFAULT_GARMENT_SLUG,
            );
            if (blouse) {
              cachedGarmentId = blouse.id;
            }
          }
          if (cachedGarmentId) {
            cachedMapping = await getCatalogMapping(cachedGarmentId);
          }
        } catch {
          // Best effort — flushPendingChanges will skip if mapping is null
        }
      },

      // ── flushPendingChanges: batch-sync all dirty items to server ────
      flushPendingChanges: async () => {
        if (pendingSelections.size === 0 && pendingAddOns.size === 0) return;

        const { draft } = get();
        if (!draft?.orderId) {
          // No server order yet — try to create one first
          await get().initDraft();
          const updated = get();
          if (!updated.draft?.orderId) {
            set({ syncError: "Couldn't connect to the server. Your changes will be saved when you reconnect." });
            return;
          }
        }

        // Ensure catalog mapping is available (it may be null after page reload)
        if (!cachedMapping) {
          await get().ensureCatalogMapping();
        }
        if (!cachedMapping) {
          set({ syncError: "Couldn't load the design catalog. Your changes will be saved when you reconnect." });
          return;
        }

        set({ syncing: true, syncError: null });

        let hadError = false;

        // Re-read draft after potential initDraft call above
        const currentDraft = get().draft!;

        // Flush dirty selections
        for (const categoryId of pendingSelections) {
          const sel = currentDraft.selections[categoryId];
          if (!sel) continue;
          const resolved = resolveSelection(
            cachedMapping,
            categoryId,
            sel.optionId,
            sel.subOptionId ?? null,
          );
          if (!resolved) continue;
          try {
            const updated = await ordersApi.updateSelection(
              currentDraft.orderId!,
              resolved.componentId,
              resolved.variationId,
              resolved.variationTypeId,
            );
            get().reconcileFromServer(updated);
          } catch {
            hadError = true;
          }
        }

        // Flush dirty add-ons
        for (const addOnId of pendingAddOns) {
          const addOnState = currentDraft.addOns[addOnId];
          const backendAddOnId = resolveAddOnId(cachedMapping, addOnId);
          if (!backendAddOnId) continue;

          try {
            if (!addOnState?.enabled) {
              // Add-on was removed or disabled
              const updated = await ordersApi.removeAddon(
                currentDraft.orderId!,
                backendAddOnId,
              );
              get().reconcileFromServer(updated);
              continue;
            }

            // Determine variation UUID if this add-on has choices or sizes
            let variationUuid: string | null = null;
            if (addOnState.choiceId) {
              variationUuid = resolveAddOnVariationId(
                cachedMapping,
                addOnId,
                addOnState.choiceId,
              );
            }

            if (addOnState.placements) {
              // Placement-based add-on (Latkan, Net work, Tassels)
              // Upsert each placement separately
              for (const [placementId, placementData] of Object.entries(
                addOnState.placements,
              )) {
                // For Latkan, resolve the size as variation
                let placementVariation = variationUuid;
                if (placementData.sizeId) {
                  placementVariation = resolveAddOnVariationId(
                    cachedMapping,
                    addOnId,
                    placementData.sizeId,
                  );
                }
                const updated = await ordersApi.upsertAddon(
                  currentDraft.orderId!,
                  backendAddOnId,
                  placementVariation,
                  placementId,
                );
                get().reconcileFromServer(updated);
              }
            } else {
              // Toggle or choice add-on (Piping, Boning, Lining, Keyhole, etc.)
              const updated = await ordersApi.upsertAddon(
                currentDraft.orderId!,
                backendAddOnId,
                variationUuid,
                null,
              );
              get().reconcileFromServer(updated);
            }
          } catch {
            hadError = true;
          }
        }

        // Clear dirty tracking — everything has been attempted
        pendingSelections.clear();
        pendingAddOns.clear();

        set({
          syncing: false,
          syncError: hadError
            ? "Some changes couldn't be synced. Please try again."
            : null,
        });
      },

      setContact: (contact) =>
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: { ...state.draft, contact, updatedAt: new Date().toISOString() },
          };
        }),

      setPayment: (payment) =>
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: { ...state.draft, payment, updatedAt: new Date().toISOString() },
          };
        }),

      setBooking: (booking) =>
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: { ...state.draft, booking, updatedAt: new Date().toISOString() },
          };
        }),

      setActiveOrderId: (orderId) =>
        set((state) => {
          if (!state.draft) return {};
          if (state.draft.orderId === orderId) return {};
          return {
            draft: { ...state.draft, orderId, updatedAt: new Date().toISOString() },
          };
        }),

      // ── reconcileFromServer: merge server truth into local draft ─────
      reconcileFromServer: (order: OrderOut) => {
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: {
              ...state.draft,
              orderId: order.id,
              serverPriceBreakdown: extractPriceBreakdown(order),
              updatedAt: new Date().toISOString(),
            },
            syncing: false,
            syncError: null,
          };
        });
      },

      // ── hydrateFromLibraryOrder: rebuild draft from a library-sourced order
      //
      // Called after POST /library/:id/draft-order. Steps:
      //   1. Delete any existing local draft + server order (so we don't
      //      orphan a half-configured draft on the backend).
      //   2. Ensure the catalog mapping is loaded — we need the reverse
      //      (UUID → FE slug) maps to translate the server's order rows.
      //   3. Translate every selection + add-on state row back into the
      //      slug-based shape the FE configurator reads.
      //   4. Replace the local draft in one shot.
      //
      // Notes:
      //   - Per spec F10, the BE returns the existing draft on re-tap; we
      //     detect that case by comparing order.id and skip the destructive
      //     clearDraft() when the IDs match.
      //   - Unknown UUIDs (e.g. an add-on that exists in BE but not in the
      //     FE catalog) are silently skipped — they'll still be on the
      //     server order, the FE just won't render their toggles.
      hydrateFromLibraryOrder: async (order) => {
        const state = get();

        // If the user is re-tapping the SAME design that's already drafted,
        // the BE returned the existing order unchanged. Don't tear down local
        // state — just navigate the FE to /review.
        if (state.draft?.orderId === order.id) {
          return;
        }

        // Tear down any prior draft. clearDraft() also clears the catalog
        // mapping cache, so we must re-fetch it below.
        await get().clearDraft();

        // Reload catalog mapping (cleared by clearDraft).
        if (!cachedMapping) {
          try {
            if (!cachedGarmentId) {
              const garments = await catalogApi.listGarments();
              const blouse = garments.items.find(
                (g) => g.slug === DEFAULT_GARMENT_SLUG,
              );
              if (blouse) cachedGarmentId = blouse.id;
            }
            if (cachedGarmentId) {
              cachedMapping = await getCatalogMapping(cachedGarmentId);
            }
          } catch {
            // Without the mapping we can't translate UUIDs — bail out
            // leaving the user on the library screen with an error toast.
            set({
              syncError:
                "Couldn't load the design catalog. Please try again.",
            });
            return;
          }
        }

        const mapping = cachedMapping;
        if (!mapping) {
          set({
            syncError:
              "Couldn't load the design catalog. Please try again.",
          });
          return;
        }

        // Translate selections (server UUID → FE slugs).
        const selections: Record<string, Selection> = {};
        for (const sel of order.selections) {
          if (!sel.variation_id) continue;
          // Resolve variation → (categoryId, optionId) via reverse map.
          const varInfo = mapping.variationIdRev[sel.variation_id];
          if (!varInfo) continue;
          // Resolve variation_type → subOptionId if present.
          let subOptionId: string | undefined;
          if (sel.variation_type_id) {
            const vtInfo = mapping.variationTypeIdRev[sel.variation_type_id];
            if (vtInfo) subOptionId = vtInfo.subOptionId;
          }
          selections[varInfo.categoryId] = {
            optionId: varInfo.optionId,
            subOptionId,
          };
        }

        // Translate add-ons (server UUID → FE AddOnState).
        // Strategy: look up the FE AddOn definition to know its kind
        // (toggle | choice | placements) and build the appropriate shape.
        const addOns: Record<string, AddOnState> = {};
        for (const ao of order.add_on_states) {
          if (!ao.add_on_id) continue;
          const feId = mapping.addOnIdRev[ao.add_on_id];
          if (!feId) continue;

          const feDef = ADD_ONS.find((a) => a.id === feId);
          if (!feDef) continue;

          // Resolve choice/size variation back to FE slug.
          let choiceId: string | undefined;
          if (ao.add_on_variation_id) {
            const avInfo = mapping.addOnVariationIdRev[ao.add_on_variation_id];
            if (avInfo) choiceId = avInfo.choiceId;
          }

          // Normalize placement: server is string[] | null per spec F7.
          const placements = ao.placement ?? [];

          if (feDef.kind === "toggle") {
            addOns[feId] = { enabled: true };
          } else if (feDef.kind === "choice") {
            addOns[feId] = { enabled: true, choiceId };
          } else if (feDef.kind === "placements") {
            // Build a placements record keyed by placement id.
            // For Latkan the choiceId maps to a per-placement size.
            const placementsRecord: Record<string, { sizeId?: string }> = {};
            for (const p of placements) {
              placementsRecord[p] = feDef.perPlacementSizes
                ? { sizeId: choiceId }
                : {};
            }
            addOns[feId] = {
              enabled: true,
              placements: placementsRecord,
            };
          }
        }

        // Compose the new draft in one shot. Mark every selection as clean
        // (pendingSelections is empty after clearDraft) — the server is the
        // source of truth here.
        const newDraft: BookingDraft = {
          version: DRAFT_VERSION,
          orderId: order.id,
          garmentId: order.garment_id,
          libraryId: order.library_id,
          selections,
          addOns,
          serverPriceBreakdown: extractPriceBreakdown(order),
          updatedAt: new Date().toISOString(),
        };

        syncCookie(true);
        set({ draft: newDraft, syncing: false, syncError: null });
      },
    }),
    {
      name: "draep-booking-draft",
      storage: createJSONStorage(() => localStorage),
      version: DRAFT_VERSION,
      partialize: (state) => ({ draft: state.draft }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
        const pruned = pruneInvalidState(state?.draft ?? null);
        if (state) state.draft = pruned;
        syncCookie(Boolean(pruned));
      },
      migrate: (persisted, version) => {
        if (version !== DRAFT_VERSION) return null;
        return persisted;
      },
    },
  ),
);

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useHydrated(): boolean {
  return useBookingStore((s) => s.hydrated);
}

export const DRAFT_COOKIE_NAME = COOKIE_NAME;

/**
 * `useEnsureDraft()` — call once at the top of any screen that needs a draft.
 * Initializes one if hydration finished and none exists.
 * Also ensures catalog mapping is loaded for existing drafts (needed for flush).
 */
export function useEnsureDraft(): void {
  const hydrated = useBookingStore((s) => s.hydrated);
  const draft = useBookingStore((s) => s.draft);
  const initDraft = useBookingStore((s) => s.initDraft);
  const ensureCatalogMapping = useBookingStore((s) => s.ensureCatalogMapping);
  // Use a ref to avoid double-calling in StrictMode
  const firedRef = useRef(false);
  const mappingFiredRef = useRef(false);

  useEffect(() => {
    if (hydrated && !draft && !firedRef.current) {
      firedRef.current = true;
      initDraft();
    }
    // If draft already exists (from localStorage), ensure catalog mapping
    // is loaded — module-level cachedMapping resets on full page reload
    if (hydrated && draft?.orderId && !mappingFiredRef.current) {
      mappingFiredRef.current = true;
      ensureCatalogMapping();
    }
  }, [hydrated, draft, initDraft, ensureCatalogMapping]);
}
