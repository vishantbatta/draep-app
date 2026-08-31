"use client";

/**
 * LibrarySelectionSheet — the order page's "Edit selections" bottom sheet,
 * wired to a design-library entry instead of a garment order.
 *
 * Same UX as the customer-facing GarmentSelectionSheet (components as cards
 * with variation pills + nested Type pill rows, add-on cards with
 * "+ Add / ✓ Added" toggles, placement chips, sticky "Save N changes"
 * footer) with three deliberate differences forced by the library's data
 * model (garment_library_items):
 *
 *   1. One row per component — no catalog-default seeding. A library design
 *      is a curated subset, so components without a row render with no pill
 *      chosen; picking one creates the row, tapping the active variation
 *      again removes it (row deleted on save). Orders always fully specify
 *      every component — a library doesn't have to.
 *   2. One row per add-on — the unique index (library_id, addon_id) forbids
 *      the order sheet's multi-slot model, so placements are a multi-select
 *      array stored on that single row, and the add-on variation is shared
 *      across all chosen placements.
 *   3. Rows carry no price or label snapshot — the library resolves live
 *      prices at browse/draft time. The total shown here is computed from
 *      the catalog tree purely for the admin's orientation; nothing is
 *      written through the library endpoints.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  adminCreateLibraryItem,
  adminDeleteLibraryItem,
  adminListLibraryItems,
  adminUpdateLibraryItem,
  catalogLabel,
  fetchGarmentTree,
  type CatalogAddon,
  type CatalogComponent,
  type GarmentTree,
  type LibraryItem,
} from "@/lib/admin-api";

// ─── Local selection state ───────────────────────────────────────────────

/** One component's pick, mirroring GarmentSelectionSheet's shape. */
interface ComponentSelection {
  variationId: string;
  variationTypeId: string | null;
}

/**
 * One add-on's pick — a single row in garment_library_items: the add-on,
 * optionally one variation, and any number of placements on the shared row.
 */
interface AddonSelection {
  variationId: string | null;
  placements: string[];
}

/** The desired shape of one library item row, used for the save diff. */
interface DesiredItem {
  type: "variation" | "add_on";
  garment_style_component_id: string | null;
  variation_id: string | null;
  variation_type_id: string | null;
  addon_id: string | null;
  addon_variation_id: string | null;
  placement: string[] | null;
}

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

/** Order-insensitive placement comparison (the row stores a JSONB array). */
function placementsDiffer(a: string[] | null, b: string[] | null): boolean {
  const as = [...(a ?? [])].sort().join("\u0000");
  const bs = [...(b ?? [])].sort().join("\u0000");
  return as !== bs;
}

// ─── Component ───────────────────────────────────────────────────────────

