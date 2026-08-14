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
  type GarmentOrderItemRow,
} from "@/lib/admin-api";

// ─── Types ─────────────────────────────────────────────────────────────

/** A single selected component, held in local state before saving. */
interface ComponentSelection {
  componentId: string;
  variationId: string;
  variationTypeId: string | null;
}

/** A single selected add-on, held in local state before saving. */
interface AddonSelection {
  addonId: string;
  enabled: boolean;
  variationId: string | null;
  placement: string | null;
}

/** A collected draft item (before persistence) for draft mode. */
export interface DraftItem {
  type: "variation" | "add_on";
  garment_style_component_id: string | null;
  variation_id: string | null;
  variation_type_id: string | null;
  addon_id: string | null;
  addon_variation_id: string | null;
  placement: string | null;
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
): string {
  if (variationLabel) return `${addonLabel} → ${variationLabel}`;
  return addonLabel;
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

        // Initialise addon selections from existing items / defaults
        const nextAddons: Record<string, AddonSelection> = {};
        for (const addon of t.addons) {
          const existing = initialItems.find(
            (it) => it.type === "add_on" && it.addon_id === addon.id,
          );
          if (existing) {
            nextAddons[addon.id] = {
              addonId: addon.id,
              enabled: true,
              variationId: existing.addon_variation_id ?? null,
              placement: existing.placement ?? null,
            };
          } else {
            nextAddons[addon.id] = {
              addonId: addon.id,
              enabled: Boolean(addon.is_default_on),
              variationId: addon.default_variation_id ?? null,
              placement: null,
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

    // Add-ons: add addon price or variation price
    for (const addon of tree.addons) {
      const sel = addonSelections[addon.id];
      if (!sel?.enabled) continue;
      if (sel.variationId) {
        const av = addon.variations.find((x) => x.id === sel.variationId);
        if (av?.price) total += av.price;
      } else if (addon.price) {
        total += addon.price;
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

    // Add-ons → add_on items (only enabled)
    for (const addon of tree.addons) {
      const sel = addonSelections[addon.id];
      if (!sel?.enabled) continue;
      const av = sel.variationId
        ? addon.variations.find((x) => x.id === sel.variationId)
        : null;
      const addonLabel = catalogLabel(addon.labels, addon.id);
      const avLabel = av ? catalogLabel(av.labels, av.id) : null;
      items.push({
        type: "add_on",
        garment_style_component_id: null,
        variation_id: null,
        variation_type_id: null,
        addon_id: addon.id,
        addon_variation_id: av?.id ?? null,
        placement: sel.placement,
        price: av?.price ?? addon.price ?? null,
        label_snapshot: buildAddonLabel(addonLabel, avLabel),
      });
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

  function toggleAddon(addonId: string, enabled: boolean) {
    setAddonSelections((prev) => ({
      ...prev,
      [addonId]: {
        ...prev[addonId],
        addonId,
        enabled,
      },
    }));
  }

  function selectAddonVariation(addonId: string, variationId: string | null) {
    setAddonSelections((prev) => ({
      ...prev,
      [addonId]: {
        ...prev[addonId],
        addonId,
        variationId,
      },
    }));
  }

  function setAddonPlacement(addonId: string, placement: string | null) {
    setAddonSelections((prev) => ({
      ...prev,
      [addonId]: {
        ...prev[addonId],
        placement,
      },
    }));
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

      // Add-ons → add_on items (only enabled)
      for (const addon of tree.addons) {
        const sel = addonSelections[addon.id];
        if (!sel?.enabled) continue;
        const av = sel.variationId
          ? addon.variations.find((x) => x.id === sel.variationId)
          : null;
        const addonLabel = catalogLabel(addon.labels, addon.id);
        const avLabel = av ? catalogLabel(av.labels, av.id) : null;
        desired.push({
          componentId: null,
          addonId: addon.id,
          variationId: null,
          variationTypeId: null,
          addonVariationId: av?.id ?? null,
          type: "add_on",
          placement: sel.placement,
          price: av?.price ?? addon.price ?? null,
          labelSnapshot: buildAddonLabel(addonLabel, avLabel),
        });
      }

      // Diff against existing items.
      // Match key: (type, componentId, addonId). One item per component / addon.
      const findExisting = (d: DesiredItem) =>
        existingItems.find((it) => {
          if (it.type !== d.type) return false;
          if (d.type === "variation") {
            return it.garment_style_component_id === d.componentId;
          }
          return it.addon_id === d.addonId;
        });

      const desiredKeys = new Set(
        desired.map(
          (d) => `${d.type}:${d.componentId ?? d.addonId}`,
        ),
      );

      const updatedItems: GarmentOrderItemRow[] = [];

      // 1. Delete items that are no longer desired
      for (const it of existingItems) {
        const key = `${it.type}:${it.type === "variation" ? it.garment_style_component_id : it.addon_id}`;
        if (!desiredKeys.has(key)) {
          await deleteTableRow("garment_orders_items", it.id);
        }
      }

      // 2. Create or update desired items
      for (const d of desired) {
        const existing = findExisting(d);
        const payload: Record<string, unknown> = {
          garment_order_id: garmentOrderId,
          type: d.type,
          garment_style_component_id: d.componentId,
          variation_id: d.variationId,
          variation_type_id: d.variationTypeId,
          addon_id: d.addonId,
          addon_variation_id: d.addonVariationId,
          placement: d.placement,
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
            (existing.placement ?? null) !== (d.placement ?? null) ||
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
              onSelectVariation={(vid) =>
                selectAddonVariation(addon.id, vid)
              }
              onPlacementChange={(p) => setAddonPlacement(addon.id, p)}
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

/** A single add-on editor — toggle + optional variation chips + placement. */
function AddonEditor({
  addon,
  selection,
  onToggle,
  onSelectVariation,
  onPlacementChange,
}: {
  addon: CatalogAddon;
  selection: AddonSelection | undefined;
  onToggle: (enabled: boolean) => void;
  onSelectVariation: (variationId: string | null) => void;
  onPlacementChange: (placement: string | null) => void;
}) {
  const label = catalogLabel(addon.labels, addon.id);
  const enabled = selection?.enabled ?? false;
  const placements = addon.placements ?? [];

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
        </div>
        <div className="text-[11px] text-muted">
          {addon.price ? formatPrice(addon.price) : ""}
        </div>
      </div>

      {/* Expanded add-on config */}
      {enabled && (
        <div className="border-t border-hairline px-3 py-2">
          {/* Variations */}
          {addon.variations.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                Variation
              </div>
              <div className="flex flex-wrap gap-1.5">
                {addon.variations.map((av) => {
                  const avLabel = catalogLabel(av.labels, av.id);
                  const avSel = selection?.variationId === av.id;
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
          )}

          {/* Placements */}
          {placements.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                Placement
              </div>
              <div className="flex flex-wrap gap-1.5">
                {placements.map((p) => {
                  const pSel = selection?.placement === p;
                  return (
                    <button
                      key={p}
                      onClick={() =>
                        onPlacementChange(pSel ? null : p)
                      }
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                        pSel
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
          )}
        </div>
      )}
    </div>
  );
}
