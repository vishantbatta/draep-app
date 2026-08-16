"use client";

/**
 * GarmentOrderEditor
 *
 * Admin-side catalog-driven editor for a single garment order's design
 * selections. Mirrors the customer-facing /style flow:
 *
 *   - Components (Blouse cut, Front neck, Sleeve, …) shown as accordion
 *     sections; each variation is a selectable chip/card.
 *   - When a variation has variation_types (sub-options, e.g. Deep →
 *     U-shape / V-shape), a sub-row of chips slides in below.
 *   - Add-ons (Piping, Lining, Border, …) are toggle/choice rows with
 *     optional variation selection and placement.
 *
 * All writes go to the `garment_orders_items` admin table:
 *   - On Save, we diff the current selection state against the existing
 *     rows and create / update / delete accordingly.
 *
 * The component is self-contained: pass it a garmentId, a garmentOrderId
 * and the initial set of items. It fetches the catalog tree itself.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchGarmentTree,
  createTableRow,
  updateTableRow,
  deleteTableRow,
  catalogLabel,
  type GarmentTree,
  type CatalogComponent,
  type CatalogVariation,
  type CatalogVariationType,
  type CatalogAddon,
  type CatalogAddonVariation,
  type GarmentOrderItemRow,
} from "@/lib/admin-api";

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

interface GarmentOrderEditorProps {
  garmentId: string;
  garmentOrderId: string;
  initialItems: GarmentOrderItemRow[];
  basePrice: number | null;
  /** Called after a successful save with the refreshed items list. */
  onSaveComplete?: (items: GarmentOrderItemRow[]) => void;
  onCancel?: () => void;
  /**
   * Draft mode: when true, the editor hides its own Save button and calls
   * onDraftChange whenever the selection changes. The parent is responsible
   * for persisting the items (e.g. after creating the order+GO).
   */
  draftMode?: boolean;
  /** Called whenever selections change in draft mode. */
  onDraftChange?: (items: DraftItem[]) => void;
  /** When true, forces the editor into saving state (external trigger). */
  draftSaving?: boolean;
  /** Called whenever the computed total changes (base + variations + addons). */
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

// ─── Add-on matrix axes ──────────────────────────────────────────────────
//
// A matrix add-on prices combinations of option axes (shape × size × …),
// one variation row per combination. When an add-on uses 2+ axes we render
// grouped chip rows (one per axis) instead of a flat variation list and
// resolve the selection to the single matching variation row.

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

