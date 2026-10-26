/**
 * Auto-design ("Share a design with us") — pure conversions between the
 * three shapes the flow passes through:
 *
 *   backend result (AutoDesignDone)
 *        │ aiResultToSelections
 *        ▼
 *   MYOD `Selections` map  ──► MyodSheet.initialSelections (gap steps)
 *        │ selectionsToSeedItems
 *        ▼
 *   GarmentSelectionSheet seed rows (the review sheet)
 *        │ user tweaks → DraftItem[]
 *        │ draftItemsToSelections
 *        ▼
 *   MYOD `Selections` map  ──► createMyodOrder / addGarmentToOrder
 *
 * `Selections` sits in the middle on purpose: it is what MyodSheet already
 * stores, restores and serializes, so the order payload is byte-identical
 * to a hand-built MYOD design — one validation path on the backend.
 *
 * Add-on rows follow the MYOD convention: a toggle add-on is
 * `variationId: "__toggle_on__"`; several spots of one add-on live in
 * `picks` (one per placement) with `variationId` mirroring the first pick.
 */

import type { DraftItem, SelectionSeedItem } from "@/components/admin/GarmentSelectionSheet";
import type { AutoDesignDone } from "@/lib/api/autoDesign";
import type { ComponentSelection, PlacementPick, Selections } from "@/lib/myod-steps";

export const TOGGLE_ON = "__toggle_on__";
const OFF = "__off__";

/** Collapse per-spot picks into one ComponentSelection (flat when single). */
function fromSpots(spots: PlacementPick[]): ComponentSelection | null {
  if (spots.length === 0) return null;
  if (spots.length === 1) {
    const s = spots[0];
    return {
      variationId: s.variationId,
      ...(s.variationTypeId ? { variationTypeId: s.variationTypeId } : {}),
      ...(s.placement ? { placement: s.placement } : {}),
    };
  }
  return {
    variationId: spots[0].variationId,
    ...(spots[0].variationTypeId ? { variationTypeId: spots[0].variationTypeId } : {}),
    picks: spots,
  };
}

// ─── backend result → Selections ─────────────────────────────────────────────

/**
 * The analysis result as MYOD selections. Component picks key by component
 * id; add-on rows are grouped per add-on — one spot per listed placement
 * (a row with two placements is two spots) — so a piping seen on neckline
 * AND sleeves becomes two priced picks, exactly as the wizard would store it.
 * Toggle add-ons (no variation) carry at most one placement.
 */
export function aiResultToSelections(result: AutoDesignDone): Selections {
  const out: Selections = {};

  for (const s of result.selections ?? []) {
    if (!s.component_id || !s.variation_id) continue;
    out[s.component_id] = {
      variationId: s.variation_id,
      ...(s.variation_type_id ? { variationTypeId: s.variation_type_id } : {}),
    };
  }

  const spotsByAddon = new Map<string, PlacementPick[]>();
  const toggles = new Set<string>();
  for (const a of result.addons ?? []) {
    if (!a.addon_id) continue;
    const placements = (a.placement ?? []).filter(Boolean);
    if (!a.addon_variation_id) {
      // Toggle: on, optionally placed — never more than one spot.
      if (!toggles.has(a.addon_id)) {
        toggles.add(a.addon_id);
        out[a.addon_id] = {
          variationId: TOGGLE_ON,
          ...(placements[0] ? { placement: placements[0] } : {}),
        };
      }
      continue;
    }
    const spots = spotsByAddon.get(a.addon_id) ?? [];
    if (placements.length === 0) spots.push({ variationId: a.addon_variation_id });
    for (const p of placements) spots.push({ variationId: a.addon_variation_id, placement: p });
    spotsByAddon.set(a.addon_id, spots);
  }
  for (const [addonId, spots] of spotsByAddon) {
    if (toggles.has(addonId)) continue;
    const sel = fromSpots(spots);
    if (sel) out[addonId] = sel;
  }
  return out;
}

// ─── Selections → review-sheet seed rows ─────────────────────────────────────

const emptySeed = (): SelectionSeedItem => ({
  type: "variation",
  garment_style_component_id: null,
  variation_id: null,
  variation_type_id: null,
  addon_id: null,
  addon_variation_id: null,
  placement: null,
});

