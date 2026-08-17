"use client";

/**
 * GarmentSelectionSheet
 *
 * Admin-side catalog-driven style picker for a single garment order, in a
 * bottom sheet with the same UX as the style-captain SelectionSheet:
 *
 *   - Components (Blouse cut, Front neck, Sleeve, …) render as cards; each
 *     variation is a pill (with its price). When the chosen variation has
 *     variation_types (sub-options, e.g. Deep → U-shape), a Type pill row
 *     appears below.
 *   - Add-ons (Piping, Lining, Key Hole, …) render as cards with a
 *     "+ Add / ✓ Added" toggle. Matrix add-ons (2+ option axes) show one
 *     chip row per axis (Where · Style · Shape · Size · Type · Color) and
 *     resolve the picks to a priced combination; others show flat option
 *     pills. Placement-based add-ons add placement chips, one slot each.
 *
 * Two modes, mirroring the old inline GarmentOrderEditor:
 *  - persist (order detail page): on Save, diff the desired items against
 *    the existing `garment_orders_items` rows and create / update / delete
 *    accordingly. Prices are never written — totals re-derive server-side.
 *  - draft (NewOrderSheet wizard): no writes — "Apply selections" hands
 *    the parent the desired DraftItem[] + computed total.
 *
 * When `aiPanel` is provided (the DesignFromImage element), the sheet shows
 * a segmented tab bar — "Manual select" | "Upload reference" — so the AI
 * reference flow lives inside the same sheet. Applying an AI design bumps
 * `sessionId`; the sheet reseeds and flips back to the manual tab with the
 * AI picks loaded for review.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchGarmentTree,
  createTableRow,
  updateTableRow,
  deleteTableRow,
  catalogLabel,
  type GarmentTree,
  type CatalogAddon,
  type CatalogAddonVariation,
  type GarmentOrderItemRow,
} from "@/lib/admin-api";
import { BottomSheet } from "@/components/style-captain/BottomSheet";

// ─── Types ─────────────────────────────────────────────────────────────

/** A single selected component, held in local state before saving. */
interface ComponentSelection {
  componentId: string;
  variationId: string;
  variationTypeId: string | null;
}

/**
 * A single selected add-on placement slot: where it goes on the garment and
 * which variation (for matrix add-ons: which axis combination) it uses.
 * The same add-on can occupy several placements, each with its own variation.
 */
interface AddonSlot {
  /** null = the add-on has no placements (piping, boning, …). */
  placement: string | null;
  variationId: string | null;
}

/** A single selected add-on, held in local state before saving. */
interface AddonSelection {
  addonId: string;
  enabled: boolean;
  slots: AddonSlot[];
}

/** A collected draft item (before persistence) for draft mode. */
export interface DraftItem {
  type: "variation" | "add_on";
  garment_style_component_id: string | null;
  variation_id: string | null;
  variation_type_id: string | null;
  addon_id: string | null;
  addon_variation_id: string | null;
  /** JSONB array on the row, e.g. ["Sleeves"]; null where N/A. */
  placement: string[] | null;
  price: number | null;
  label_snapshot: string;
}

/**
 * What the sheet seeds its selections from. GarmentOrderItemRow satisfies
 * this directly (persist mode); DraftItem satisfies it too (wizard drafts),
 * so both callers can pass their current items as-is.
 */
export type SelectionSeedItem = Pick<
  GarmentOrderItemRow,
  | "type"
  | "garment_style_component_id"
  | "variation_id"
  | "variation_type_id"
  | "addon_id"
  | "addon_variation_id"
  | "placement"
>;

