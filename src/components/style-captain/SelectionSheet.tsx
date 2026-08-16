"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  scAddAddon,
  scFetchChecklist,
  scRemoveAddonItem,
  scUpdateSelection,
  type SCAvailableAddon,
  type SCAddonVariationOption,
  type SCSelection,
} from "@/lib/style-captain-api";
import { formatPrice } from "@/lib/pricing";
import { BottomSheet } from "./BottomSheet";
import { briefLabel } from "./GarmentSummaryCard";

/**
 * SelectionSheet — change the style selections of one garment instance
 * mid-visit (start screens + the step-through section-pill affordance).
 *
 * Each variation component lists its sibling variations as pills; picking one
 * with sub-types reveals a type pill row (pre-selected with the first type).
 * Add-ons are fully editable: catalog add-ons (available_addons) render as
 * cards with an add/remove toggle and placement chips for placement-based
 * add-ons. Variations that vary along parameters render one chip section per
 * parameter — Key Hole as Where · Shape · Size, Latkan as Size — the same
 * model as the customer /myod flow; multi-axis chips that can't complete the
 * picks on the other parameters are hidden (conditional showing), and oddball
 * variations without parameter
 * values (e.g. "Special Latkan") stay reachable as extra chips. Only
 * parameter-less add-ons fall back to flat option pills.
 *
 * Saves sequentially (DELETE removed add-ons → POST new ones → PUT changed
 * variations/add-on variations), then reports how the measurement checklist
 * shifted ("+2 added, −1 removed") against the baseline metric ids passed in.
 */

interface PendingChoice {
  variationId: string;
  typeId: string | null;
}

/** One add-on card's pending state. `placements` maps placement key → active;
 *  non-placement add-ons use the "" key. Matrix add-ons keep per-axis picks
 *  in `axisSel` (resolved to a variation on save); flat ones use
 *  `variationId` directly. */
interface AddonPending {
  selected: boolean;
  variationId: string | null;
  axisSel: Record<string, string>;
  placements: Record<string, boolean>;
}

// ── Add-on axis model (port of /myod's addonAxisModel) ─────────────────────

const AXIS_FIELDS = [
  { field: "style", label: "Style" },
  { field: "shape", label: "Shape" },
  { field: "size", label: "Size" },
  { field: "type", label: "Type" },
  { field: "color", label: "Color" },
] as const;

interface AddonAxis {
  key: string;
  label: string;
  values: string[];
}

/**
 * Derive the variation parameters of an add-on: the style/shape/size/type/
 * color columns, plus a "Where" parameter — the leading label segment when
 * every label is a " · "-separated string like "Front Neck Cut · Round ·
 * Small", else (plain labels) the placement column the admin add-on matrix
 * stamps the where-dimension into. Every parameter with 2+ distinct values becomes a chip
 * section (Key Hole: Where · Shape · Size; Latkan: Size). With 2+ parameters
 * the variations must decompose cleanly (a value on every parameter) before
 * the sectioned chips replace the flat pills — a partial grid can't be
 * resolved from per-parameter picks. `oddments` are the variations outside
 * the decomposition (e.g. Latkan's "Special Latkan"); they stay reachable
 * as extra chips alongside a single parameter's values.
 */