/** placement undefined = all rows (e.g. axis badges); null = agnostic only. */
function deriveAddonAxes(
  variations: CatalogAddonVariation[],
  placement?: string | null,
): AddonAxisInfo {
  const pool = placement === undefined ? variations : variationPool(variations, placement);
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

export function GarmentOrderEditor({
  garmentId,
  garmentOrderId,
  initialItems,
  basePrice,
  onSaveComplete,
  onCancel,
  draftMode = false,
  onDraftChange,
  draftSaving = false,
  onComputedTotalChange,
}: GarmentOrderEditorProps) {
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

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Track which item rows already exist for each selection, so we can diff
  // on save. keyed by a stable signature string.
  const [existingItems, setExistingItems] =
    useState<GarmentOrderItemRow[]>(initialItems);

  // ── Load the garment tree ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGarmentTree(garmentId)
      .then((t) => {
        if (cancelled) return;
        setTree(t);

        // Initialise component selections from defaults / existing items
        const nextComps: Record<string, ComponentSelection> = {};
        for (const comp of t.components) {
          const existing = initialItems.find(
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
              variationTypeId: v0.default_type_id ?? v0.variation_types[0]?.id ?? null,
            };
          }
        }
        setComponentSelections(nextComps);

        // Initialise addon selections from existing items / defaults.
        // One slot per existing (addon, placement) item — the same add-on can
        // appear on several placements, each with its own variation.
        const nextAddons: Record<string, AddonSelection> = {};
        for (const addon of t.addons) {
          const existing = initialItems.filter(
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
            const isPlacementBased = (addon.placements ?? []).length > 0;
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
  }, [garmentId]);

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

  // ── Notify parent in draft mode ────────────────────────────────────────
  useEffect(() => {
    if (draftMode && onDraftChange) {
      onDraftChange(desiredItems);
    }
  }, [desiredItems, draftMode, onDraftChange]);

  // ── Notify parent of computed total ─────────────────────────────────────
  useEffect(() => {
    onComputedTotalChange?.(computedTotal);
  }, [computedTotal, onComputedTotalChange]);

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
        if ((addon?.placements ?? []).length === 0) {
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
    setSaveMsg(null);

    try {
      // Build the "desired" set of items from current selections.
      interface DesiredItem {
        // signature for matching against existing rows
        componentId: string | null;
        addonId: string | null;
        variationId: string | null;
        variationTypeId: string | null;
        addonVariationId: string | null;
        type: "variation" | "add_on";
        placement: string | null;
        price: number | null;
        labelSnapshot: string;
      }

      const desired: DesiredItem[] = [];

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
        desired.push({
          componentId: comp.id,
          addonId: null,
          variationId: v.id,
          variationTypeId: vt?.id ?? null,
          addonVariationId: null,
          type: "variation",
          placement: null,
          price: vt?.price ?? v.price ?? null,
          labelSnapshot: buildLabelSnapshot(compLabel, varLabel, vtLabel),
        });
      }

      // Add-ons → one item per placement slot (mirrors desiredItems)
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
          desired.push({
            componentId: null,
            addonId: addon.id,
            variationId: null,
            variationTypeId: null,
            addonVariationId: av?.id ?? null,
            type: "add_on",
            placement: slot.placement,
            price: (addon.price ?? 0) + (av?.price ?? 0) || null,
            labelSnapshot: buildAddonLabel(addonLabel, avLabel, slot.placement),
          });
        }
      }

      // Diff against existing items.
      // Match key: one item per component / per (add-on, placement).
      const desiredKey = (d: DesiredItem) =>
        d.type === "variation"
          ? `variation:${d.componentId}`
          : `add_on:${d.addonId}:${d.placement ?? ""}`;
      const existingKey = (it: GarmentOrderItemRow) =>
        it.type === "variation"
          ? `variation:${it.garment_style_component_id}`
          : `add_on:${it.addon_id}:${normalizePlacement(it.placement) ?? ""}`;

      const findExisting = (d: DesiredItem) =>
        existingItems.find((it) => existingKey(it) === desiredKey(d));

      const desiredKeys = new Set(desired.map(desiredKey));

      const updatedItems: GarmentOrderItemRow[] = [];

      // 1. Delete items that are no longer desired
      for (const it of existingItems) {
        if (!desiredKeys.has(existingKey(it))) {
          await deleteTableRow("garment_orders_items", it.id);
        }
      }

      // 2. Create or update desired items
      for (const d of desired) {
        const existing = findExisting(d);
        // placement is stored as a JSONB array (["Sleeves"]); null where N/A.
        const payload: Record<string, unknown> = {
          garment_order_id: garmentOrderId,
          type: d.type,
          garment_style_component_id: d.componentId,
          variation_id: d.variationId,
          variation_type_id: d.variationTypeId,
          addon_id: d.addonId,
          addon_variation_id: d.addonVariationId,
          placement: d.placement ? [d.placement] : null,
          label_snapshot: d.labelSnapshot,
        };

        if (existing) {
          // Update if anything changed. Price is deliberately absent: the
          // backend rejects direct writes (prices come from the catalog +
          // adjustment rows), so a stored/catalog price delta is not a change
          // we can persist — comparing it would fire a no-op update on every
          // save for admin-created items whose stored snapshot is null.
          const needsUpdate =
            existing.variation_id !== d.variationId ||
            existing.variation_type_id !== d.variationTypeId ||
            existing.addon_variation_id !== d.addonVariationId ||
            normalizePlacement(existing.placement) !== d.placement ||
            (existing.label_snapshot ?? null) !== (d.labelSnapshot ?? null);
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
      setSaveMsg(`Saved ${updatedItems.length} items`);
      onSaveComplete?.(updatedItems);
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [tree, componentSelections, addonSelections, existingItems, garmentOrderId, onSaveComplete]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded-xl border border-hairline bg-chalk-white p-6 text-center text-sm text-muted">
        Loading garment catalog…
      </div>
    );
  }

  if (error || !tree) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error ?? "Failed to load garment tree"}
      </div>
    );
  }

  const garmentLabel = catalogLabel(tree.labels, tree.slug ?? garmentId);

  return (
    <div className="rounded-xl border border-tape/40 bg-tape/5 p-4 md:p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Design Editor
          </div>
          <h3 className="font-heading text-lg font-semibold text-ink-navy">
            {garmentLabel}
          </h3>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Computed total
          </div>
          <div className="font-mono text-lg font-semibold text-ink-navy">
            {formatPrice(computedTotal)}
          </div>
        </div>
      </div>

      {saveMsg && (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700">
          {saveMsg}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* ── Components ─────────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Components ({tree.components.length})
        </div>
        <div className="space-y-2">
          {tree.components.map((comp) => (
            <ComponentEditor
              key={comp.id}
              component={comp}
              selection={componentSelections[comp.id]}
              onSelectVariation={(vid) => selectVariation(comp.id, vid)}
              onSelectVariationType={(vid, vtid) =>
                selectVariationType(comp.id, vid, vtid)
              }
            />
          ))}
        </div>
      </div>

      {/* ── Add-ons ────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Add-ons ({tree.addons.length})
        </div>
        <div className="space-y-2">
          {tree.addons.map((addon) => (
            <AddonEditor
              key={addon.id}
              addon={addon}
              selection={addonSelections[addon.id]}
              onToggle={(en) => toggleAddon(addon.id, en)}
              onTogglePlacement={(p, on) => togglePlacement(addon.id, p, on)}
              onSelectSlotVariation={(p, vid) =>
                selectSlotVariation(addon.id, p, vid)
              }
            />
          ))}
        </div>
      </div>

      {/* ── Footer actions ─────────────────────────────────────────────── */}
      {!draftMode && (
        <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-muted hover:bg-mist-navy disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Design"}
          </button>
        </div>
      )}
      {draftMode && draftSaving && (
        <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
          <span className="text-xs text-muted">Saving design…</span>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

/** A single component editor — accordion with selectable variations. */
function ComponentEditor({
  component,
  selection,
  onSelectVariation,
  onSelectVariationType,
}: {
  component: CatalogComponent;
  selection: ComponentSelection | undefined;
  onSelectVariation: (variationId: string) => void;
  onSelectVariationType: (
    variationId: string,
    variationTypeId: string,
  ) => void;
}) {
  const label = catalogLabel(component.labels, component.id);
  const [expanded, setExpanded] = useState(true);

  const selectedVariation = selection
    ? component.variations.find((v) => v.id === selection.variationId)
    : null;
  const selectedVariationType =
    selectedVariation && selection?.variationTypeId
      ? selectedVariation.variation_types.find(
          (vt) => vt.id === selection.variationTypeId,
        )
      : null;

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-chalk-white">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-mist-navy/30"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`h-3 w-3 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-medium text-ink-navy">{label}</span>
        </div>
        <div className="text-[11px] text-muted">
          {selectedVariation
            ? catalogLabel(selectedVariation.labels, selectedVariation.id)
            : "Not set"}
          {selectedVariationType
            ? ` → ${catalogLabel(selectedVariationType.labels, selectedVariationType.id)}`
            : ""}
          {selectedVariationType?.price
            ? ` (+${formatPrice(selectedVariationType.price)})`
            : selectedVariation?.price
              ? ` (+${formatPrice(selectedVariation.price)})`
              : ""}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-hairline px-3 py-2">
          <div className="flex flex-wrap gap-2">
            {component.variations.map((v) => {
              const isSel = selection?.variationId === v.id;
              return (
                <VariationChipAndSub
                  key={v.id}
                  variation={v}
                  selected={isSel}
                  selectedTypeId={
                    isSel ? selection?.variationTypeId ?? undefined : undefined
                  }
                  onSelectVariation={() => onSelectVariation(v.id)}
                  onSelectVariationType={(vtid) =>
                    onSelectVariationType(v.id, vtid)
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** A variation chip + its sub-option chips if it has variation_types. */
function VariationChipAndSub({
  variation,
  selected,
  selectedTypeId,
  onSelectVariation,
  onSelectVariationType,
}: {
  variation: CatalogVariation;
  selected: boolean;
  selectedTypeId: string | undefined;
  onSelectVariation: () => void;
  onSelectVariationType: (variationTypeId: string) => void;
}) {
  const label = catalogLabel(variation.labels, variation.id);
  const hasTypes = variation.variation_types.length > 0;
  const priceLabel = variation.price ? ` +${formatPrice(variation.price)}` : "";

  return (
    <div className="w-full">
      <button
        onClick={onSelectVariation}
        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
          selected
            ? "border-ink-navy bg-ink-navy text-chalk-white"
            : "border-hairline-strong bg-chalk-white text-ink hover:bg-mist-navy"
        }`}
      >
        {label}
        {priceLabel && (
          <span className={selected ? "opacity-80" : "text-muted"}>
            {priceLabel}
          </span>
        )}
      </button>

      {/* Sub-option chips */}
      {selected && hasTypes && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-2">
          {variation.variation_types.map((vt) => {
            const vtLabel = catalogLabel(vt.labels, vt.id);
            const vtPrice = vt.price ? ` +${formatPrice(vt.price)}` : "";
            const vtSel = selectedTypeId === vt.id;
            return (
              <button
                key={vt.id}
                onClick={() => onSelectVariationType(vt.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  vtSel
                    ? "border-tape bg-tape/10 text-ink-navy"
                    : "border-hairline-strong bg-chalk-white text-muted hover:bg-mist-navy"
                }`}
              >
                {vtLabel}
                {vtPrice && <span className="opacity-70">{vtPrice}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  const matrix = useMemo(
    () => deriveAddonAxes(addon.variations, placement),
    [addon.variations, placement],
  );
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
  // matches it and the picks already made on every other axis.
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
          <div key={ax}>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
              {cap(ax)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {matrix.values[ax].map((v) => {
                const vSel = currentPicks[ax] === v;
                const avail = valueAvailable(ax, v);
                return (
                  <button
                    key={v}
                    disabled={!avail}
                    onClick={() => pickAxisValue(ax, vSel ? null : v)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                      vSel
                        ? "border-tape bg-tape/10 text-ink-navy"
                        : "border-hairline-strong bg-chalk-white text-muted hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-30"
                    }`}
                  >
                    {cap(v)}
                  </button>
                );
              })}
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
            "Pick an option in each row to see the price."
          )}
        </div>
      </div>
    );
  }

  // Flat variation list (single axis or none)
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
        Variation
      </div>
      <div className="flex flex-wrap gap-1.5">
        {matrix.pool.map((av) => {
          const avLabel = catalogLabel(av.labels, av.id);
          const avSel = selectedVariationId === av.id;
          return (
            <button
              key={av.id}
              onClick={() => onSelectVariation(avSel ? null : av.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                avSel
                  ? "border-tape bg-tape/10 text-ink-navy"
                  : "border-hairline-strong bg-chalk-white text-muted hover:bg-mist-navy"
              }`}
            >
              {avLabel}
              {av.price ? ` +${formatPrice(av.price)}` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A single add-on editor — toggle + one variation picker per placement slot.
 * The same add-on can be enabled on several placements, each with its own
 * combination (e.g. Back neck → small round, Sleeves → large flat).
 */
function AddonEditor({
  addon,
  selection,
  onToggle,
  onTogglePlacement,
  onSelectSlotVariation,
}: {
  addon: CatalogAddon;
  selection: AddonSelection | undefined;
  onToggle: (enabled: boolean) => void;
  onTogglePlacement: (placement: string, on: boolean) => void;
  onSelectSlotVariation: (
    placement: string | null,
    variationId: string | null,
  ) => void;
}) {
  const label = catalogLabel(addon.labels, addon.id);
  const enabled = selection?.enabled ?? false;
  const placements = addon.placements ?? [];
  const isPlacementBased = placements.length > 0;
  const slots = selection?.slots ?? [];

  const matrix = useMemo(
    () => deriveAddonAxes(addon.variations),
    [addon.variations],
  );
  const isMatrix = matrix.axes.length >= 2;

  // Resolved price total across slots (for the header) — additive:
  // base price + selected variation price per slot, matching the backend.
  let slotTotal = 0;
  for (const slot of slots) {
    const av = slot.variationId
      ? addon.variations.find((x) => x.id === slot.variationId)
      : null;
    slotTotal += (addon.price ?? 0) + (av?.price ?? 0);
  }

  // Resolve the price of one slot for its sub-block header — additive.
  function slotPrice(slot: AddonSlot): number | null {
    const av = slot.variationId
      ? addon.variations.find((x) => x.id === slot.variationId)
      : null;
    return (addon.price ?? 0) + (av?.price ?? 0) || null;
  }

  return (
    <div
      className={`rounded-lg border bg-chalk-white transition ${
        enabled
          ? "border-tape/50 bg-tape/5"
          : "border-hairline"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Toggle */}
          <button
            onClick={() => onToggle(!enabled)}
            className={`relative h-5 w-9 rounded-full transition ${
              enabled ? "bg-tape" : "bg-hairline-strong"
            }`}
            aria-label={enabled ? "Disable" : "Enable"}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-chalk-white shadow transition-all ${
                enabled ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
          <span className="text-sm font-medium text-ink-navy">{label}</span>
          {addon.type && (
            <span className="rounded-pill bg-mist-navy px-1.5 py-0.5 text-[10px] text-muted">
              {addon.type}
            </span>
          )}
          {isMatrix && (
            <span className="rounded-pill bg-mist-navy px-1.5 py-0.5 text-[10px] text-muted">
              {matrix.axes.map(cap).join(" × ")}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted">
          {enabled && slots.length > 0
            ? `+${formatPrice(slotTotal)}${slots.length > 1 ? ` (${slots.length}×)` : ""}`
            : addon.price
              ? formatPrice(addon.price)
              : ""}
        </div>
      </div>

      {/* Expanded add-on config */}
      {enabled && (
        <div className="border-t border-hairline px-3 py-2">
          {isPlacementBased ? (
            <>
              {/* Placement chips — multi-select; each active placement gets
                  its own slot (its own variation combination). */}
              <div className="mb-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                  Placements
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {placements.map((p) => {
                    const slot = slots.find((s) => s.placement === p);
                    return (
                      <button
                        key={p}
                        onClick={() => onTogglePlacement(p, !slot)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                          slot
                            ? "border-tape bg-tape/10 text-ink-navy"
                            : "border-hairline-strong bg-chalk-white text-muted hover:bg-mist-navy"
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* One variation picker per active placement */}
              {slots.length === 0 && (
                <div className="text-[11px] text-muted">
                  Pick at least one placement.
                </div>
              )}
              <div className="space-y-2">
                {slots.map((slot) => (
                  <div
                    key={slot.placement ?? "none"}
                    className="rounded-md border border-hairline bg-chalk-white px-2.5 py-2"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink-navy">
                        {slot.placement}
                        {slotPrice(slot) != null && (
                          <span className="ml-1.5 font-mono text-[11px] text-muted">
                            +{formatPrice(slotPrice(slot))}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() =>
                          slot.placement && onTogglePlacement(slot.placement, false)
                        }
                        className="text-[11px] text-muted hover:text-ink-navy"
                        aria-label={`Remove ${slot.placement}`}
                      >
                        Remove
                      </button>
                    </div>
                    <AddonVariationPicker
                      addon={addon}
                      placement={slot.placement}
                      selectedVariationId={slot.variationId}
                      onSelectVariation={(vid) =>
                        onSelectSlotVariation(slot.placement, vid)
                      }
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Placement-less add-on: a single picker for the single slot. */
            <AddonVariationPicker
              addon={addon}
              placement={null}
              selectedVariationId={
                slots.find((s) => s.placement === null)?.variationId ?? null
              }
              onSelectVariation={(vid) => onSelectSlotVariation(null, vid)}
            />
          )}
        </div>
      )}
    </div>
  );
}