/**
 * Seed rows for GarmentSelectionSheet (draft mode). `addonIds` tells add-on
 * keys from component keys — the Selections map doesn't. One row per spot;
 * an add-on toggled `__off__` yields nothing (the sheet then shows it off).
 */
export function selectionsToSeedItems(
  selections: Selections,
  addonIds: Set<string>,
): SelectionSeedItem[] {
  const rows: SelectionSeedItem[] = [];
  for (const [key, sel] of Object.entries(selections)) {
    if (!sel || sel.variationId === OFF) continue;
    const spots: PlacementPick[] = sel.picks?.length
      ? sel.picks
      : [{ variationId: sel.variationId, variationTypeId: sel.variationTypeId, placement: sel.placement }];
    for (const spot of spots) {
      if (addonIds.has(key)) {
        rows.push({
          ...emptySeed(),
          type: "add_on",
          addon_id: key,
          addon_variation_id: spot.variationId === TOGGLE_ON ? null : spot.variationId,
          variation_type_id: spot.variationTypeId ?? null,
          placement: spot.placement ? [spot.placement] : null,
        });
      } else {
        rows.push({
          ...emptySeed(),
          type: "variation",
          garment_style_component_id: key,
          variation_id: spot.variationId,
          variation_type_id: spot.variationTypeId ?? null,
        });
      }
    }
  }
  return rows;
}

// ─── DraftItem[] → Selections ────────────────────────────────────────────────

/**
 * The review sheet's final rows back as MYOD selections, for the order
 * call. Variation rows key by component (a later row for the same component
 * wins); add-on rows group per add-on into spots. A row with no variation is
 * a toggle (`__toggle_on__`). Rows missing their ids are skipped — the
 * backend tolerates unknown keys the same way, never fatal.
 */
export function draftItemsToSelections(items: DraftItem[]): Selections {
  const out: Selections = {};
  const spotsByAddon = new Map<string, PlacementPick[]>();

  for (const item of items) {
    if (item.type === "variation") {
      if (!item.garment_style_component_id || !item.variation_id) continue;
      out[item.garment_style_component_id] = {
        variationId: item.variation_id,
        ...(item.variation_type_id ? { variationTypeId: item.variation_type_id } : {}),
      };
      continue;
    }
    if (!item.addon_id) continue;
    const placement = Array.isArray(item.placement) ? item.placement[0] : item.placement;
    if (!item.addon_variation_id) {
      if (!out[item.addon_id]) {
        out[item.addon_id] = {
          variationId: TOGGLE_ON,
          ...(placement ? { placement } : {}),
        };
      }
      continue;
    }
    const spots = spotsByAddon.get(item.addon_id) ?? [];
    spots.push({
      variationId: item.addon_variation_id,
      ...(item.variation_type_id ? { variationTypeId: item.variation_type_id } : {}),
      ...(placement ? { placement } : {}),
    });
    spotsByAddon.set(item.addon_id, spots);
  }

  for (const [addonId, spots] of spotsByAddon) {
    if (out[addonId]?.variationId === TOGGLE_ON) continue;
    // A single PLACED spot still goes to picks form — placements belong to
    // spots (same rule as walkin-library's row → selection mapping).
    if (spots.length === 1 && spots[0].placement) {
      out[addonId] = {
        variationId: spots[0].variationId,
        ...(spots[0].variationTypeId ? { variationTypeId: spots[0].variationTypeId } : {}),
        picks: spots,
      };
      continue;
    }
    const sel = fromSpots(spots);
    if (sel) out[addonId] = sel;
  }
  return out;
}

// ─── Misc ────────────────────────────────────────────────────────────────────

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

/**
 * A filename the upload endpoint accepts: it validates by extension, and
 * camera captures / some pickers hand over files with none. Falls back to
 * the MIME type's extension, else .jpg.
 */
export function withImageExtension(name: string, mimeType: string): string {
  if (/\.(jpe?g|png|webp|heic|heif)$/i.test(name)) return name;
  const ext = EXT_BY_MIME[mimeType] ?? ".jpg";
  const base = name.replace(/\.[^.]*$/, "") || "photo";
  return `${base}${ext}`;
}
