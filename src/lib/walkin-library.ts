/**
 * Walk-in "Choose from library" — bridge the customer library append shape
 * to the walk-in add-garment endpoint.
 *
 * The library preview sheet (LibraryOrderPreviewSheet) edits a design as
 * AppendDesiredItem rows — the same shape the customer add-to-order uses.
 * The walk-in endpoint takes MYOD-style selections, so this mapper converts
 * rows → selections (variation rows keyed by component id; add-on rows
 * grouped per add-on into per-placement picks) and the wrapper posts them
 * through the EXISTING add-with-selections path: the garment lands in the
 * walk-in order in one call, with exactly the reviewed rows — no defaults
 * materialized, no backend surface added.
 */

import type { AppendDesiredItem } from "@/types/api";

import {
  scWalkInAddGarment,
  scWalkInOrderWithGarment,
  type SCWalkInSelectionsPayload,
} from "./style-captain-api";

/**
 * Convert library design rows to walk-in selections.
 * - variation rows → { variation_id, variation_type_id? } keyed by component id
 *   (a later row for the same component wins — the editor reconciles to one).
 * - add-on rows → grouped per add-on id; multiple rows become `picks`
 *   (one per placement, e.g. piping front + back), a single row stays flat.
 * - Rows without usable ids are skipped, never fatal — the backend tolerates
 *   unknown/mismatched keys the same way.
 */
export function libraryItemsToSelections(
  items: AppendDesiredItem[],
): SCWalkInSelectionsPayload {
  const out: SCWalkInSelectionsPayload = {};
  for (const item of items) {
    if (item.type === "variation") {
      if (!item.garment_style_component_id || !item.variation_id) continue;
      out[item.garment_style_component_id] = {
        variation_id: item.variation_id,
        ...(item.variation_type_id
          ? { variation_type_id: item.variation_type_id }
          : {}),
      };
      continue;
    }
    // add_on
    if (!item.addon_id || !item.addon_variation_id) continue;
    const pick = {
      variation_id: item.addon_variation_id,
      ...(item.variation_type_id
        ? { variation_type_id: item.variation_type_id }
        : {}),
      ...(item.placement?.[0] ? { placement: item.placement[0] } : {}),
    };
    const prev = out[item.addon_id];
    if (!prev) {
      // First row: placement-bearing rows go straight to picks form; a
      // placement-less row stays flat (both serialize identically BE-side).
      out[item.addon_id] = pick.placement
        ? {
            variation_id: pick.variation_id,
            ...(pick.variation_type_id
              ? { variation_type_id: pick.variation_type_id }
              : {}),
            picks: [pick],
          }
        : {
            variation_id: pick.variation_id,
            ...(pick.variation_type_id
              ? { variation_type_id: pick.variation_type_id }
              : {}),
          };
    } else {
      // Additional row: promote the flat selection (if any) into picks and
      // append; the top-level placement drops — picks own placements now.
      const prevPicks = prev.picks?.length
        ? prev.picks
        : prev.variation_id
          ? [
              {
                variation_id: prev.variation_id,
                ...(prev.variation_type_id
                  ? { variation_type_id: prev.variation_type_id }
                  : {}),
                ...(prev.placement ? { placement: prev.placement } : {}),
              },
            ]
          : [];
      out[item.addon_id] = {
        variation_id: (prevPicks[0] ?? pick).variation_id,
        ...(prev.variation_type_id
          ? { variation_type_id: prev.variation_type_id }
          : pick.variation_type_id
            ? { variation_type_id: pick.variation_type_id }
            : {}),
        picks: [...prevPicks, pick],
      };
    }
  }
  return out;
}

/**
 * Add a reviewed library design to the walk-in order (captain-auth) — one
 * call; returns the new garment_order_id.
 */
export async function scWalkInAddLibraryDesign(
  orderId: string,
  garmentId: string,
  items: AppendDesiredItem[],
): Promise<{ garment_order_id: string }> {
  return scWalkInAddGarment(orderId, garmentId, libraryItemsToSelections(items));
}

/**
 * FIRST library design (no walk-in order yet): create the pending order
 * together with the reviewed design — one call, returns the order ids too.
 */
export async function scWalkInOrderWithLibraryDesign(params: {
  userId: string;
  address: { addressId: string } | { newAddress: unknown } | null;
  garmentId: string;
  items: AppendDesiredItem[];
}): Promise<{
  order_id: string;
  order_number: string;
  garment_order_id: string;
}> {
  return scWalkInOrderWithGarment({
    user_id: params.userId,
    ...("addressId" in (params.address ?? {})
      ? { address_id: (params.address as { addressId: string }).addressId }
      : {}),
    ...("newAddress" in (params.address ?? {})
      ? { new_address: (params.address as { newAddress: unknown }).newAddress as never }
      : {}),
    garment_id: params.garmentId,
    selections: libraryItemsToSelections(params.items),
  });
}
