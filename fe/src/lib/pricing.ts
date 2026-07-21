/**
 * Pricing — single source of truth for every ₹ amount in the flow.
 *
 * `computePrice(draft)` is the only function the PriceBar, Review breakdown,
 * and Payment screen call. Per spec §13 the rate card is not final — these
 * are placeholder numbers with TODOs, structured so swapping in real values
 * touches only this file.
 */

import { ADDONS_PRICING, BASE_STITCHING, OPTION_PRICING } from "@/lib/pricing-config";
import { ADDON_BY_ID, CATEGORY_BY_ID } from "@/lib/catalog";
import type {
  AddOnState,
  BookingDraft,
  PriceComputation,
  PriceLine,
  Selection,
} from "@/types/booking";

/**
 * Resolve a single category selection into a price line.
 * Returns null for included options (no priceKey) — caller renders "Included".
 */
function selectionLine(
  categoryId: string,
  selection: Selection,
): PriceLine | null {
  const category = CATEGORY_BY_ID[categoryId];
  if (!category) return null;

  const option = category.options.find((o) => o.id === selection.optionId);
  if (!option?.priceKey) return null;

  const amount = OPTION_PRICING[option.priceKey] ?? 0;
  const subLabel = option.subOptions?.find((s) => s.id === selection.subOptionId)?.label;
  const label = subLabel ? `${option.label} · ${subLabel}` : option.label;

  return { label, amount };
}

/**
 * Resolve an add-on state into one or more price lines.
 * Placement-based add-ons (latkan, net_work, tassels) emit one line per
 * selected placement.
 */
function addOnLines(addOnId: string, state: AddOnState): PriceLine[] {
  if (!state.enabled) return [];
  const addOn = ADDON_BY_ID[addOnId];
  if (!addOn?.priceKey) return [];

  const base = ADDONS_PRICING[addOn.priceKey] ?? 0;
  const label = addOn.label;

  if (addOn.kind === "toggle" || addOn.kind === "choice") {
    const subLabel =
      addOn.choices?.find((c) => c.id === state.choiceId)?.label ?? null;
    return [
      { label: subLabel ? `${label} · ${subLabel}` : label, amount: base },
    ];
  }

  // placements
  const placements = state.placements ?? {};
  const selected = Object.keys(placements);
  if (selected.length === 0) return [];
  return selected.map((placementId) => {
    const placementLabel =
      addOn.placements?.find((p) => p.id === placementId)?.label ?? placementId;
    const sizeLabel =
      addOn.perPlacementSizes?.find(
        (s) => s.id === placements[placementId]?.sizeId,
      )?.label ?? null;
    return {
      label: sizeLabel
        ? `${label} · ${placementLabel} · ${sizeLabel}`
        : `${label} · ${placementLabel}`,
      amount: base,
    };
  });
}

export function computePrice(draft: BookingDraft): PriceComputation {
  const lines: PriceLine[] = [];

  lines.push({ label: "Base stitching", amount: BASE_STITCHING });

  for (const [categoryId, selection] of Object.entries(draft.selections)) {
    const line = selectionLine(categoryId, selection);
    if (line) lines.push(line);
  }

  for (const [addOnId, state] of Object.entries(draft.addOns)) {
    lines.push(...addOnLines(addOnId, state));
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { base: BASE_STITCHING, lines, total };
}

export function formatPrice(amount: number): string {
  // Indian grouping (1,24,000) would be ideal; spec only requires mono + ₹.
  // Using thousands separators for readability — keeps tabular alignment.
  return `₹${amount.toLocaleString("en-IN")}`;
}