interface GarmentSelectionSheetProps {
  open: boolean;
  garmentId: string;
  garmentOrderId: string;
  /** Current items (saved rows or draft items) used to seed the selections. */
  initialItems: SelectionSeedItem[];
  basePrice: number | null;
  /**
   * Change to force a fresh seed even when open/garmentId are unchanged
   * (e.g. each AI-prefill iteration).
   */
  sessionId?: string | number;
  /**
   * AI reference flow (the DesignFromImage element), rendered as an
   * "Upload reference" tab inside the sheet. When the AI applies a design
   * the parent bumps `sessionId` — the sheet reseeds and switches back to
   * the manual tab with the AI picks loaded.
   */
  aiPanel?: ReactNode;
  onClose: () => void;
  /** persist mode: called after a successful save with the refreshed rows. */
  onSaveComplete?: (items: GarmentOrderItemRow[]) => void;
  /** Draft mode: no writes; Apply hands the parent the desired items. */
  draftMode?: boolean;
  /** When true, shows a subtle "Saving order…" hint (external submit). */
  draftSaving?: boolean;
  onDraftChange?: (items: DraftItem[]) => void;
  onComputedTotalChange?: (total: number) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

/** Build a label snapshot like "Front neck cut → Deep → U-shape". */
function buildLabelSnapshot(
  componentLabel: string,
  variationLabel: string,
  variationTypeLabel: string | null,
): string {
  if (variationTypeLabel) {
    return `${componentLabel} → ${variationLabel} → ${variationTypeLabel}`;
  }
  return `${componentLabel} → ${variationLabel}`;
}

function buildAddonLabel(
  addonLabel: string,
  variationLabel: string | null,
  placement: string | null = null,
): string {
  const parts = [addonLabel];
  if (placement) parts.push(placement);
  if (variationLabel) parts.push(variationLabel);
  return parts.join(" → ");
}

/**
 * `garment_orders_items.placement` is a JSONB array on the customer path
 * (["Sleeves"]) but a scalar string on rows written by older admin flows.
 * Normalize to a single placement string (arrays are always single-element)
 * or null.
 */
function normalizePlacement(
  p: string | string[] | null | undefined,
): string | null {
  if (Array.isArray(p)) return p[0] ?? null;
  return p ?? null;
}

/** Normalize seed items (rows or drafts) into full rows for the diff base. */
function toSeedRows(
  items: SelectionSeedItem[],
  garmentOrderId: string,
): GarmentOrderItemRow[] {
  return items.map((it, i) => {
    const row = it as GarmentOrderItemRow;
    return {
      ...it,
      id: row.id ?? `seed-${i}`,
      garment_order_id: row.garment_order_id ?? garmentOrderId,
      custom_input: row.custom_input ?? null,
      price: row.price ?? null,
      label_snapshot: row.label_snapshot ?? null,
    };
  });
}

// ─── Add-on matrix axes ──────────────────────────────────────────────────
//
// A matrix add-on prices combinations of option axes (shape × size × …),
// one variation row per combination. When an add-on uses 2+ axes we render
// one chip row per axis instead of a flat variation list and resolve the
// picks to the single matching priced variation row.

const ADDON_AXES = ["style", "shape", "size", "type", "color"] as const;

interface AddonAxisInfo {
  /** Variations visible in this context (placement-filtered). */
  pool: CatalogAddonVariation[];
  /** Axis columns with at least one distinct value, in display order. */
  axes: string[];
  /** Distinct values per axis, in variation order. */
  values: Record<string, string[]>;
  /** Fully-specified priced rows, keyed by axis-value tuple. */
  byKey: Map<string, CatalogAddonVariation>;
}

function axisTuple(axes: string[], row: CatalogAddonVariation): string[] | null {
  const tuple: string[] = [];
  for (const ax of axes) {
    const v = row[ax as keyof CatalogAddonVariation] as string | null;
    if (!v) return null; // row not fully specified on these axes
    tuple.push(v);
  }
  return tuple;
}

// A placement-priced variation (placement column set) is only visible inside
// the slot for its own placement; agnostic rows (null) are visible everywhere
// and act as the fallback when the same combination exists both ways.
function variationPool(
  variations: CatalogAddonVariation[],
  placement: string | null,
): CatalogAddonVariation[] {
  return placement == null
    ? variations.filter((v) => v.placement == null)
    : variations.filter((v) => v.placement == null || v.placement === placement);
}

/**
 * Placement chips the card offers. When the add-on's variations are
 * placement-priced, the chips must come from the placements the variations
 * actually carry — the add-on's `placements` metadata can hold stale values
 * that match no variation row (Key Hole lists "Front neck cut" etc., but
 * every row is priced at Back / Front / Sleeves), which would open a slot
 * with an empty pool and no way to pick a shape or size. Agnostic add-ons
 * (all variations placement-null) keep using the metadata list.
 */
function effectivePlacements(addon: CatalogAddon): string[] {
  const priced: string[] = [];
  for (const v of addon.variations) {
    if (v.placement && !priced.includes(v.placement)) priced.push(v.placement);
  }
  if (priced.length === 0) return addon.placements ?? [];
  // Keep the metadata order where it matches, then surface any priced
  // placement the metadata doesn't list at all.
  const meta = addon.placements ?? [];
  const ordered = meta.filter((p) => priced.includes(p));
  for (const p of priced) if (!ordered.includes(p)) ordered.push(p);
  return ordered;
}

/** placement undefined = all rows (e.g. axis badges); null = agnostic only. */
function deriveAddonAxes(
  variations: CatalogAddonVariation[],
  placement?: string | null,
): AddonAxisInfo {
  const pool =
    placement === undefined ? variations : variationPool(variations, placement);
  const axes: string[] = [];
  const values: Record<string, string[]> = {};
  for (const ax of ADDON_AXES) {
    const vals: string[] = [];
    for (const v of pool) {
      const val = v[ax as keyof CatalogAddonVariation] as string | null;
      if (val && !vals.includes(val)) vals.push(val);
    }
    if (vals.length > 0) {
      axes.push(ax);
      values[ax] = vals;
    }
  }
  const byKey = new Map<string, CatalogAddonVariation>();
  for (const v of pool) {
    if (v.price == null) continue; // unpriced combination = not sellable
    const tuple = axisTuple(axes, v);
    if (!tuple) continue;
    const key = tuple.join("\u0000");
    const prev = byKey.get(key);
    // Same combination both ways → the placement-specific price wins.
    if (!prev || (prev.placement == null && v.placement != null)) {
      byKey.set(key, v);
    }
  }
  return { pool, axes, values, byKey };
}

function cap(v: string): string {
  return v ? v[0].toUpperCase() + v.slice(1) : v;
}

// ─── Component ─────────────────────────────────────────────────────────

export function GarmentSelectionSheet({
  open,
  garmentId,
  garmentOrderId,
  initialItems,
  basePrice,
  sessionId,
  aiPanel,
  onClose,
  onSaveComplete,
  draftMode = false,
  draftSaving = false,
  onDraftChange,
  onComputedTotalChange,
}: GarmentSelectionSheetProps) {
  const [tree, setTree] = useState<GarmentTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-component selections: componentId → selection
  const [componentSelections, setComponentSelections] = useState<
    Record<string, ComponentSelection>
  >({});

  // Per-addon selections: addonId → selection
  const [addonSelections, setAddonSelections] = useState<
    Record<string, AddonSelection>
  >({});

  // The rows the desired items are diffed against on save.
  const [existingItems, setExistingItems] = useState<GarmentOrderItemRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // Manual selections vs AI reference (only when aiPanel is provided).
  const [tab, setTab] = useState<"selections" | "reference">("selections");
  // A sessionId bump means the parent reseeded (an AI iteration applied) —
  // land on the manual tab so the picks are right there to review.
  const lastSessionRef = useRef(sessionId);
  useEffect(() => {
    if (lastSessionRef.current !== sessionId) {
      lastSessionRef.current = sessionId;
      setTab("selections");
    }
  }, [sessionId]);

  // ── Load the garment tree + seed selections on open ────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSavedCount(null);
    // Every open lands on the manual tab (the AI tab is one tap away).
    setTab("selections");
    const seedRows = toSeedRows(initialItems, garmentOrderId);
    setExistingItems(seedRows);
    fetchGarmentTree(garmentId)
      .then((t) => {
        if (cancelled) return;
        setTree(t);

        // Initialise component selections from the seeded items / defaults.
        const nextComps: Record<string, ComponentSelection> = {};
        for (const comp of t.components) {
          const existing = seedRows.find(
            (it) =>
              it.type === "variation" &&
              it.garment_style_component_id === comp.id,
          );
          if (existing && existing.variation_id) {
            nextComps[comp.id] = {
              componentId: comp.id,
              variationId: existing.variation_id,
              variationTypeId: existing.variation_type_id ?? null,
            };
          } else if (comp.default_variation_id) {
            const defVar = comp.variations.find(
              (v) => v.id === comp.default_variation_id,
            );
            nextComps[comp.id] = {
              componentId: comp.id,
              variationId: comp.default_variation_id,
              variationTypeId:
                defVar?.default_type_id ?? defVar?.variation_types[0]?.id ?? null,
            };
          } else if (comp.variations.length > 0) {
            const v0 = comp.variations[0];
            nextComps[comp.id] = {
              componentId: comp.id,
              variationId: v0.id,
              variationTypeId:
                v0.default_type_id ?? v0.variation_types[0]?.id ?? null,
            };
          }
        }
        setComponentSelections(nextComps);

        // Initialise addon selections from the seeded items / defaults.
        // One slot per existing (addon, placement) item — the same add-on
        // can appear on several placements, each with its own variation.
        const nextAddons: Record<string, AddonSelection> = {};
        for (const addon of t.addons) {
          const existing = seedRows.filter(
            (it) => it.type === "add_on" && it.addon_id === addon.id,
          );
          if (existing.length > 0) {
            nextAddons[addon.id] = {
              addonId: addon.id,
              enabled: true,
              slots: existing.map((it) => ({
                placement: normalizePlacement(it.placement),
                variationId: it.addon_variation_id ?? null,
              })),
            };
          } else {
            const isPlacementBased = effectivePlacements(addon).length > 0;
            nextAddons[addon.id] = {
              addonId: addon.id,
              enabled: Boolean(addon.is_default_on),
              slots:
                addon.is_default_on && !isPlacementBased
                  ? [
                      {
                        placement: null,
                        variationId: addon.default_variation_id ?? null,
                      },
                    ]
                  : [],
            };
          }
        }
        setAddonSelections(nextAddons);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load garment tree");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, garmentId, sessionId]);

  // ── Derived total price ────────────────────────────────────────────────
  const computedTotal = useMemo(() => {
    let total = basePrice ?? 0;
    if (!tree) return total;

    // Components: add the variation_type price (if any) else variation price
    for (const comp of tree.components) {
      const sel = componentSelections[comp.id];
      if (!sel) continue;
      const v = comp.variations.find((x) => x.id === sel.variationId);
      if (!v) continue;
      if (sel.variationTypeId) {
        const vt = v.variation_types.find((x) => x.id === sel.variationTypeId);
        if (vt?.price) total += vt.price;
      } else if (v.price) {
        total += v.price;
      }
    }

    // Add-ons: additive — base price + selected variation price per
    // placement slot (Lining ₹100 + Full ₹30 = ₹130), matching the backend.
    for (const addon of tree.addons) {
      const sel = addonSelections[addon.id];
      if (!sel?.enabled) continue;
      for (const slot of sel.slots) {
        total += addon.price ?? 0;
        if (slot.variationId) {
          const av = addon.variations.find((x) => x.id === slot.variationId);
          if (av?.price) total += av.price;
        }
      }
    }

    return total;
  }, [tree, componentSelections, addonSelections, basePrice]);

  // ── Build the "desired items" array from current selections ───────────
  const desiredItems: DraftItem[] = useMemo(() => {
    if (!tree) return [];
    const items: DraftItem[] = [];

    // Components → variation items
    for (const comp of tree.components) {
      const sel = componentSelections[comp.id];
      if (!sel) continue;
      const v = comp.variations.find((x) => x.id === sel.variationId);
      if (!v) continue;
      const vt = sel.variationTypeId
        ? v.variation_types.find((x) => x.id === sel.variationTypeId)
        : null;
      const compLabel = catalogLabel(comp.labels, comp.id);
      const varLabel = catalogLabel(v.labels, v.id);
      const vtLabel = vt ? catalogLabel(vt.labels, vt.id) : null;
      items.push({
        type: "variation",
        garment_style_component_id: comp.id,
        variation_id: v.id,
        variation_type_id: vt?.id ?? null,
        addon_id: null,
        addon_variation_id: null,
        placement: null,
        price: vt?.price ?? v.price ?? null,
        label_snapshot: buildLabelSnapshot(compLabel, varLabel, vtLabel),
      });
    }

    // Add-ons → one add_on item per placement slot (only enabled). A slot on
    // a variations add-on emits nothing until its combination is resolved.
    for (const addon of tree.addons) {
      const sel = addonSelections[addon.id];
      if (!sel?.enabled) continue;
      const addonLabel = catalogLabel(addon.labels, addon.id);
      for (const slot of sel.slots) {
        const av = slot.variationId
          ? addon.variations.find((x) => x.id === slot.variationId)
          : null;
        if (addon.variations.length > 0 && !av) continue;
        const avLabel = av ? catalogLabel(av.labels, av.id) : null;
        items.push({
          type: "add_on",
          garment_style_component_id: null,
          variation_id: null,
          variation_type_id: null,
          addon_id: addon.id,
          addon_variation_id: av?.id ?? null,
          placement: slot.placement ? [slot.placement] : null,
          price: (addon.price ?? 0) + (av?.price ?? 0) || null,
          label_snapshot: buildAddonLabel(addonLabel, avLabel, slot.placement),
        });
      }
    }

    return items;
  }, [tree, componentSelections, addonSelections]);

  // ── Persist-mode diff: how many row writes a save would perform ────────
  const changeCount = useMemo(() => {
    if (!tree || draftMode) return 0;
    const desiredKey = (d: DraftItem) =>
      d.type === "variation"
        ? `variation:${d.garment_style_component_id}`
        : `add_on:${d.addon_id}:${d.placement?.[0] ?? ""}`;
    const existingKey = (it: GarmentOrderItemRow) =>
      it.type === "variation"
        ? `variation:${it.garment_style_component_id}`
        : `add_on:${it.addon_id}:${normalizePlacement(it.placement) ?? ""}`;
    const existingByKey = new Map(
      existingItems.map((it) => [existingKey(it), it] as const),
    );
    const desiredKeys = new Set(desiredItems.map(desiredKey));
    let n = 0;
    for (const it of existingItems) {
      if (!desiredKeys.has(existingKey(it))) n++;
    }
    for (const d of desiredItems) {
      const existing = existingByKey.get(desiredKey(d));
      if (!existing) {
        n++;
        continue;
      }
      if (
        existing.variation_id !== d.variation_id ||
        existing.variation_type_id !== d.variation_type_id ||
        existing.addon_variation_id !== d.addon_variation_id ||
        normalizePlacement(existing.placement) !== (d.placement?.[0] ?? null) ||
        (existing.label_snapshot ?? null) !== (d.label_snapshot ?? null)
      ) {
        n++;
      }
    }
    return n;
  }, [tree, draftMode, desiredItems, existingItems]);

  // ── An enabled add-on with variations must have a variation chosen on
  //    every slot before save/apply (blocks silently dropping a slot). ────
  const missingChoice = useMemo(() => {
    if (!tree) return false;
    for (const addon of tree.addons) {
      if (addon.variations.length === 0) continue;
      const sel = addonSelections[addon.id];
      if (!sel?.enabled) continue;
      if (sel.slots.some((s) => !s.variationId)) return true;
    }
    return false;
  }, [tree, addonSelections]);

  // ── Handlers ───────────────────────────────────────────────────────────

  function selectVariation(componentId: string, variationId: string) {
    setComponentSelections((prev) => {
      const next = { ...prev };
      const comp = tree?.components.find((c) => c.id === componentId);
      const v = comp?.variations.find((x) => x.id === variationId);
      // Auto-select first variation_type if the variation has any
      const firstTypeId =
        v?.default_type_id ?? v?.variation_types[0]?.id ?? null;
      next[componentId] = {
        componentId,
        variationId,
        variationTypeId: firstTypeId,
      };
      return next;
    });
  }

  function selectVariationType(
    componentId: string,
    variationId: string,
    variationTypeId: string,
  ) {
    setComponentSelections((prev) => ({
      ...prev,
      [componentId]: {
        componentId,
        variationId,
        variationTypeId,
      },
    }));
  }

  /** Default variation for a new slot: the add-on default when it is valid
   * at this placement (agnostic or matching), else the first priced row that
   * is valid there. */
  function defaultVariationFor(addonId: string, placement: string | null): string | null {
    const addon = tree?.addons.find((a) => a.id === addonId);
    if (!addon) return null;
    const valid = (v: CatalogAddonVariation) =>
      v.price != null && (v.placement == null || v.placement === placement);
    if (addon.default_variation_id) {
      const def = addon.variations.find((v) => v.id === addon.default_variation_id);
      if (def && valid(def)) return def.id;
    }
    return addon.variations.find(valid)?.id ?? null;
  }

  function toggleAddon(addonId: string, enabled: boolean) {
    setAddonSelections((prev) => {
      const sel = prev[addonId];
      if (!sel) return prev;
      let slots = sel.slots;
      // Placement-less add-ons always carry one implicit slot when enabled.
      if (enabled && slots.length === 0) {
        const addon = tree?.addons.find((a) => a.id === addonId);
        if (addon && effectivePlacements(addon).length === 0) {
          slots = [{ placement: null, variationId: defaultVariationFor(addonId, null) }];
        }
      }
      return { ...prev, [addonId]: { ...sel, enabled, slots } };
    });
  }

  /** Enable/disable a placement slot (no-op for placement-less add-ons). */
  function togglePlacement(addonId: string, placement: string, on: boolean) {
    setAddonSelections((prev) => {
      const sel = prev[addonId];
      if (!sel) return prev;
      const slots = on
        ? [
            ...sel.slots,
            // New slots start on a default valid at this placement
            // (the add-on default if it applies there).
            {
              placement,
              variationId: defaultVariationFor(addonId, placement),
            },
          ]
        : sel.slots.filter((s) => s.placement !== placement);
      return { ...prev, [addonId]: { ...sel, slots } };
    });
  }

  /** Set the variation of one slot (placement null = the single slot of a
   * placement-less add-on, creating it if needed). */
  function selectSlotVariation(
    addonId: string,
    placement: string | null,
    variationId: string | null,
  ) {
    setAddonSelections((prev) => {
      const sel = prev[addonId];
      if (!sel) return prev;
      const idx = sel.slots.findIndex((s) => s.placement === placement);
      const slots = [...sel.slots];
      if (idx >= 0) {
        slots[idx] = { ...slots[idx], variationId };
      } else {
        slots.push({ placement, variationId });
      }
      return { ...prev, [addonId]: { ...sel, slots } };
    });
  }

  // ── Save: diff against existing items and CRUD ─────────────────────────
  const handleSave = useCallback(async () => {
    if (!tree) return;
    setSaving(true);
    setError(null);
    setSavedCount(null);

    try {
      // Diff against existing items.
      // Match key: one item per component / per (add-on, placement).
      const desiredKey = (d: DraftItem) =>
        d.type === "variation"
          ? `variation:${d.garment_style_component_id}`
          : `add_on:${d.addon_id}:${d.placement?.[0] ?? ""}`;
      const existingKey = (it: GarmentOrderItemRow) =>
        it.type === "variation"
          ? `variation:${it.garment_style_component_id}`
          : `add_on:${it.addon_id}:${normalizePlacement(it.placement) ?? ""}`;

      const findExisting = (d: DraftItem) =>
        existingItems.find((it) => existingKey(it) === desiredKey(d));

      const desiredKeys = new Set(desiredItems.map(desiredKey));

      const updatedItems: GarmentOrderItemRow[] = [];

      // 1. Delete items that are no longer desired
      for (const it of existingItems) {
        if (!desiredKeys.has(existingKey(it))) {
          await deleteTableRow("garment_orders_items", it.id);
        }
      }

      // 2. Create or update desired items
      for (const d of desiredItems) {
        const existing = findExisting(d);
        // placement is stored as a JSONB array (["Sleeves"]); null where N/A.
        const payload: Record<string, unknown> = {
          garment_order_id: garmentOrderId,
          type: d.type,
          garment_style_component_id: d.garment_style_component_id,
          variation_id: d.variation_id,
          variation_type_id: d.variation_type_id,
          addon_id: d.addon_id,
          addon_variation_id: d.addon_variation_id,
          placement: d.placement,
          label_snapshot: d.label_snapshot,
        };

        if (existing) {
          // Update if anything changed. Price is deliberately absent: the
          // backend rejects direct writes (prices come from the catalog +
          // adjustment rows), so a stored/catalog price delta is not a change
          // we can persist — comparing it would fire a no-op update on every
          // save for admin-created items whose stored snapshot is null.
          const needsUpdate =
            existing.variation_id !== d.variation_id ||
            existing.variation_type_id !== d.variation_type_id ||
            existing.addon_variation_id !== d.addon_variation_id ||
            normalizePlacement(existing.placement) !== (d.placement?.[0] ?? null) ||
            (existing.label_snapshot ?? null) !== (d.label_snapshot ?? null);
          if (needsUpdate) {
            await updateTableRow(
              "garment_orders_items",
              existing.id,
              payload,
            );
          }
          updatedItems.push({ ...existing, ...payload } as GarmentOrderItemRow);
        } else {
          const created = await createTableRow<GarmentOrderItemRow>(
            "garment_orders_items",
            payload,
          );
          updatedItems.push(created);
        }
      }

      setExistingItems(updatedItems);
      setSavedCount(updatedItems.length);
      onSaveComplete?.(updatedItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [tree, desiredItems, existingItems, garmentOrderId, onSaveComplete]);

  /** Draft mode: hand the parent the desired items + total, then close. */
  function applyDraft() {
    onDraftChange?.(desiredItems);
    onComputedTotalChange?.(computedTotal);
    onClose();
  }

  if (!open) return null;

  const garmentLabel = tree ? catalogLabel(tree.labels, tree.slug ?? garmentId) : "";

  return (
    <BottomSheet
      title={draftMode ? "Select style" : "Edit selections"}
      onClose={onClose}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-caption text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-navy border-t-transparent" />
          Loading garment catalog…
        </div>
      ) : error && !tree ? (
        <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      ) : tree ? (
        <div className="space-y-4">
          {/* Header: garment + live computed total */}
          <div className="flex items-center justify-between gap-3 rounded-card border border-hairline bg-mist-navy/20 px-3 py-2">
            <div className="min-w-0">
              <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                {garmentLabel}
              </p>
              <p className="text-[11px] text-muted">
                Base {formatPrice(basePrice)} + selections
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Total
              </p>
              <p className="font-mono text-body font-semibold text-ink-navy">
                {formatPrice(computedTotal)}
              </p>
            </div>
          </div>

          {/* Tab bar — manual selections vs AI reference flow */}
          {aiPanel && (
            <div className="flex gap-1 rounded-pill border border-hairline bg-mist-navy/20 p-1">
              <button
                onClick={() => setTab("selections")}
                className={`tap flex-1 rounded-pill px-3 py-1.5 text-caption font-medium transition ${
                  tab === "selections"
                    ? "bg-chalk-white text-ink-navy shadow-card"
                    : "text-muted hover:text-ink-navy"
                }`}
              >
                Manual select
              </button>
              <button
                onClick={() => setTab("reference")}
                className={`tap flex-1 rounded-pill px-3 py-1.5 text-caption font-medium transition ${
                  tab === "reference"
                    ? "bg-chalk-white text-ink-navy shadow-card"
                    : "text-muted hover:text-ink-navy"
                }`}
              >
                Upload reference
              </button>
            </div>
          )}

          {tab === "reference" ? (
            aiPanel
          ) : (
            <>
          {/* ── Components: one card per part, variation pills ────────── */}
          {tree.components.map((comp) => {
            const sel = componentSelections[comp.id];
            const selectedVar = sel
              ? comp.variations.find((v) => v.id === sel.variationId)
              : undefined;
            return (
              <div
                key={comp.id}
                className="space-y-2 rounded-card border border-hairline bg-chalk-white px-3 py-3"
              >
                <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                  {catalogLabel(comp.labels, comp.id)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {comp.variations.map((v) => {
                    const isActive = sel?.variationId === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => selectVariation(comp.id, v.id)}
                        className={`tap rounded-pill px-3 py-1.5 text-caption font-medium transition ${
                          isActive
                            ? "bg-ink-navy text-chalk-white shadow-card"
                            : "border border-hairline-strong bg-chalk-white text-ink-navy"
                        }`}
                      >
                        {catalogLabel(v.labels, v.id)}
                        {v.price != null && (
                          <span className={isActive ? "opacity-80" : "text-muted"}>
                            {" "}
                            +{formatPrice(v.price)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {comp.variations.length === 0 && (
                    <span className="text-caption text-muted">
                      No alternatives configured.
                    </span>
                  )}
                </div>

                {/* Sub-type pills for the chosen variation (e.g. Deep → U-shape) */}
                {selectedVar && selectedVar.variation_types.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted">Type</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedVar.variation_types.map((vt) => {
                        const isActive = sel?.variationTypeId === vt.id;
                        return (
                          <button
                            key={vt.id}
                            onClick={() =>
                              selectVariationType(comp.id, selectedVar.id, vt.id)
                            }
                            className={`tap rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                              isActive
                                ? "bg-ink-navy text-chalk-white shadow-card"
                                : "border border-hairline-strong bg-chalk-white text-ink-navy"
                            }`}
                          >
                            {catalogLabel(vt.labels, vt.id)}
                            {vt.price != null && (
                              <span className={isActive ? "opacity-80" : "text-muted"}>
                                {" "}
                                +{formatPrice(vt.price)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Add-ons: cards with add/remove + chips ─────────────────── */}
          {tree.addons.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Add-ons
              </p>
              {tree.addons.map((addon) => {
                const sel = addonSelections[addon.id];
                const enabled = sel?.enabled ?? false;
                const slots = sel?.slots ?? [];
                // Chips come from the placements variations are actually
                // priced at (the metadata can hold stale values).
                const placements = effectivePlacements(addon);
                const isPlacementBased = placements.length > 0;

                // Resolved price across slots — additive, matching the backend.
                let slotTotal = 0;
                for (const slot of slots) {
                  const av = slot.variationId
                    ? addon.variations.find((x) => x.id === slot.variationId)
                    : null;
                  slotTotal += (addon.price ?? 0) + (av?.price ?? 0);
                }
                const hint =
                  enabled && slots.length > 0
                    ? slotTotal
                    : addon.price ??
                      addon.variations.find((v) => v.price != null)?.price ??
                      null;

                return (
                  <div
                    key={addon.id}
                    className={`space-y-2 rounded-card border px-3 py-3 ${
                      enabled
                        ? "border-hairline bg-chalk-white"
                        : "border-dashed border-hairline-strong bg-chalk-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-caption font-medium text-ink-navy">
                          {catalogLabel(addon.labels, addon.id)}
                        </p>
                        {hint !== null && (
                          <p className="text-[11px] text-muted">
                            + {formatPrice(hint)}
                            {enabled && slots.length > 1 && ` (${slots.length}×)`}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => toggleAddon(addon.id, !enabled)}
                        className={`tap shrink-0 rounded-pill px-3 py-1.5 text-caption font-medium transition ${
                          enabled
                            ? "bg-ink-navy text-chalk-white shadow-card"
                            : "border border-hairline-strong bg-chalk-white text-ink-navy"
                        }`}
                      >
                        {enabled ? "✓ Added" : "+ Add"}
                      </button>
                    </div>

                    {enabled && isPlacementBased && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-muted">
                          Placement
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {placements.map((pl) => {
                            const isActive = slots.some((s) => s.placement === pl);
                            return (
                              <button
                                key={pl}
                                onClick={() => togglePlacement(addon.id, pl, !isActive)}
                                className={`tap rounded-pill px-3 py-1 text-[12px] font-medium capitalize transition ${
                                  isActive
                                    ? "bg-ink-navy text-chalk-white shadow-card"
                                    : "border border-hairline-strong bg-chalk-white text-ink-navy"
                                }`}
                              >
                                {pl}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {enabled &&
                      slots.map((slot, i) => (
                        <div
                          key={slot.placement ?? `slot-${i}`}
                          className={
                            slots.length > 1
                              ? "space-y-1 rounded-card border border-hairline px-2.5 py-2"
                              : "space-y-1"
                          }
                        >
                          {slots.length > 1 && (
                            <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                              {slot.placement}
                            </p>
                          )}
                          <AddonVariationPicker
                            addon={addon}
                            placement={slot.placement}
                            selectedVariationId={slot.variationId}
                            onSelectVariation={(vid) =>
                              selectSlotVariation(addon.id, slot.placement, vid)
                            }
                          />
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
              {error}
            </div>
          )}

          {savedCount !== null && (
            <div className="rounded-card border border-success-border bg-success-bg px-4 py-3 text-caption text-success-text">
              ✓ Design saved — {savedCount} item{savedCount === 1 ? "" : "s"}. Total
              price refreshes below.
            </div>
          )}

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <div className="flex gap-2 pt-1">
            {savedCount !== null ? (
              <button
                onClick={onClose}
                className="tap flex-1 rounded-pill bg-ink-navy px-4 py-3 text-body font-semibold text-chalk-white"
              >
                Done
              </button>
            ) : draftMode ? (
              <>
                <button
                  onClick={onClose}
                  className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
                >
                  Cancel
                </button>
                <button
                  onClick={applyDraft}
                  disabled={loading || missingChoice}
                  className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-50"
                >
                  {missingChoice
                    ? "Choose an option"
                    : draftSaving
                      ? "Saving order…"
                      : "Apply selections"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || changeCount === 0 || missingChoice}
                  className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-50"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                      Saving…
                    </span>
                  ) : missingChoice ? (
                    "Choose an option"
                  ) : changeCount === 0 ? (
                    "No changes"
                  ) : (
                    `Save ${changeCount} change${changeCount === 1 ? "" : "s"}`
                  )}
                </button>
              </>
            )}
          </div>
            </>
          )}
        </div>
      ) : null}
    </BottomSheet>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

/**
 * Variation picker for a single add-on slot. Matrix add-ons (2+ option axes)
 * render one chip row per axis and resolve the picks to a combination;
 * others render a flat variation chip list. Returns null for flat-price
 * add-ons with no variations (nothing to pick).
 */
function AddonVariationPicker({
  addon,
  placement,
  selectedVariationId,
  onSelectVariation,
}: {
  addon: CatalogAddon;
  /** Slot placement — filters the visible variation pool. */
  placement: string | null;
  selectedVariationId: string | null;
  onSelectVariation: (variationId: string | null) => void;
}) {
  const matrix = useMemo(() => {
    const filtered = deriveAddonAxes(addon.variations, placement);
    // A stale slot placement (metadata drift, legacy rows) can filter the
    // pool to nothing — fall back to every variation so there is always
    // something to pick, like the style-captain sheet does.
    return filtered.pool.length > 0
      ? filtered
      : deriveAddonAxes(addon.variations, undefined);
  }, [addon.variations, placement]);
  const isMatrix = matrix.axes.length >= 2;

  // Partial picks per axis, held locally until every axis has a value and
  // the combination resolves to a variation row.
  const [axisPicks, setAxisPicks] = useState<Record<string, string>>({});

  const selectedAv = selectedVariationId
    ? (matrix.pool.find((v) => v.id === selectedVariationId) ?? null)
    : null;

  // Current per-axis picks: explicit local picks win; else infer from the
  // selected variation row (covers defaults and re-loaded existing items).
  const currentPicks: Record<string, string> = {};
  if (isMatrix && selectedAv) {
    for (const ax of matrix.axes) {
      const val = axisPicks[ax] ?? (selectedAv[ax as keyof CatalogAddonVariation] as string | null);
      if (val && matrix.values[ax].includes(val)) currentPicks[ax] = val;
    }
  }

  function pickAxisValue(ax: string, value: string | null) {
    const next = { ...currentPicks };
    if (value === null) delete next[ax];
    else next[ax] = value;
    setAxisPicks(next);
    if (matrix.axes.every((a) => next[a])) {
      const av = matrix.byKey.get(matrix.axes.map((a) => next[a]).join("\u0000")) ?? null;
      onSelectVariation(av ? av.id : null);
    } else {
      onSelectVariation(null);
    }
  }

  // A value is choosable if some priced variation in this slot's pool
  // matches it and the picks already made on every other axis. Values that
  // can't complete a real combination are hidden (conditional showing).
  function valueAvailable(ax: string, v: string): boolean {
    return matrix.pool.some((w) => {
      if (w.price == null || w[ax as keyof CatalogAddonVariation] !== v) return false;
      return matrix.axes.every((a) => a === ax || !currentPicks[a] || w[a as keyof CatalogAddonVariation] === currentPicks[a]);
    });
  }

  if (matrix.pool.length === 0) return null;

  if (isMatrix) {
    return (
      <div className="space-y-2">
        {matrix.axes.map((ax) => (
          <div key={ax} className="space-y-1">
            <p className="text-eyebrow uppercase tracking-wider text-accent-text">
              {cap(ax)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {matrix.values[ax].map((v) =>
                valueAvailable(ax, v) ? (
                  <button
                    key={v}
                    onClick={() => pickAxisValue(ax, currentPicks[ax] === v ? null : v)}
                    className={`tap rounded-pill px-3 py-1 text-[12px] font-medium capitalize transition ${
                      currentPicks[ax] === v
                        ? "bg-ink-navy text-chalk-white shadow-card"
                        : "border border-hairline-strong bg-chalk-white text-ink-navy"
                    }`}
                  >
                    {cap(v)}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        ))}
        <div className="text-[11px] text-muted">
          {selectedAv && selectedAv.price != null ? (
            <>
              {matrix.axes.map((a) => cap(currentPicks[a] ?? "")).join(" · ")} —{" "}
              <span className="font-medium text-ink-navy">+{formatPrice(selectedAv.price)}</span>
            </>
          ) : (
            "Pick an option in each row."
          )}
        </div>
      </div>
    );
  }

  // Flat variation list (single axis or none)
  return (
    <div className="space-y-1">
      {matrix.axes.length === 1 && (
        <p className="text-eyebrow uppercase tracking-wider text-accent-text">
          {cap(matrix.axes[0])}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {matrix.pool.map((av) => {
          const avLabel = catalogLabel(av.labels, av.id);
          const avSel = selectedVariationId === av.id;
          return (
            <button
              key={av.id}
              onClick={() => onSelectVariation(avSel ? null : av.id)}
              className={`tap rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                avSel
                  ? "bg-ink-navy text-chalk-white shadow-card"
                  : "border border-hairline-strong bg-chalk-white text-ink-navy"
              }`}
            >
              {avLabel}
              {av.price != null && (
                <span className={avSel ? "opacity-80" : "text-muted"}>
                  {" "}
                  +{formatPrice(av.price)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