function addonAxisModel(variations: SCAddonVariationOption[]): {
  axes: AddonAxis[];
  matrix: boolean;
  oddments: SCAddonVariationOption[];
  axisValuesOf: (v: SCAddonVariationOption) => Record<string, string>;
} {
  const fail = {
    axes: [] as AddonAxis[],
    matrix: false,
    oddments: [] as SCAddonVariationOption[],
    axisValuesOf: () => ({}),
  };
  if (variations.length < 2) return fail;
  const segLists = variations.map((v) =>
    (briefLabel(v, "en") ?? "")
      .split("·")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const allMulti = segLists.every((s) => s.length >= 2);
  const valueOf = (
    v: SCAddonVariationOption,
    i: number,
    key: string,
  ): string | undefined =>
    key === "where"
      ? allMulti
        ? segLists[i][0]
        : (v.placement ?? undefined)
      : ((v as unknown as Record<string, string | null>)[key] ?? undefined);
  const distinct = (vals: (string | undefined)[]): string[] => {
    const out: string[] = [];
    for (const val of vals) if (val && !out.includes(val)) out.push(val);
    return out;
  };

  const axes: AddonAxis[] = [];
  // "Where" is the leading label segment for composite labels ("Front Neck
  // Cut · Round · Small"), else the placement column — the admin add-on
  // matrix stamps the where-dimension into placement.
  const wheres = distinct(
    allMulti
      ? segLists.map((s) => s[0])
      : variations.map((v) => v.placement ?? undefined),
  );
  if (wheres.length > 1) {
    axes.push({ key: "where", label: "Where", values: wheres });
  }
  for (const { field, label } of AXIS_FIELDS) {
    const values = distinct(variations.map((v) => valueOf(v, -1, field)));
    if (values.length > 1) axes.push({ key: field, label, values });
  }
  if (axes.length === 0) return fail;
  const has = (v: SCAddonVariationOption, i: number) =>
    axes.every((a) => valueOf(v, i, a.key) !== undefined);
  const clean = variations.every(has);
  // 2+ parameters only section out when every variation lands in the grid —
  // anything partial keeps flat pills so no variation becomes unreachable.
  if (axes.length >= 2 && !clean) return fail;
  return {
    axes,
    matrix: axes.length >= 2,
    oddments: clean
      ? []
      : variations.filter((v) => !has(v, variations.indexOf(v))),
    axisValuesOf: (v) =>
      Object.fromEntries(
        axes
          .map((a) => [a.key, valueOf(v, variations.indexOf(v), a.key)] as const)
          .filter(([, val]) => val !== undefined),
      ) as Record<string, string>,
  };
}

/** Variations of an add-on that can apply at the given placement
 *  (placement-priced variations only apply at their own placement). */
function eligibleVariations(a: SCAvailableAddon, placement: string | null) {
  return a.variations.filter(
    (v) => v.placement === null || v.placement === placement,
  );
}

export function SelectionSheet({
  jobId,
  garmentOrderId,
  selections,
  availableAddons,
  baselineMetricIds,
  focusComponentId,
  onClose,
  onDone,
}: {
  jobId: string;
  garmentOrderId: string;
  selections: SCSelection[];
  /** Catalog add-ons offered for this garment (job-detail payload). */
  availableAddons: SCAvailableAddon[];
  /** Flattened metric ids this garment's checklist asks for right now. */
  baselineMetricIds: string[];
  /** Scroll this component into view on open (step-through entry). */
  focusComponentId?: string | null;
  onClose: () => void;
  /** Called after a successful save — parent reloads the job. */
  onDone: () => void;
}) {
  const variationSels = selections.filter((s) => s.type === "variation");
  const addonSels = selections.filter((s) => s.type === "add_on");

  const [pending, setPending] = useState<Record<string, PendingChoice>>(() => {
    const out: Record<string, PendingChoice> = {};
    for (const s of variationSels) {
      if (!s.variation) continue;
      out[s.item_id] = {
        variationId: s.variation.id,
        typeId: s.variation_type?.id ?? null,
      };
    }
    return out;
  });

  // Existing add-on rows grouped by addon id (usually one; placement-based
  // add-ons can hold one row per placement).
  const rowsByAddon: Record<string, SCSelection[]> = {};
  for (const s of addonSels) {
    if (!s.addon) continue;
    (rowsByAddon[s.addon.id] ??= []).push(s);
  }

  // Per add-on: the variations the card offers + their parameter decomposition.
  // With existing rows the set is filtered to the row's placement (a row's
  // placement can't move — placement-priced picks re-add it instead); legacy
  // rows can sit at a placement no variation is priced for (e.g. a Key Hole
  // row with NULL placement), which filters to nothing — fall back to all
  // variations so the parameters stay pickable, and saving re-adds the row at
  // the chosen variation's own placement. New adds follow the active placement
  // chips (or all variations).
  const addonModels = useMemo(() => {
    const out: Record<
      string,
      {
        source: SCAddonVariationOption[];
        axes: AddonAxis[];
        matrix: boolean;
        oddments: SCAddonVariationOption[];
        axisValuesOf: (v: SCAddonVariationOption) => Record<string, string>;
      }
    > = {};
    for (const a of availableAddons) {
      const rows = rowsByAddon[a.addon.id] ?? [];
      let source: SCAddonVariationOption[];
      if (rows.length > 0) {
        const filtered = eligibleVariations(
          a,
          rows[0].placement?.[0] ?? null,
        );
        source = filtered.length > 0 ? filtered : a.variations;
      } else {
        const firstActive = Object.entries(
          initialAddonPlacements(a, rows),
        ).find(([, on]) => on)?.[0];
        source =
          firstActive && firstActive !== ""
            ? eligibleVariations(a, firstActive)
            : a.variations;
      }
      const { axes, matrix, oddments, axisValuesOf } = addonAxisModel(source);
      out[a.addon.id] = { source, axes, matrix, oddments, axisValuesOf };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableAddons, selections]);

  const [addonPending, setAddonPending] = useState<
    Record<string, AddonPending>
  >(() => {
    const out: Record<string, AddonPending> = {};
    for (const a of availableAddons) {
      const rows = rowsByAddon[a.addon.id] ?? [];
      const model = addonModels[a.addon.id];
      // Seed the variation from the existing row, else the catalog default —
      // never an arbitrary first option.
      const seedVar =
        rows[0]?.addon_variation?.id ??
        a.default_variation_id ??
        null;
      const seed = model.source.find((v) => v.id === seedVar) ?? null;
      out[a.addon.id] = {
        selected: rows.length > 0,
        variationId: seed?.id ?? null,
        axisSel: seed ? model.axisValuesOf(seed) : {},
        placements: initialAddonPlacements(a, rows),
      };
    }
    return out;
  });

  // Seeded state — a card's row operations only fire once the captain
  // actually changes it (legacy rows without a variation must not silently
  // re-stamp to the catalog default on an unrelated save).
  const addonPending0 = useRef(addonPending).current;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delta, setDelta] = useState<{ added: number; removed: number } | null>(
    null,
  );

  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusComponentId && focusRef.current) {
      focusRef.current.scrollIntoView({ block: "start" });
    }
  }, [focusComponentId]);

  const changes = variationSels.filter((s) => {
    const p = pending[s.item_id];
    return (
      p &&
      s.variation &&
      (p.variationId !== s.variation.id ||
        p.typeId !== (s.variation_type?.id ?? null))
    );
  });

  // An unpriced variation with sub-types must have a type chosen before save.
  const missingTypeChoice = changes.some((s) => {
    const p = pending[s.item_id];
    const opt = s.options.find((o) => o.id === p?.variationId);
    return opt?.type_required && !p?.typeId;
  });

  /** The variation a card's current picks resolve to (parameter picks for
   *  matrix add-ons, the chosen pill otherwise). Null until a full
   *  combination exists. */
  function resolvedVariation(a: SCAvailableAddon): SCAddonVariationOption | null {
    const p = addonPending[a.addon.id];
    const model = addonModels[a.addon.id];
    if (!p || !model) return null;
    if (model.matrix) {
      return (
        model.source.find((v) =>
          model.axes.every(
            (ax) => model.axisValuesOf(v)[ax.key] === p.axisSel[ax.key],
          ),
        ) ?? null
      );
    }
    return model.source.find((v) => v.id === p.variationId) ?? null;
  }

  /** Did the captain actually change this add-on card since opening? */
  function addonDirty(a: SCAvailableAddon): boolean {
    const p = addonPending[a.addon.id];
    const p0 = addonPending0[a.addon.id];
    if (!p || !p0) return false;
    return (
      p.selected !== p0.selected ||
      p.variationId !== p0.variationId ||
      Object.keys(p.placements).some(
        (k) => p.placements[k] !== p0.placements[k],
      ) ||
      Object.keys(p.axisSel).some((k) => p.axisSel[k] !== p0.axisSel[k])
    );
  }

  // Row-level operations for one add-on card, derived from pending state.
  function addonRowOps(a: SCAvailableAddon) {
    const p = addonPending[a.addon.id];
    const rows = rowsByAddon[a.addon.id] ?? [];
    const model = addonModels[a.addon.id];
    const ops: {
      kind: "delete" | "post" | "put";
      itemId?: string;
      input?: {
        addon_id: string;
        addon_variation_id?: string | null;
        placement?: string | null;
      };
      input2?: { addon_variation_id: string };
    }[] = [];
    if (!p || !model) return ops;
    if (!addonDirty(a)) return ops;
    const resolved = resolvedVariation(a);

    const activePlacements = Object.entries(p.placements)
      .filter(([, on]) => on)
      .map(([pl]) => pl);
    const hasPlacements = Boolean(a.placements && a.placements.length > 0);

    // Existing rows: keep + re-stamp, or remove.
    for (const row of rows) {
      const rowPlacement = row.placement?.[0] ?? "";
      // A row whose placement isn't one of the toggleable chips (legacy rows
      // with no placement, where-axis rows) answers to the add/remove toggle.
      const placementKnown =
        hasPlacements &&
        rowPlacement !== "" &&
        Object.prototype.hasOwnProperty.call(p.placements, rowPlacement);
      const stillActive = !hasPlacements
        ? p.placements[""] !== false
        : placementKnown
          ? activePlacements.includes(rowPlacement)
          : p.selected;
      if (!stillActive) {
        ops.push({ kind: "delete", itemId: row.item_id });
      } else if (
        resolved &&
        resolved.id !== row.addon_variation?.id
      ) {
        // A variation priced for the row's placement swaps in place; a
        // placement-priced pick (e.g. another Key Hole "Where") must move
        // the row — the API pins a row's placement, so delete + re-add it
        // at the variation's own placement.
        const rowPl = placementKnown ? rowPlacement : null;
        if (
          eligibleVariations(a, rowPl).some((v) => v.id === resolved.id)
        ) {
          ops.push({
            kind: "put",
            itemId: row.item_id,
            input2: { addon_variation_id: resolved.id },
          });
        } else {
          ops.push({ kind: "delete", itemId: row.item_id });
          ops.push({
            kind: "post",
            input: {
              addon_id: a.addon.id,
              addon_variation_id: resolved.id,
              placement: resolved.placement ?? rowPl,
            },
          });
        }
      }
    }

    // New rows for activated placements that have none yet.
    if (p.selected) {
      for (const pl of activePlacements) {
        const placement = pl === "" ? null : pl;
        const taken = rows.some((r) => (r.placement?.[0] ?? "") === pl);
        if (taken) continue;
        const eligible = eligibleVariations(a, placement);
        const chosen =
          resolved && eligible.some((v) => v.id === resolved.id)
            ? resolved.id
            : null;
        // A placement-priced variation carries its own placement — that IS
        // where the add-on goes (e.g. Key Hole "Where" axis).
        const chosenAv = eligible.find((v) => v.id === chosen) ?? null;
        ops.push({
          kind: "post",
          input: {
            addon_id: a.addon.id,
            addon_variation_id: chosen,
            placement: chosenAv?.placement ?? placement,
          },
        });
      }
    }
    return ops;
  }

  // A newly added add-on with variations must have a variation chosen before
  // save. (Existing rows without a variation — legacy orders — are left as-is
  // unless the captain picks one, so they don't block unrelated saves.)
  const missingAddonChoice = availableAddons.some((a) =>
    addonRowOps(a).some(
      (op) =>
        op.kind === "post" &&
        a.variations.length > 0 &&
        !op.input?.addon_variation_id,
    ),
  );

  const addonChangeCount = availableAddons.reduce(
    (n, a) => n + addonRowOps(a).length,
    0,
  );
  const totalChanges = changes.length + addonChangeCount;

  function pickVariation(sel: SCSelection, variationId: string) {
    setPending((prev) => {
      const opt = sel.options.find((o) => o.id === variationId);
      const current = prev[sel.item_id];
      const keepType =
        current?.variationId === variationId ? current.typeId : null;
      return {
        ...prev,
        [sel.item_id]: {
          variationId,
          typeId: keepType ?? opt?.types[0]?.id ?? null,
        },
      };
    });
  }

  function pickType(itemId: string, typeId: string) {
    setPending((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], typeId },
    }));
  }

  function toggleAddon(a: SCAvailableAddon) {
    setAddonPending((prev) => {
      const cur = prev[a.addon.id];
      const model = addonModels[a.addon.id];
      if (!cur || !model) return prev;
      if (!cur.selected) {
        // Activate with defaults: first placement on, variation seeded from
        // the existing picks or the catalog default — never arbitrary.
        const placements = { ...cur.placements };
        const first = Object.keys(placements)[0];
        if (first !== undefined && !Object.values(placements).some(Boolean)) {
          placements[first] = true;
        }
        const seedVar =
          (model.matrix ? resolvedVariation(a)?.id : cur.variationId) ??
          a.default_variation_id ??
          null;
        const seed = model.source.find((v) => v.id === seedVar) ?? null;
        return {
          ...prev,
          [a.addon.id]: {
            selected: true,
            variationId: seed?.id ?? null,
            axisSel: seed ? model.axisValuesOf(seed) : {},
            placements,
          },
        };
      }
      // Deselect: every placement off.
      const placements = Object.fromEntries(
        Object.keys(cur.placements).map((k) => [k, false]),
      );
      return {
        ...prev,
        [a.addon.id]: { ...cur, selected: false, placements },
      };
    });
  }

  function toggleAddonPlacement(a: SCAvailableAddon, pl: string) {
    setAddonPending((prev) => {
      const cur = prev[a.addon.id];
      if (!cur) return prev;
      const placements = {
        ...cur.placements,
        [pl]: !cur.placements[pl],
      };
      const anyOn = Object.values(placements).some(Boolean);
      return { ...prev, [a.addon.id]: { ...cur, selected: anyOn, placements } };
    });
  }

  function pickAddonVariation(addonId: string, variationId: string) {
    setAddonPending((prev) => ({
      ...prev,
      [addonId]: { ...prev[addonId], variationId },
    }));
  }

  function pickAddonAxis(addonId: string, axisKey: string, value: string) {
    setAddonPending((prev) => ({
      ...prev,
      [addonId]: {
        ...prev[addonId],
        axisSel: { ...prev[addonId].axisSel, [axisKey]: value },
      },
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Removals first (frees the addon+placement slot), then adds, then
      // variation swaps.
      for (const a of availableAddons) {
        for (const op of addonRowOps(a)) {
          if (op.kind === "delete" && op.itemId) {
            await scRemoveAddonItem(garmentOrderId, op.itemId);
          }
        }
      }
      for (const a of availableAddons) {
        for (const op of addonRowOps(a)) {
          if (op.kind === "post" && op.input) {
            await scAddAddon(garmentOrderId, op.input);
          }
        }
      }
      for (const a of availableAddons) {
        for (const op of addonRowOps(a)) {
          if (op.kind === "put" && op.itemId && op.input2) {
            await scUpdateSelection(garmentOrderId, op.itemId, op.input2);
          }
        }
      }
      for (const sel of changes) {
        const p = pending[sel.item_id];
        await scUpdateSelection(garmentOrderId, sel.item_id, {
          variation_id: p.variationId,
          variation_type_id: p.typeId,
        });
      }

      // Report how the checklist shifted for this garment instance.
      try {
        const fresh = await scFetchChecklist(jobId, garmentOrderId);
        const before = new Set(baselineMetricIds);
        const after = new Set<string>();
        for (const g of fresh.garments) {
          if (g.garment_order_id !== garmentOrderId) continue;
          for (const s of g.sections)
            for (const m of s.metrics) after.add(m.id);
        }
        let added = 0;
        let removed = 0;
        for (const id of after) if (!before.has(id)) added++;
        for (const id of before) if (!after.has(id)) removed++;
        setDelta({ added, removed });
      } catch {
        setDelta({ added: 0, removed: 0 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet title="Edit selections" onClose={delta ? onDone : onClose}>
      <div className="space-y-4">
        {variationSels.map((sel) => {
          const p = pending[sel.item_id];
          const selectedOpt = sel.options.find((o) => o.id === p?.variationId);
          const isFocused = sel.component?.id === focusComponentId;
          return (
            <div
              key={sel.item_id}
              ref={isFocused ? focusRef : undefined}
              className={`space-y-2 rounded-card border px-3 py-3 ${
                isFocused
                  ? "border-accent-text bg-accent-text/5"
                  : "border-hairline bg-chalk-white"
              }`}
            >
              <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                {briefLabel(sel.component, "en") || "Component"}
              </p>

              <div className="flex flex-wrap gap-1.5">
                {sel.options.map((opt) => {
                  const isActive = opt.id === p?.variationId;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => pickVariation(sel, opt.id)}
                      className={`tap rounded-pill px-3 py-1.5 text-caption font-medium transition ${
                        isActive
                          ? "bg-ink-navy text-chalk-white shadow-card"
                          : "border border-hairline-strong bg-chalk-white text-ink-navy"
                      }`}
                    >
                      {briefLabel(opt, "en") || opt.slug}
                    </button>
                  );
                })}
                {sel.options.length === 0 && (
                  <span className="text-caption text-muted">
                    No alternatives configured.
                  </span>
                )}
              </div>

              {selectedOpt && selectedOpt.types.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-muted">
                    {selectedOpt.type_required ? "Type (required)" : "Type"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedOpt.types.map((t) => {
                      const isActive = t.id === p?.typeId;
                      return (
                        <button
                          key={t.id}
                          onClick={() => pickType(sel.item_id, t.id)}
                          className={`tap rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                            isActive
                              ? "bg-ink-navy text-chalk-white shadow-card"
                              : "border border-hairline-strong bg-chalk-white text-ink-navy"
                          }`}
                        >
                          {briefLabel(t, "en") || t.slug}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {availableAddons.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Add-ons
            </p>
            {availableAddons.map((a) => {
              const p = addonPending[a.addon.id];
              const model = addonModels[a.addon.id];
              if (!p || !model) return null;
              const rows = rowsByAddon[a.addon.id] ?? [];
              const hasPlacements = Boolean(
                a.placements && a.placements.length > 0,
              );
              const isMatrix = model.matrix;
              const singleAxis =
                !isMatrix && model.axes.length === 1 ? model.axes[0] : null;
              const resolved = resolvedVariation(a);
              // A leading "Where" axis already answers where the add-on goes.
              const showPlacementChips =
                hasPlacements && model.axes[0]?.key !== "where";
              const hint =
                a.price ?? resolved?.price ?? a.variations[0]?.price ?? null;
              // Conditional showing: only values that can complete a real
              // combination with the picks on every other parameter render
              // (an unpicked parameter constrains nothing). E.g. with
              // Front neck cut + Triangle picked and "Front neck cut ·
              // Triangle · Large" not in the catalog, Large disappears.
              const comboExists = (key: string, value: string) =>
                model.source.some(
                  (v) =>
                    model.axisValuesOf(v)[key] === value &&
                    model.axes.every(
                      (ax) =>
                        ax.key === key ||
                        p.axisSel[ax.key] === undefined ||
                        model.axisValuesOf(v)[ax.key] === p.axisSel[ax.key],
                    ),
                );
              return (
                <div
                  key={a.addon.id}
                  className={`space-y-2 rounded-card border px-3 py-3 ${
                    p.selected
                      ? "border-hairline bg-chalk-white"
                      : "border-dashed border-hairline-strong bg-chalk-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-caption font-medium text-ink-navy">
                        {briefLabel(a.addon, "en") || a.addon.slug}
                      </p>
                      {hint !== null && (
                        <p className="text-[11px] text-muted">
                          + {formatPrice(hint)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => toggleAddon(a)}
                      className={`tap shrink-0 rounded-pill px-3 py-1.5 text-caption font-medium transition ${
                        p.selected
                          ? "bg-ink-navy text-chalk-white shadow-card"
                          : "border border-hairline-strong bg-chalk-white text-ink-navy"
                      }`}
                    >
                      {p.selected ? "✓ Added" : "+ Add"}
                    </button>
                  </div>

                  {p.selected && isMatrix && (
                    <>
                      {model.axes.map((ax) => (
                        <div key={ax.key} className="space-y-1">
                          <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                            {ax.label}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {ax.values.map((val) => {
                              if (!comboExists(ax.key, val)) return null;
                              const isActive = p.axisSel[ax.key] === val;
                              return (
                                <button
                                  key={val}
                                  onClick={() =>
                                    pickAddonAxis(a.addon.id, ax.key, val)
                                  }
                                  className={`tap rounded-pill px-3 py-1 text-[12px] font-medium capitalize transition ${
                                    isActive
                                      ? "bg-ink-navy text-chalk-white shadow-card"
                                      : "border border-hairline-strong bg-chalk-white text-ink-navy"
                                  }`}
                                >
                                  {val}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {!resolved && (
                        <p className="text-[11px] text-muted">
                          Pick an option in each row.
                        </p>
                      )}
                    </>
                  )}

                  {p.selected && singleAxis && (
                    <div className="space-y-1">
                      <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                        {singleAxis.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {singleAxis.values.map((val) => {
                          const v = model.source.find(
                            (x) =>
                              !model.oddments.includes(x) &&
                              model.axisValuesOf(x)[singleAxis.key] === val,
                          );
                          if (!v) return null;
                          const isActive = p.variationId === v.id;
                          return (
                            <button
                              key={val}
                              onClick={() =>
                                pickAddonVariation(a.addon.id, v.id)
                              }
                              className={`tap rounded-pill px-3 py-1 text-[12px] font-medium capitalize transition ${
                                isActive
                                  ? "bg-ink-navy text-chalk-white shadow-card"
                                  : "border border-hairline-strong bg-chalk-white text-ink-navy"
                              }`}
                            >
                              {val}
                              {v.price !== null &&
                                a.price === null &&
                                ` · ${formatPrice(v.price)}`}
                            </button>
                          );
                        })}
                        {model.oddments.map((v) => {
                          const isActive = p.variationId === v.id;
                          return (
                            <button
                              key={v.id}
                              onClick={() =>
                                pickAddonVariation(a.addon.id, v.id)
                              }
                              className={`tap rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                                isActive
                                  ? "bg-ink-navy text-chalk-white shadow-card"
                                  : "border border-hairline-strong bg-chalk-white text-ink-navy"
                              }`}
                            >
                              {briefLabel(v, "en") || v.slug}
                              {v.price !== null &&
                                a.price === null &&
                                ` · ${formatPrice(v.price)}`}
                            </button>
                          );
                        })}
                      </div>
                      {!resolved && (
                        <p className="text-[11px] text-muted">Pick an option.</p>
                      )}
                    </div>
                  )}

                  {p.selected && !isMatrix && !singleAxis && a.variations.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted">
                        Option
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {model.source.map((v) => {
                          const isActive = v.id === p.variationId;
                          return (
                            <button
                              key={v.id}
                              onClick={() =>
                                pickAddonVariation(a.addon.id, v.id)
                              }
                              className={`tap rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                                isActive
                                  ? "bg-ink-navy text-chalk-white shadow-card"
                                  : "border border-hairline-strong bg-chalk-white text-ink-navy"
                              }`}
                            >
                              {briefLabel(v, "en") || v.slug}
                              {v.price !== null &&
                                a.price === null &&
                                ` · ${formatPrice(v.price)}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {p.selected && showPlacementChips && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted">
                        Placement
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(a.placements ?? []).map((pl) => {
                          const isActive = p.placements[pl];
                          return (
                            <button
                              key={pl}
                              onClick={() => toggleAddonPlacement(a, pl)}
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

        {delta && (
          <div className="rounded-card border border-success-border bg-success-bg px-4 py-3 text-caption text-success-text">
            ✓ Selections updated — checklist{" "}
            {delta.added > 0 && `${delta.added} measurement${delta.added === 1 ? "" : "s"} added`}
            {delta.added > 0 && delta.removed > 0 && " · "}
            {delta.removed > 0 &&
              `${delta.removed} removed`}
            {delta.added === 0 && delta.removed === 0 && "unchanged"}
            .
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {delta ? (
            <button
              onClick={onDone}
              className="tap flex-1 rounded-pill bg-ink-navy px-4 py-3 text-body font-semibold text-chalk-white"
            >
              Done
            </button>
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
                onClick={save}
                disabled={saving || totalChanges === 0 || missingTypeChoice || missingAddonChoice}
                className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                    Saving…
                  </span>
                ) : missingTypeChoice || missingAddonChoice ? (
                  "Choose an option"
                ) : totalChanges === 0 ? (
                  "No changes"
                ) : (
                  `Save ${totalChanges} change${totalChanges === 1 ? "" : "s"}`
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

/** Placement activation map seeded from the add-on's existing rows. */
function initialAddonPlacements(
  a: SCAvailableAddon,
  rows: SCSelection[],
): Record<string, boolean> {
  const placements: Record<string, boolean> = {};
  if (a.placements && a.placements.length > 0) {
    for (const pl of a.placements) placements[pl] = false;
    for (const row of rows) {
      const pl = row.placement?.[0];
      if (pl) placements[pl] = true;
    }
  } else {
    placements[""] = rows.length > 0;
  }
  return placements;
}
