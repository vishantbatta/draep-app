"use client";

/**
 * useCategory — encapsulates the read/set logic for a single category.
 *
 * Returns the current selection (or a fallback from defaults) and a setter
 * that writes through to the Zustand store. Pages stay declarative — no
 * inline store wiring.
 */

import { CATEGORY_BY_ID } from "@/lib/catalog";
import { useBookingStore } from "@/lib/booking-store";
import { track } from "@/lib/analytics";
import { OPTION_PRICING } from "@/lib/pricing-config";
import type { BookingDraft, Selection } from "@/types/booking";

interface UseCategoryResult {
  draft: BookingDraft;
  selection: Selection | null;
  setSelection: (next: Selection) => void;
}

export function useCategory(categoryId: string): UseCategoryResult {
  const draft = useBookingStore((s) => s.draft);
  const setSelectionInStore = useBookingStore((s) => s.setSelection);

  const category = CATEGORY_BY_ID[categoryId];
  const selection = draft?.selections[categoryId] ?? null;

  const setSelection = (next: Selection) => {
    if (!draft || !category) return;
    const previousOptionId = selection?.optionId ?? null;
    setSelectionInStore(categoryId, next);
    track({
      event: "option_changed",
      categoryId,
      from: previousOptionId,
      to: next.optionId,
      subOptionId: next.subOptionId,
    });
  };

  return {
    draft: draft!,
    selection,
    setSelection,
  };
}

/** Resolve the price label for a given option — "+ ₹60" or "Included" or undefined. */
export function optionPriceLabel(priceKey?: string): string | undefined {
  if (!priceKey) return undefined;
  const amount = OPTION_PRICING[priceKey] ?? 0;
  return amount === 0 ? "Included" : `+ ₹${amount}`;
}
