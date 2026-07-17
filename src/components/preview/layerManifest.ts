/**
 * Layer manifest — z-order and view-flip rules for the BlousePreview.
 *
 * Every selectable option/sub-option renders as an SVG layer. The manifest
 * declares which view (front/back) each layer belongs to and the stacking
 * order, so the preview stays readable as layers stack up.
 *
 * Without this manifest, the preview becomes an unreadable mess by screen
 * three — this was called out as a footgun during plan review.
 */

export type PreviewView = "front" | "back";

export interface LayerDescriptor {
  /** Composite key: `${categoryId}:${optionId}[:${subOptionId}]` or `addon:${addOnId}[:${...}]` */
  id: string;
  view: PreviewView;
  /** Higher z = drawn on top. Base blouse is z=0. */
  z: number;
}

/**
 * Base blouse silhouette — drawn on both views at z=0.
 * Layers defined relative to a 240×280 viewBox.
 */

const FRONT_LAYERS: LayerDescriptor[] = [
  // Cut (Princess/Kati show seam lines on the front)
  { id: "blouse_cut:princess", view: "front", z: 10 },
  { id: "blouse_cut:katori", view: "front", z: 10 },
  // Length
  { id: "blouse_length:short_choli", view: "front", z: 5 },
  { id: "blouse_length:long_waist", view: "front", z: 5 },
  // Front neck (front view)
  { id: "front_neck:round", view: "front", z: 20 },
  { id: "front_neck:deep", view: "front", z: 20 },
  { id: "front_neck:sweetheart", view: "front", z: 20 },
  { id: "front_neck:boat", view: "front", z: 20 },
  { id: "front_neck:high_neck", view: "front", z: 20 },
  // Shoulder (visible from both views but we draw on front primarily)
  { id: "shoulder:off_shoulder", view: "front", z: 15 },
  { id: "shoulder:one_shoulder", view: "front", z: 15 },
  { id: "shoulder:strappy", view: "front", z: 15 },
  { id: "shoulder:halter", view: "front", z: 15 },
  { id: "shoulder:cold_shoulder", view: "front", z: 15 },
  // Sleeve (front)
  { id: "sleeve:cap", view: "front", z: 18 },
  { id: "sleeve:regular_short", view: "front", z: 18 },
  { id: "sleeve:elbow", view: "front", z: 18 },
  { id: "sleeve:three_quarter", view: "front", z: 18 },
  { id: "sleeve:full", view: "front", z: 18 },
  // Add-on: keyhole front
  { id: "addon:keyhole_front", view: "front", z: 30 },
  // Add-on: latkan / tassels / net on front-neck
  { id: "addon:latkan:front_neck", view: "front", z: 40 },
  { id: "addon:tassels:front_neck", view: "front", z: 40 },
  { id: "addon:net_work:front_neck", view: "front", z: 25 },
  // Add-on: piping on edges (front visible)
  { id: "addon:piping", view: "front", z: 35 },
  // Add-on: latkan/tassels/net on sleeves (front)
  { id: "addon:latkan:sleeves", view: "front", z: 40 },
  { id: "addon:tassels:sleeves", view: "front", z: 40 },
  { id: "addon:net_work:sleeves", view: "front", z: 25 },
  // Add-on: latkan/tassels/net on bottom (front)
  { id: "addon:latkan:bottom", view: "front", z: 40 },
  { id: "addon:tassels:bottom", view: "front", z: 40 },
  { id: "addon:net_work:bottom", view: "front", z: 25 },
  // Add-on: border (drawn at hem, front view)
  { id: "addon:border", view: "front", z: 32 },
];

const BACK_LAYERS: LayerDescriptor[] = [
  // Back cut
  { id: "back_cut:regular", view: "back", z: 20 },
  { id: "back_cut:deep", view: "back", z: 20 },
  { id: "back_cut:backless", view: "back", z: 20 },
  // Tying (back view)
  { id: "tying:hook:back", view: "back", z: 30 },
  { id: "tying:chain:back", view: "back", z: 30 },
  { id: "tying:button:back", view: "back", z: 30 },
  // Tying (front view rendered on front, not here)
  // Add-on: keyhole back
  { id: "addon:keyhole_back", view: "back", z: 30 },
  // Add-on: latkan / tassels / net on back-neck
  { id: "addon:latkan:back_neck", view: "back", z: 40 },
  { id: "addon:tassels:back_neck", view: "back", z: 40 },
  { id: "addon:net_work:back_neck", view: "back", z: 25 },
];

export const LAYER_MANIFEST: LayerDescriptor[] = [...FRONT_LAYERS, ...BACK_LAYERS];

/** Default view per route — spec §5.5: back cut/tying/keyhole back → back view,
 *  front neck → front view. */
export const DEFAULT_VIEW_PER_ROUTE: Record<string, PreviewView> = {
  "/design/cut": "front",
  "/design/length": "front",
  "/design/front-neck": "front",
  "/design/back": "back",
  "/design/tying": "back",
  "/design/fit": "front",
  "/design/add-ons": "front",
  "/review": "front",
};

/** Returns the layer id string for a category selection. */
export function selectionLayerId(
  categoryId: string,
  optionId: string,
  subOptionId?: string,
): string {
  return subOptionId
    ? `${categoryId}:${optionId}:${subOptionId}`
    : `${categoryId}:${optionId}`;
}

/** Returns the layer id string for an add-on (optionally per placement). */
export function addOnLayerId(addOnId: string, placementId?: string): string {
  return placementId ? `addon:${addOnId}:${placementId}` : `addon:${addOnId}`;
}

/** Look up a layer descriptor by id. */
export function findLayer(id: string): LayerDescriptor | undefined {
  return LAYER_MANIFEST.find((l) => l.id === id);
}

/** Sort a set of layer ids by z-order (ascending) for a given view. */
export function sortByZ(layerIds: string[], view: PreviewView): string[] {
  return [...layerIds].sort((a, b) => {
    const za = LAYER_MANIFEST.find((l) => l.id === a && l.view === view)?.z ?? 0;
    const zb = LAYER_MANIFEST.find((l) => l.id === b && l.view === view)?.z ?? 0;
    return za - zb;
  });
}