export function LibrarySelectionSheet({
  open,
  libraryId,
  garmentId,
  garmentLabel,
  basePrice,
  onClose,
  onSaved,
}: {
  open: boolean;
  libraryId: string;
  garmentId: string | null;
  /** Display name for the garment header chip. */
  garmentLabel: string;
  basePrice: number | null;
  onClose: () => void;
  /** Called after a successful save with the refreshed rows. */
  onSaved?: (items: LibraryItem[]) => void;
}) {
  const [tree, setTree] = useState<GarmentTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // componentId → pick; absent key = no row for that component.
  const [componentSelections, setComponentSelections] = useState<
    Record<string, ComponentSelection>
  >({});
  // addonId → pick; absent key = add-on not in the design.
  const [addonSelections, setAddonSelections] = useState<
    Record<string, AddonSelection>
  >({});

  // The rows the desired items are diffed against on save.
  const [existingItems, setExistingItems] = useState<LibraryItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // ── Load tree + rows and seed selections on open ────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSavedCount(null);
    (async () => {
      try {
        const [t, items] = await Promise.all([
          garmentId
            ? fetchGarmentTree(garmentId)
            : Promise.reject(new Error("Design has no garment configured.")),
          adminListLibraryItems(libraryId),
        ]);
        if (cancelled) return;
        setTree(t);
        setExistingItems(items);

        // Seed from saved rows only — no catalog defaults (see header note).
        const nextComps: Record<string, ComponentSelection> = {};
        for (const it of items) {
          if (it.type !== "variation" || !it.garment_style_component_id) continue;
          nextComps[it.garment_style_component_id] = {
            variationId: it.variation_id ?? "",
            variationTypeId: it.variation_type_id ?? null,
          };
        }
        setComponentSelections(nextComps);

        const nextAddons: Record<string, AddonSelection> = {};
        for (const it of items) {
          if (it.type !== "add_on" || !it.addon_id) continue;
          nextAddons[it.addon_id] = {
            variationId: it.addon_variation_id ?? null,
            placements: it.placement ?? [],
          };
        }
        setAddonSelections(nextAddons);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load the design");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, libraryId, garmentId]);

  // ── Desired rows from current selections ────────────────────────────────
  const desiredItems: DesiredItem[] = useMemo(() => {
    if (!tree) return [];
    const items: DesiredItem[] = [];
    for (const comp of tree.components) {
      const sel = componentSelections[comp.id];
      // Absent key = component deliberately left out of the design.
      if (!sel || !sel.variationId) continue;
      const v = comp.variations.find((x) => x.id === sel.variationId);
      if (!v) continue;
      const vt = sel.variationTypeId
        ? v.variation_types.find((x) => x.id === sel.variationTypeId)
        : null;
      // A stale type id (variation switched but type row lagging) must not
      // be written — drop the type instead of writing a cross-table orphan.
      items.push({
        type: "variation",
        garment_style_component_id: comp.id,
        variation_id: v.id,
        variation_type_id: vt?.id ?? null,
        addon_id: null,
        addon_variation_id: null,
        placement: null,
      });
    }
    for (const addon of tree.addons) {
      const sel = addonSelections[addon.id];
      if (!sel) continue;
      items.push({
        type: "add_on",
        garment_style_component_id: null,
        variation_id: null,
        variation_type_id: null,
        addon_id: addon.id,
        addon_variation_id: sel.variationId,
        placement: sel.placements.length > 0 ? sel.placements : null,
      });
    }
    return items;
  }, [tree, componentSelections, addonSelections]);

  // ── Diff: how many row writes a save performs ───────────────────────────
  const changeCount = useMemo(() => {
    if (!tree) return 0;
    const desiredComp = new Map(
      desiredItems
        .filter((d) => d.type === "variation")
        .map((d) => [d.garment_style_component_id, d] as const),
    );
    const desiredAddon = new Map(
      desiredItems
        .filter((d) => d.type === "add_on")
        .map((d) => [d.addon_id, d] as const),
    );
    let n = 0;
    for (const it of existingItems) {
      const d =
        it.type === "variation"
          ? desiredComp.get(it.garment_style_component_id)
          : desiredAddon.get(it.addon_id);
      if (!d) n++; // deleted
    }
    for (const d of desiredItems) {
      const existing =
        d.type === "variation"
          ? existingItems.find(
              (it) =>
                it.type === "variation" &&
                it.garment_style_component_id === d.garment_style_component_id,
            )
          : existingItems.find(
              (it) => it.type === "add_on" && it.addon_id === d.addon_id,
            );
      if (!existing) {
        n++; // created
        continue;
      }
      if (
        existing.variation_id !== d.variation_id ||
        existing.variation_type_id !== d.variation_type_id ||
        existing.addon_variation_id !== d.addon_variation_id ||
        placementsDiffer(existing.placement, d.placement)
      ) {
        n++; // updated
      }
    }
    return n;
  }, [tree, desiredItems, existingItems]);

  // ── Live total (orientation only — never written) ───────────────────────
  const base = basePrice ?? tree?.base_price ?? 0;
  const computedTotal = useMemo(() => {
    let total = base;
    if (!tree) return total;
    for (const comp of tree.components) {
      const sel = componentSelections[comp.id];
      if (!sel) continue;
      const v = comp.variations.find((x) => x.id === sel.variationId);
      if (!v) continue;
      total += v.price ?? 0;
      if (sel.variationTypeId) {
        const vt = v.variation_types.find((x) => x.id === sel.variationTypeId);
        if (vt) total += vt.price ?? 0;
      }
    }
    for (const addon of tree.addons) {
      const sel = addonSelections[addon.id];
      if (!sel) continue;
      const av = sel.variationId
        ? addon.variations.find((x) => x.id === sel.variationId)
        : null;
      total += addon.price ?? 0;
      if (av) total += av.price ?? 0;
    }
    return total;
  }, [tree, componentSelections, addonSelections, base]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function selectVariation(comp: CatalogComponent, variationId: string) {
    setComponentSelections((prev) => {
      const next = { ...prev };
      // Tapping the active variation removes the component from the design
      // (the row is deleted on save) — the library equivalent of the old
      // ItemsEditor's per-row ✕.
      if (prev[comp.id]?.variationId === variationId) {
        delete next[comp.id];
        return next;
      }
      const v = comp.variations.find((x) => x.id === variationId);
      next[comp.id] = {
        variationId,
        variationTypeId: v?.default_type_id ?? v?.variation_types[0]?.id ?? null,
      };
      return next;
    });
  }

  function selectVariationType(
    componentId: string,
    variationTypeId: string | null,
  ) {
    setComponentSelections((prev) => {
      const sel = prev[componentId];
      if (!sel) return prev;
      return {
        ...prev,
        [componentId]: {
          ...sel,
          variationTypeId:
            sel.variationTypeId === variationTypeId ? null : variationTypeId,
        },
      };
    });
  }

  function toggleAddon(addon: CatalogAddon) {
    setAddonSelections((prev) => {
      const next = { ...prev };
      if (next[addon.id]) {
        delete next[addon.id];
        return next;
      }
      // A new add-on starts with its catalog default variation (when valid).
      const def = addon.default_variation_id
        ? addon.variations.find((v) => v.id === addon.default_variation_id)
        : undefined;
      next[addon.id] = {
        variationId: def?.id ?? addon.variations[0]?.id ?? null,
        placements: [],
      };
      return next;
    });
  }

  function selectAddonVariation(addonId: string, variationId: string | null) {
    setAddonSelections((prev) => {
      const sel = prev[addonId];
      if (!sel) return prev;
      return { ...prev, [addonId]: { ...sel, variationId } };
    });
  }

  function toggleAddonPlacement(addonId: string, placement: string) {
    setAddonSelections((prev) => {
      const sel = prev[addonId];
      if (!sel) return prev;
      const has = sel.placements.includes(placement);
      return {
        ...prev,
        [addonId]: {
          ...sel,
          placements: has
            ? sel.placements.filter((p) => p !== placement)
            : [...sel.placements, placement],
        },
      };
    });
  }

  // ── Save: diff against saved rows and CRUD through the library endpoints ─
  const handleSave = useCallback(async () => {
    if (!tree) return;
    setSaving(true);
    setError(null);
    setSavedCount(null);
    try {
      const desiredComp = new Map(
        desiredItems
          .filter((d) => d.type === "variation")
          .map((d) => [d.garment_style_component_id, d] as const),
      );
      const desiredAddon = new Map(
        desiredItems
          .filter((d) => d.type === "add_on")
          .map((d) => [d.addon_id, d] as const),
      );

      // 1. Delete rows no longer desired.
      for (const it of existingItems) {
        const d =
          it.type === "variation"
            ? desiredComp.get(it.garment_style_component_id)
            : desiredAddon.get(it.addon_id);
        if (!d) await adminDeleteLibraryItem(it.id);
      }

      // 2. Create or update desired rows.
      for (const d of desiredItems) {
        const existing =
          d.type === "variation"
            ? existingItems.find(
                (it) =>
                  it.type === "variation" &&
                  it.garment_style_component_id ===
                    d.garment_style_component_id,
              )
            : existingItems.find(
                (it) => it.type === "add_on" && it.addon_id === d.addon_id,
              );
        if (!existing) {
          await adminCreateLibraryItem(libraryId, {
            garment_style_component_id: d.garment_style_component_id,
            variation_id: d.variation_id,
            variation_type_id: d.variation_type_id,
            addon_id: d.addon_id,
            addon_variation_id: d.addon_variation_id,
            placement: d.placement,
          });
        } else if (
          existing.variation_id !== d.variation_id ||
          existing.variation_type_id !== d.variation_type_id ||
          existing.addon_variation_id !== d.addon_variation_id ||
          placementsDiffer(existing.placement, d.placement)
        ) {
          await adminUpdateLibraryItem(existing.id, {
            variation_id: d.variation_id,
            variation_type_id: d.variation_type_id,
            addon_variation_id: d.addon_variation_id,
            placement: d.placement,
          });
        }
      }

      const refreshed = await adminListLibraryItems(libraryId);
      setExistingItems(refreshed);
      // Re-seed from the refreshed rows so the diff base matches the server.
      const nextComps: Record<string, ComponentSelection> = {};
      for (const it of refreshed) {
        if (it.type !== "variation" || !it.garment_style_component_id) continue;
        nextComps[it.garment_style_component_id] = {
          variationId: it.variation_id ?? "",
          variationTypeId: it.variation_type_id ?? null,
        };
      }
      setComponentSelections(nextComps);
      const nextAddons: Record<string, AddonSelection> = {};
      for (const it of refreshed) {
        if (it.type !== "add_on" || !it.addon_id) continue;
        nextAddons[it.addon_id] = {
          variationId: it.addon_variation_id ?? null,
          placements: it.placement ?? [],
        };
      }
      setAddonSelections(nextAddons);

      setSavedCount(refreshed.length);
      onSaved?.(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [tree, desiredItems, existingItems, libraryId, onSaved]);

  if (!open) return null;

  return (
    <BottomSheet
      open
      title="Edit selections"
      onClose={onClose}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-caption text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-navy border-t-transparent" />
          Loading selections…
        </div>
      ) : error && !tree ? (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-caption text-red-700">
          {error}
        </div>
      ) : tree ? (
        <>
          <div className="space-y-4">
            {/* Header: garment + live computed total (orientation only) */}
            <div className="flex items-center justify-between gap-3 rounded-card border border-hairline bg-mist-navy/20 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-draep-orange">
                  {garmentLabel}
                </p>
                <p className="text-[11px] text-muted">
                  Base {formatPrice(base)} + selections
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  Total
                </p>
                <p className="font-mono text-[14px] font-semibold text-ink-navy">
                  {formatPrice(computedTotal)}
                </p>
              </div>
            </div>

            {/* ── Components: one card per part, variation pills ────────── */}
            {tree.components.map((comp) => {
              const sel = componentSelections[comp.id];
              const selectedVar = sel
                ? comp.variations.find((v) => v.id === sel.variationId)
                : undefined;
              const inDesign = Boolean(sel);
              return (
                <div
                  key={comp.id}
                  className={`space-y-2 rounded-card border px-3 py-3 ${
                    inDesign
                      ? "border-hairline bg-chalk-white"
                      : "border-dashed border-hairline-strong bg-chalk-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-draep-orange">
                      {catalogLabel(comp.labels, comp.id)}
                    </p>
                    {!inDesign && (
                      <span className="text-[10px] uppercase tracking-wide text-muted">
                        Not in design
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {comp.variations.map((v) => {
                      const isActive = sel?.variationId === v.id;
                      return (
                        <button
                          key={v.id}
                          onClick={() => selectVariation(comp, v.id)}
                          className={`rounded-pill px-3 py-1.5 text-[12px] font-medium transition ${
                            isActive
                              ? "bg-ink-navy text-chalk-white shadow-card"
                              : "border border-hairline-strong bg-chalk-white text-ink-navy hover:border-ink-navy"
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
                      <span className="text-[12px] text-muted">
                        No alternatives configured.
                      </span>
                    )}
                  </div>

                  {/* Type sub-pills for the chosen variation (e.g. Deep → U-shape) */}
                  {selectedVar && selectedVar.variation_types.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted">Type</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedVar.variation_types.map((vt) => {
                          const isActive = sel?.variationTypeId === vt.id;
                          return (
                            <button
                              key={vt.id}
                              onClick={() => selectVariationType(comp.id, vt.id)}
                              className={`rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                                isActive
                                  ? "bg-ink-navy text-chalk-white shadow-card"
                                  : "border border-hairline-strong bg-chalk-white text-ink-navy hover:border-ink-navy"
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

                  {inDesign && (
                    <p className="text-[10px] text-muted">
                      Tap the chosen variation again to remove this component
                      from the design.
                    </p>
                  )}
                </div>
              );
            })}

            {/* ── Add-ons: cards with add/remove, placement + variation ── */}
            {tree.addons.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Add-ons
                </p>
                {tree.addons.map((addon) => {
                  const sel = addonSelections[addon.id];
                  const enabled = Boolean(sel);
                  const av = sel?.variationId
                    ? addon.variations.find((x) => x.id === sel.variationId)
                    : null;
                  const hint = enabled
                    ? (addon.price ?? 0) + (av?.price ?? 0)
                    : (addon.price ??
                      addon.variations.find((v) => v.price != null)?.price ??
                      null);

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
                          <p className="text-[12px] font-medium text-ink-navy">
                            {catalogLabel(addon.labels, addon.id)}
                          </p>
                          {hint !== null && (
                            <p className="text-[11px] text-muted">
                              + {formatPrice(hint)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => toggleAddon(addon)}
                          className={`shrink-0 rounded-pill px-3 py-1.5 text-[12px] font-medium transition ${
                            enabled
                              ? "bg-ink-navy text-chalk-white shadow-card"
                              : "border border-hairline-strong bg-chalk-white text-ink-navy hover:border-ink-navy"
                          }`}
                        >
                          {enabled ? "✓ Added" : "+ Add"}
                        </button>
                      </div>

                      {/* Placements — one multi-select array on the single row. */}
                      {enabled && (addon.placements ?? []).length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-muted">
                            Placement
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(addon.placements ?? []).map((pl) => {
                              const isActive =
                                sel?.placements.includes(pl) ?? false;
                              return (
                                <button
                                  key={pl}
                                  onClick={() =>
                                    toggleAddonPlacement(addon.id, pl)
                                  }
                                  className={`rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                                    isActive
                                      ? "bg-ink-navy text-chalk-white shadow-card"
                                      : "border border-hairline-strong bg-chalk-white text-ink-navy hover:border-ink-navy"
                                  }`}
                                >
                                  {pl}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Variation pills (single shared pick across placements) */}
                      {enabled && addon.variations.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-muted">
                            Option
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {addon.variations.map((v) => {
                              const isActive = sel?.variationId === v.id;
                              return (
                                <button
                                  key={v.id}
                                  onClick={() =>
                                    selectAddonVariation(
                                      addon.id,
                                      isActive ? null : v.id,
                                    )
                                  }
                                  className={`rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                                    isActive
                                      ? "bg-ink-navy text-chalk-white shadow-card"
                                      : "border border-hairline-strong bg-chalk-white text-ink-navy hover:border-ink-navy"
                                  }`}
                                >
                                  {catalogLabel(v.labels, v.id)}
                                  {v.price != null && (
                                    <span
                                      className={isActive ? "opacity-80" : "text-muted"}
                                    >
                                      {" "}
                                      +{formatPrice(v.price)}
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
              </div>
            )}

            {error && (
              <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-caption text-red-700">
                {error}
              </div>
            )}

            {savedCount !== null && (
              <div className="rounded-card border border-green-200 bg-green-50 px-4 py-3 text-caption text-green-700">
                ✓ Selections saved — {savedCount} item
                {savedCount === 1 ? "" : "s"} in the design. Prices refresh on
                the storefront.
              </div>
            )}
          </div>

          {/* ── Footer — sticky save bar, same idiom as the order sheet ── */}
          <div className="sticky bottom-0 z-20 -mx-4 -mb-6 mt-4 flex gap-2 border-t border-hairline bg-chalk-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_16px_-8px_rgba(23,42,72,0.25)]">
            {savedCount !== null ? (
              <button
                onClick={onClose}
                className="flex-1 rounded-pill bg-ink-navy px-4 py-3 text-[14px] font-semibold text-chalk-white"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-[14px] font-medium text-ink-navy disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || changeCount === 0}
                  className="flex-[2] rounded-pill bg-ink-navy px-4 py-3 text-[14px] font-semibold text-chalk-white disabled:opacity-50"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                      Saving…
                    </span>
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
      ) : null}
    </BottomSheet>
  );
}
