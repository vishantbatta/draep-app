"use client";

/**
 * Booking draft store — Zustand with persist.
 *
 * - Initializes selections from CATALOG defaults on first load (zero-decision rule).
 * - `partialize` strips transient UI state — only BookingDraft persists.
 * - `version` + `migrate` from day one: catalog will change before launch,
 *   a broken-draft loop is the footgun.
 * - localStorage, 7-day expiry, debounced writes (300ms) via onItemStorage.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { ADD_ONS, CATALOG } from "@/lib/catalog";
import type {
  AddOnState,
  BookingDraft,
  ContactDetails,
  PaymentState,
  Selection,
  SlotSelection,
} from "@/types/booking";

const DRAFT_VERSION = 1 as const;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "draep_draft";

interface BookingStoreState {
  draft: BookingDraft | null;
  hydrated: boolean;
  setHydrated: () => void;

  initDraft: () => void;
  clearDraft: () => void;

  setSelection: (categoryId: string, selection: Selection) => void;
  setAddOn: (addOnId: string, state: AddOnState) => void;
  updateAddOn: (addOnId: string, patch: Partial<AddOnState>) => void;
  removeAddOn: (addOnId: string) => void;

  setContact: (contact: ContactDetails) => void;
  setPayment: (payment: PaymentState) => void;
  setSlot: (slot: SlotSelection) => void;
}

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
    selections: buildDefaultSelections(),
    addOns: {},
    updatedAt: new Date().toISOString(),
  };
}

function isExpired(draft: BookingDraft | null): boolean {
  if (!draft?.updatedAt) return true;
  return Date.now() - new Date(draft.updatedAt).getTime() > SEVEN_DAYS_MS;
}

/**
 * Cookie sync hook — middleware reads this to gate protected routes.
 * Carries only "exists + not expired" — never the full draft.
 */
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
  // Drop add-on states whose backing catalog entry no longer exists
  const validAddOnIds = new Set(ADD_ONS.map((a) => a.id));
  const cleanedAddOns: Record<string, AddOnState> = {};
  for (const [id, state] of Object.entries(draft.addOns)) {
    if (validAddOnIds.has(id)) cleanedAddOns[id] = state;
  }
  return { ...draft, addOns: cleanedAddOns, updatedAt: new Date().toISOString() };
}

export const useBookingStore = create<BookingStoreState>()(
  persist(
    (set) => ({
      draft: null,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),

      initDraft: () =>
        set((state) => {
          const valid = pruneInvalidState(state.draft);
          const draft = valid ?? newDraft();
          syncCookie(true);
          return { draft };
        }),

      clearDraft: () => {
        syncCookie(false);
        set({ draft: null });
      },

      setSelection: (categoryId, selection) =>
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: {
              ...state.draft,
              selections: { ...state.draft.selections, [categoryId]: selection },
              updatedAt: new Date().toISOString(),
            },
          };
        }),

      setAddOn: (addOnId, addOnState) =>
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: {
              ...state.draft,
              addOns: { ...state.draft.addOns, [addOnId]: addOnState },
              updatedAt: new Date().toISOString(),
            },
          };
        }),

      updateAddOn: (addOnId, patch) =>
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
        }),

      removeAddOn: (addOnId) =>
        set((state) => {
          if (!state.draft) return {};
          const next = { ...state.draft.addOns };
          delete next[addOnId];
          return {
            draft: { ...state.draft, addOns: next, updatedAt: new Date().toISOString() },
          };
        }),

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

      setSlot: (slot) =>
        set((state) => {
          if (!state.draft) return {};
          return {
            draft: { ...state.draft, slot, updatedAt: new Date().toISOString() },
          };
        }),
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
        // Today: same shape, no-op. Future catalog changes can rewrite selections here.
        if (version !== DRAFT_VERSION) return null;
        return persisted;
      },
    },
  ),
);

/**
 * `useHydrated()` — gates protected routes against the one-frame flash
 * before Zustand persist hydrates on the client.
 */
export function useHydrated(): boolean {
  return useBookingStore((s) => s.hydrated);
}

export const DRAFT_COOKIE_NAME = COOKIE_NAME;

/**
 * `useEnsureDraft()` — call once at the top of any screen that needs a draft.
 * Initializes one if hydration finished and none exists.
 */
export function useEnsureDraft(): void {
  const hydrated = useBookingStore((s) => s.hydrated);
  const draft = useBookingStore((s) => s.draft);
  const initDraft = useBookingStore((s) => s.initDraft);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (typeof window !== "undefined" && hydrated && !draft) {
    initDraft();
  }
}
