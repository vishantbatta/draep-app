"use client";

/**
 * AddonMatrixModal — price-matrix editor for an add-on's variations.
 *
 * A matrix add-on prices each *combination* of option axes (e.g. keyhole
 * shape × size — "drop + small" costs ₹500). One cell of the matrix is one
 * `garment_addon_variations` row; the axis columns (placement/style/shape/
 * size/type/color) hold the cell's coordinates and `price` holds the cell
 * value. The placement axis is special: a value can be picked from the
 * add-on's placements vocabulary, added fresh from a style component (its
 * label becomes the value and the component gets linked to the add-on, so
 * the placement reflects along with it), or typed as a custom string. New
 * values are folded into the add-on's placements on save.
 *
 * Saving has two modes (picker in the footer): "Add" (default) keeps every
 * existing variation — cells that already exist get their price reconciled
 * (and their name refreshed), the rest are created as new variations.
 * "Replace" makes the grid the add-on's full variation set: rows it doesn't
 * claim (other axes, removed × combos) are deleted, with a count preview, a
 * confirm dialog, and a red save button before it can happen. Rows can be
 * removed from the preview (×) to skip creating those combinations. Axis
 * values are edited as comma-separated lists; the cross-product grid below
 * updates live. A cell with an empty price is saved as null = combination
 * not sellable (the order-creation picker disables it).
 *
 * Each variation's display name is auto-generated from all its axis values
 * ("Round · Small", grid order); the Name field on a cell overrides it.
 * Custom names are detected on load (a stored label that doesn't match the
 * generated form) and pre-filled, so a re-save keeps them.
 *
 * "Clear all" (top right) resets the editor to a blank grid — unsaved only:
 * a save still needs at least one enabled axis, so a cleared state can't be
 * saved over the existing variations.
 */

import { useEffect, useMemo, useState } from "react";
import {
  type Addon,
  type AddonVariation,
  type StyleComponent,
  fetchByParent,
  getLabel,
  saveAddonVariationMatrix,
  updateAddon,
} from "@/lib/admin-api";
import { Field, Modal, Select, TextInput } from "./_shared/catalogue-helpers";

const AXIS_DISPLAY = ["placement", "shape", "size", "type", "style", "color"] as const;
type AxisName = (typeof AXIS_DISPLAY)[number];

const AXIS_HINTS: Record<AxisName, string> = {
  placement: "one price per placement (pick a style component or a custom value)",
  shape: "e.g. round, drop, triangle, bow",
  size: "e.g. small, medium, large",
  type: "e.g. full, half, lace",
  style: "e.g. classic, gathered",
  color: "e.g. gold, navy, red",
};

/**
 * Auto-generated display name for a combination: every axis value title-cased
 * and " · "-joined in grid order (server mirror of the label builder).
 */
function autoName(combo: readonly string[]): string {
  return combo.map(capitalizeWords).join(" · ");
}

function tupleKey(values: string[]): string {
  return values.join("\u0000");
}

function parseAxisValues(text: string): string[] {
  const seen: string[] = [];
  for (const raw of text.split(",")) {
    const v = raw.trim();
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen;
}

function crossProduct(values: string[][]): string[][] {
  let acc: string[][] = [[]];
  for (const vals of values) {
    const next: string[][] = [];
    for (const combo of acc) {
      for (const v of vals) next.push([...combo, v]);
    }
    acc = next;
  }
  return acc;
}

function capitalizeWords(v: string): string {
  return v
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** × on a matrix row — marks the combination as "don't create it". */
function RemoveRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Skip this combination"
      className="tap rounded-pill p-1 text-muted transition hover:bg-red-50 hover:text-red-600"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none">
        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Undo pill shown in place of a removed row's price input. */
function UndoRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap rounded-pill border border-hairline-strong px-2.5 py-0.5 text-[11px] font-medium text-muted transition hover:bg-mist-navy hover:text-ink"
    >
      Undo
    </button>
  );
}

/**
 * ⧉ next to a row/column header (or an axis value in the 3+-axis table) —
 * stamps the last price the admin typed across every combination sharing
 * that header's axis value. Disabled until a price has been typed.
 */
function HeaderCopyButton({
  onClick,
  disabled,
  title,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`tap rounded-pill p-0.5 align-middle transition ${
        disabled
          ? "cursor-not-allowed text-muted opacity-30"
          : "text-muted hover:bg-mist-navy hover:text-ink"
      }`}
    >
      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
        <rect x="4.25" y="4.25" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7.75 4.25V3.5a1.25 1.25 0 0 0-1.25-1.25H3.5A1.25 1.25 0 0 0 2.25 3.5v3A1.25 1.25 0 0 0 3.5 7.75h.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function AddonMatrixModal({
  addonId,
  onClose,
  onSaved,
}: {
  addonId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addon, setAddon] = useState<Addon | null>(null);
  const [variations, setVariations] = useState<AddonVariation[]>([]);
  // The garment's style components — the source for component-backed
  // placement values (picked label becomes the value; the component gets
  // linked to the add-on on save so the placement reflects along with it).
  const [components, setComponents] = useState<StyleComponent[]>([]);
  // Component ids chosen through the picker in this session (save links them).
  const [pickedComponentIds, setPickedComponentIds] = useState<string[]>([]);
  const [customPlacement, setCustomPlacement] = useState("");

  // Matrix state. axes = enabled axes in display order; valuesText = the
  // comma-separated editor text per axis; prices = tuple-key → price text.
  const [axes, setAxes] = useState<AxisName[]>([]);
  const [valuesText, setValuesText] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [defaultKey, setDefaultKey] = useState<string | null>(null);
  const [fillPrice, setFillPrice] = useState("");
  // Last price typed into a cell — the source the header ⧉ buttons copy.
  const [lastPrice, setLastPrice] = useState<string | null>(null);
  // Per-combination display-name overrides (tuple-key → custom name). Empty
  // entry = use the auto-generated name (all axis values joined).
  const [names, setNames] = useState<Record<string, string>>({});
  // Tuple-keys of combinations removed from the preview: they are skipped on
  // save (in add mode never created; in replace mode any existing row for
  // them is deleted with the rest of the unclaimed set).
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  // How the save reconciles: "add" appends new combinations and price-updates
  // matching ones, never deleting; "replace" makes the grid the add-on's full
  // variation set, deleting every row it doesn't claim.
  const [mode, setMode] = useState<"add" | "replace">("add");

  // ── Load the addon row + its variations, then seed the editor state ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setExcludedKeys(new Set());
    Promise.all([
      fetchByParent<Addon>("garment_addons", "id", addonId, 1),
      fetchByParent<AddonVariation>("garment_addon_variations", "addon_id", addonId),
    ])
      .then(([addonRows, existingVariations]) => {
        if (cancelled) return;
        const a = addonRows[0] ?? null;
        setAddon(a);
        setVariations(existingVariations);

        // Enabled axes = axes with at least one distinct value in the data,
        // in display order. Prices seed from fully-specified rows.
        const nextAxes: AxisName[] = [];
        const nextValues: Record<string, string> = {};
        for (const ax of AXIS_DISPLAY) {
          const vals: string[] = [];
          for (const v of existingVariations) {
            const val = v[ax] as string | null;
            if (val && !vals.includes(val)) vals.push(val);
          }
          if (vals.length > 0) {
            nextAxes.push(ax);
            nextValues[ax] = vals.join(", ");
          }
        }
        const nextPrices: Record<string, string> = {};
        for (const v of existingVariations) {
          if (!nextAxes.every((ax) => v[ax] as string | null)) continue;
          const key = tupleKey(nextAxes.map((ax) => v[ax] as string));
          if (v.price != null) nextPrices[key] = String(v.price);
        }
        // Seed name overrides from existing rows — but only labels that aren't
        // the current auto name (all axis values joined), so genuinely custom
        // names survive a re-save while generated ones refresh on save.
        const nextNames: Record<string, string> = {};
        for (const v of existingVariations) {
          if (!nextAxes.every((ax) => v[ax] as string | null)) continue;
          const vals = nextAxes.map((ax) => v[ax] as string);
          const stored = getLabel(v.labels ?? {}, v.slug, v.id);
          if (stored && stored !== autoName(vals)) nextNames[tupleKey(vals)] = stored;
        }
        setAxes(nextAxes);
        setValuesText(nextValues);
        setPrices(nextPrices);
        setNames(nextNames);

        if (a?.default_variation_id) {
          const def = existingVariations.find((v) => v.id === a.default_variation_id);
          if (def && nextAxes.every((ax) => def[ax] as string | null)) {
            setDefaultKey(tupleKey(nextAxes.map((ax) => def[ax] as string)));
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load add-on");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addonId]);

  // ── Load the garment's style components once the add-on is known ──
  useEffect(() => {
    const garmentId = addon?.garment_id;
    if (!garmentId) return;
    let cancelled = false;
    fetchByParent<StyleComponent>("garment_style_component", "garment_id", garmentId)
      .then((rows) => {
        if (!cancelled) setComponents(rows);
      })
      .catch(() => {
        /* component picking just stays unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, [addon?.garment_id]);

  // ── Live cross-product from the current axis editors ──
  const axisValues = useMemo(
    () => axes.map((ax) => parseAxisValues(valuesText[ax] ?? "")),
    [axes, valuesText],
  );
  const combos = useMemo(() => crossProduct(axisValues), [axisValues]);

  // Combinations that already exist as variations (matched on the current
  // axes): they're tinted in the preview and only get their price reconciled.
  const existingKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const v of variations) {
      if (axes.every((ax) => v[ax] as string | null)) {
        keys.add(tupleKey(axes.map((ax) => v[ax] as string)));
      }
    }
    return keys;
  }, [variations, axes]);

  const sentCombos = combos.filter((c) => !excludedKeys.has(tupleKey(c)));
  const newCount = sentCombos.filter((c) => !existingKeys.has(tupleKey(c))).length;
  const keptExistingCount = sentCombos.length - newCount;
  const pricedCount = sentCombos.filter((c) => (prices[tupleKey(c)] ?? "").trim()).length;

  // Existing rows the current grid doesn't claim — what a replace save would
  // delete. Rows using other axes never match the grid, and removed (×) combos
  // leave their rows unclaimed too.
  const claimedKeys = new Set(sentCombos.map((c) => tupleKey(c)));
  const deleteCount = variations.filter((v) => {
    if (!axes.every((ax) => v[ax] as string | null)) return true;
    return !claimedKeys.has(tupleKey(axes.map((ax) => v[ax] as string)));
  }).length;

  // Placement isn't free text — its values come from the add-on's placements
  // vocabulary (admin-entered entries) ∪ the values already on existing
  // variations, so the admin always sees what's in use.
  const placementVocabulary = useMemo(() => {
    const seeded = parseAxisValues(valuesText["placement"] ?? "");
    return Array.from(new Set([...(addon?.placements ?? []), ...seeded]));
  }, [addon, valuesText]);

  // Style components of the garment that aren't placements yet — picking one
  // uses its label as the new placement value and links the component on save.
  const componentOptions = useMemo(() => {
    const byLabel = new Map<string, { value: string; label: string }>();
    for (const c of components) {
      const label = getLabel(c.labels, c.slug, c.id);
      if (!placementVocabulary.includes(label) && !byLabel.has(label)) {
        byLabel.set(label, { value: c.id, label });
      }
    }
    return Array.from(byLabel.values());
  }, [components, placementVocabulary]);

  function addPlacementValue(value: string) {
    const v = value.trim();
    if (!v) return;
    setValuesText((prev) => {
      const current = parseAxisValues(prev["placement"] ?? "");
      if (current.includes(v)) return prev;
      return { ...prev, placement: [...current, v].join(", ") };
    });
  }

  function addComponentPlacement(componentId: string) {
    const c = components.find((x) => x.id === componentId);
    if (!c) return;
    addPlacementValue(getLabel(c.labels, c.slug, c.id));
    setPickedComponentIds((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
  }

  function toggleAxis(ax: AxisName, on: boolean) {
    setAxes((prev) => {
      const without = prev.filter((a) => a !== ax);
      return on ? AXIS_DISPLAY.filter((a) => without.includes(a) || a === ax) : without;
    });
    if (on && !(valuesText[ax] ?? "").trim()) {
      setValuesText((prev) => ({
        ...prev,
        // Placement starts fully selected — the common "price every placement"
        // case; admin unchecks the ones that don't differ.
        [ax]: ax === "placement" ? (addon?.placements ?? []).join(", ") : (prev[ax] ?? ""),
      }));
    }
  }

  function setPrice(key: string, value: string) {
    setPrices((prev) => ({ ...prev, [key]: value }));
    // The header ⧉ buttons copy "the price I just typed" — remember the
    // latest non-empty one as their source.
    const v = value.trim();
    if (v) setLastPrice(v);
  }

  function setName(key: string, value: string) {
    setNames((prev) => ({ ...prev, [key]: value }));
  }

  // Stamp the last-typed price on every sent combination that shares an axis
  // value — the "Round Small = 30, then ⧉ on the Round row / Small column"
  // shortcut. Removed (×) rows are skipped: they aren't saved anyway.
  function copyPriceToAxisValue(axisIndex: number, axisValue: string) {
    if (!lastPrice || axisIndex < 0 || axisIndex >= axes.length) return;
    setPrices((prev) => {
      const next = { ...prev };
      for (const c of sentCombos) {
        if (c[axisIndex] === axisValue) next[tupleKey(c)] = lastPrice;
      }
      return next;
    });
  }

  function toggleRow(combo: string[]) {
    const key = tupleKey(combo);
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // A removed row can't stay the default — nothing would claim it.
    if (defaultKey === key) setDefaultKey(null);
  }

  function fillEmpty() {
    const v = fillPrice.trim();
    if (!v) return;
    setPrices((prev) => {
      const next = { ...prev };
      for (const c of sentCombos) {
        const k = tupleKey(c);
        if (!(next[k] ?? "").trim()) next[k] = v;
      }
      return next;
    });
  }

  // Wipe the editor back to a blank grid (axes, values, prices, names,
  // exclusions, default). Nothing touches the DB until the next save — and a
  // save needs at least one enabled axis, so a cleared state can't be saved.
  const clearAll = () => {
    setAxes([]);
    setValuesText({});
    setPrices({});
    setNames({});
    setExcludedKeys(new Set());
    setDefaultKey(null);
    setLastPrice(null);
    setFillPrice("");
    setError(null);
  };

  async function handleSave() {
    setError(null);
    if (axes.length === 0) {
      setError("Enable at least one axis.");
      return;
    }
    if (axisValues.some((v) => v.length === 0)) {
      setError("Every enabled axis needs at least one value.");
      return;
    }
    if (combos.length === 0) {
      setError("The matrix has no combinations — check the axis values.");
      return;
    }
    if (sentCombos.length === 0) {
      setError("Every combination is removed — undo a row or edit the axis values.");
      return;
    }
    if (mode === "replace" && deleteCount > 0) {
      const ok = window.confirm(
        `Replace permanently deletes ${deleteCount} existing variation${deleteCount === 1 ? "" : "s"} not in this grid. Continue?`,
      );
      if (!ok) return;
    }
    if (newCount > 120) {
      const ok = window.confirm(
        `This will ${mode === "add" ? "add" : "create"} ${newCount} new variations to this add-on. Continue?`,
      );
      if (!ok) return;
    }
    const cells = sentCombos.map((c) => {
      const p = (prices[tupleKey(c)] ?? "").trim();
      const nm = (names[tupleKey(c)] ?? "").trim();
      return {
        axis_values: c,
        price: p ? Number(p) : null,
        is_default: defaultKey === tupleKey(c),
        label: nm || null,
      };
    });

    setSaving(true);
    try {
      // The matrix endpoint validates placement values against the add-on's
      // placements vocabulary — extend it first when values were added here
      // (component picks also link their component so the placement keeps
      // reflecting it, same union the add-on forms perform).
      const placementValues = axisValues[axes.indexOf("placement")] ?? [];
      const nextPlacements = Array.from(
        new Set([...(addon?.placements ?? []), ...placementValues]),
      );
      const nextComponentIds = Array.from(
        new Set([
          ...(addon?.garment_style_component_ids ?? []),
          ...pickedComponentIds.filter((id) => {
            const c = components.find((x) => x.id === id);
            return c != null && placementValues.includes(getLabel(c.labels, c.slug, c.id));
          }),
        ]),
      );
      const placementsChanged =
        (addon?.placements ?? []).length !== nextPlacements.length ||
        nextPlacements.some((p) => !(addon?.placements ?? []).includes(p));
      const componentsChanged =
        (addon?.garment_style_component_ids ?? []).length !== nextComponentIds.length;
      if (placementsChanged || componentsChanged) {
        await updateAddon(addonId, {
          placements: nextPlacements,
          garment_style_component_ids: nextComponentIds,
        });
      }
      await saveAddonVariationMatrix(addonId, {
        axes,
        values: axisValues,
        cells,
        mode,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const priceInputCls =
    "w-24 rounded-card border border-hairline-strong bg-chalk-white px-2 py-1.5 text-right font-mono text-[13px] text-ink outline-none transition focus:border-ink-navy";
  const nameInputCls =
    "rounded-card border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] text-ink outline-none transition focus:border-ink-navy";
  const existingRowCls = "bg-mist-navy/25";
  const removedTextCls = "line-through opacity-50";

  const matrixBody = (() => {
    if (axes.length === 0) {
      return (
        <div className="rounded-card border border-dashed border-hairline-strong px-3 py-4 text-center text-[12px] text-muted">
          Enable at least one axis above to build the price matrix.
        </div>
      );
    }
    if (axes.length === 1) {
      const vals = axisValues[0];
      if (vals.length === 0) {
        return (
          <div className="rounded-card border border-dashed border-hairline-strong px-3 py-4 text-center text-[12px] text-muted">
            Add values for the {axes[0]} axis above.
          </div>
        );
      }
      return (
        <div className="divide-y divide-hairline rounded-card border border-hairline">
          {vals.map((v) => {
            const key = tupleKey([v]);
            const removed = excludedKeys.has(key);
            return (
              <div
                key={v}
                className={`flex items-center justify-between gap-3 px-3 py-2 ${
                  existingKeys.has(key) ? existingRowCls : ""
                }`}
              >
                <span
                  className={`text-[13px] font-medium text-ink-navy ${removed ? removedTextCls : ""}`}
                >
                  {capitalizeWords(v)}
                  <HeaderCopyButton
                    onClick={() => copyPriceToAxisValue(0, v)}
                    disabled={!lastPrice}
                    title={
                      lastPrice
                        ? `Copy ₹${lastPrice} across all ${capitalizeWords(v)}`
                        : "Type a price in any cell first"
                    }
                  />
                </span>
                {removed ? (
                  <UndoRowButton onClick={() => toggleRow([v])} />
                ) : (
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                    <input
                      type="text"
                      value={names[key] ?? ""}
                      onChange={(e) => setName(key, e.target.value)}
                      placeholder={autoName([v])}
                      className={`${nameInputCls} w-full max-w-56`}
                      title="Variation name — leave empty to use the auto-generated one"
                    />
                    <span className="text-[12px] text-muted">₹</span>
                    <input
                      type="number"
                      min={0}
                      value={prices[key] ?? ""}
                      onChange={(e) => setPrice(key, e.target.value)}
                      placeholder="—"
                      className={priceInputCls}
                    />
                    <RemoveRowButton onClick={() => toggleRow([v])} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
    if (axes.length === 2) {
      const [rowAx, colAx] = axes;
      const rowVals = axisValues[0];
      const colVals = axisValues[1];
      if (rowVals.length === 0 || colVals.length === 0) {
        return (
          <div className="rounded-card border border-dashed border-hairline-strong px-3 py-4 text-center text-[12px] text-muted">
            Add values for both axes above.
          </div>
        );
      }
      return (
        <div className="overflow-x-auto rounded-card border border-hairline">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-hairline bg-mist-navy/50">
                <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                  {rowAx} \ {colAx}
                </th>
                {colVals.map((cv) => (
                  <th key={cv} className="px-3 py-2 text-center text-[12px] font-semibold text-ink-navy">
                    <span className="inline-flex items-center gap-1">
                      {capitalizeWords(cv)}
                      <HeaderCopyButton
                        onClick={() => copyPriceToAxisValue(1, cv)}
                        disabled={!lastPrice}
                        title={
                          lastPrice
                            ? `Copy ₹${lastPrice} down the ${capitalizeWords(cv)} column`
                            : "Type a price in any cell first"
                        }
                      />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowVals.map((rv) => (
                <tr key={rv} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2 text-[12px] font-semibold text-ink-navy">
                    <span className="inline-flex items-center gap-1">
                      {capitalizeWords(rv)}
                      <HeaderCopyButton
                        onClick={() => copyPriceToAxisValue(0, rv)}
                        disabled={!lastPrice}
                        title={
                          lastPrice
                            ? `Copy ₹${lastPrice} across the ${capitalizeWords(rv)} row`
                            : "Type a price in any cell first"
                        }
                      />
                    </span>
                  </td>
                  {colVals.map((cv) => {
                    const key = tupleKey([rv, cv]);
                    const removed = excludedKeys.has(key);
                    return (
                      <td
                        key={cv}
                        className={`px-3 py-2 text-center ${existingKeys.has(key) ? existingRowCls : ""}`}
                      >
                        {removed ? (
                          <UndoRowButton onClick={() => toggleRow([rv, cv])} />
                        ) : (
                          <span className="inline-flex flex-col items-end gap-1">
                            <input
                              type="text"
                              value={names[key] ?? ""}
                              onChange={(e) => setName(key, e.target.value)}
                              placeholder={autoName([rv, cv])}
                              className={`${nameInputCls} w-32`}
                              title="Variation name — leave empty to use the auto-generated one"
                            />
                            <span className="inline-flex items-center gap-1">
                              <span className="text-[12px] text-muted">₹</span>
                              <input
                                type="number"
                                min={0}
                                value={prices[key] ?? ""}
                                onChange={(e) => setPrice(key, e.target.value)}
                                placeholder="—"
                                className={priceInputCls}
                              />
                              <RemoveRowButton onClick={() => toggleRow([rv, cv])} />
                            </span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    // 3+ axes: flat table, one row per combination.
    return (
      <div className="overflow-x-auto rounded-card border border-hairline">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline bg-mist-navy/50">
              {axes.map((ax) => (
                <th key={ax} className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                  {ax}
                </th>
              ))}
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                Name
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-muted">
                Price (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => {
              const key = tupleKey(c);
              const removed = excludedKeys.has(key);
              return (
                <tr
                  key={key}
                  className={`border-b border-hairline last:border-b-0 ${
                    existingKeys.has(key) ? existingRowCls : ""
                  }`}
                >
                  {c.map((v, i) => (
                    <td
                      key={i}
                      className={`px-3 py-2 text-[12px] text-ink-navy ${removed ? removedTextCls : ""}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {capitalizeWords(v)}
                        <HeaderCopyButton
                          onClick={() => copyPriceToAxisValue(i, v)}
                          disabled={!lastPrice}
                          title={
                            lastPrice
                              ? `Copy ₹${lastPrice} across all ${capitalizeWords(v)} (${axes[i]})`
                              : "Type a price in any cell first"
                          }
                        />
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {removed ? null : (
                      <input
                        type="text"
                        value={names[key] ?? ""}
                        onChange={(e) => setName(key, e.target.value)}
                        placeholder={autoName(c)}
                        className={`${nameInputCls} w-40`}
                        title="Variation name — leave empty to use the auto-generated one"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {removed ? (
                      <UndoRowButton onClick={() => toggleRow(c)} />
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          value={prices[key] ?? ""}
                          onChange={(e) => setPrice(key, e.target.value)}
                          placeholder="—"
                          className={priceInputCls}
                        />
                        <RemoveRowButton onClick={() => toggleRow(c)} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  })();

  return (
    <Modal
      open={true}
      title={`Price matrix${addon ? ` — ${getLabel(addon.labels, addon.slug, addon.id)}` : ""}`}
      onClose={onClose}
      maxWidth="max-w-3xl"
      headerAction={
        <button
          type="button"
          onClick={clearAll}
          disabled={loading || (axes.length === 0 && Object.keys(prices).length === 0)}
          title="Reset the grid to blank — axes, values, prices and names (nothing is saved until you press Save)"
          className="tap rounded-pill border border-hairline-strong px-3 py-1.5 text-[12px] font-medium text-ink transition hover:bg-mist-navy disabled:opacity-40"
        >
          Clear all
        </button>
      }
    >
      <div className="space-y-5">
        {loading && <div className="py-6 text-center text-[13px] text-muted">Loading add-on…</div>}

        {!loading && (
          <>
            {/* ── Axes ── */}
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                Axes
              </div>
              <div className="space-y-2">
                {AXIS_DISPLAY.map((ax) => {
                  const on = axes.includes(ax);
                  const placementSelected = parseAxisValues(valuesText[ax] ?? "");
                  return (
                    <div key={ax} className="flex items-center gap-3">
                      <label className="flex w-24 shrink-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => toggleAxis(ax, e.target.checked)}
                          className="h-4 w-4"
                        />
                        <span className="text-[13px] font-medium capitalize text-ink-navy">{ax}</span>
                      </label>
                      {on ? (
                        ax === "placement" ? (
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            {placementVocabulary.map((p) => {
                              const active = placementSelected.includes(p);
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => {
                                    const next = active
                                      ? placementSelected.filter((s) => s !== p)
                                      : [...placementSelected, p];
                                    setValuesText((prev) => ({
                                      ...prev,
                                      placement: next.join(", "),
                                    }));
                                  }}
                                  className={`tap rounded-pill border px-3 py-1 text-[12px] font-medium transition ${
                                    active
                                      ? "border-ink-navy bg-ink-navy text-chalk-white"
                                      : "border-hairline-strong text-ink hover:bg-mist-navy"
                                  }`}
                                >
                                  {p}
                                </button>
                              );
                            })}
                            {placementSelected.length === 0 && (
                              <span className="text-[12px] text-muted">Pick at least one placement.</span>
                            )}
                            {/* Two ways to add a placement: a style component
                                (its label becomes the value and the component
                                is linked to the add-on on save), or a custom
                                free-text value. */}
                            <span className="flex items-center gap-1.5 border-l border-hairline pl-1.5">
                              <span className="w-28 shrink-0">
                                <Select
                                  value=""
                                  onChange={addComponentPlacement}
                                  placeholder="+ Style component"
                                  options={componentOptions}
                                />
                              </span>
                              <span className="text-[11px] text-muted">or</span>
                              <input
                                type="text"
                                value={customPlacement}
                                onChange={(e) => setCustomPlacement(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addPlacementValue(customPlacement);
                                    setCustomPlacement("");
                                  }
                                }}
                                placeholder="Custom value"
                                className="w-32 rounded-card border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none transition focus:border-ink-navy"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  addPlacementValue(customPlacement);
                                  setCustomPlacement("");
                                }}
                                disabled={!customPlacement.trim()}
                                className="tap rounded-pill border border-hairline-strong px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Add
                              </button>
                            </span>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <TextInput
                              value={valuesText[ax] ?? ""}
                              onChange={(v) => setValuesText((prev) => ({ ...prev, [ax]: v }))}
                              placeholder={AXIS_HINTS[ax]}
                            />
                          </div>
                        )
                      ) : (
                        <span className="text-[12px] text-muted">{AXIS_HINTS[ax]}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Matrix ── */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Prices per combination
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-muted">
                    {newCount} to add · {keptExistingCount} existing kept
                    {excludedKeys.size > 0 ? ` · ${excludedKeys.size} removed` : ""} · {pricedCount} priced
                    {mode === "replace" && deleteCount > 0 ? ` · ${deleteCount} to delete` : ""}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={fillPrice}
                    onChange={(e) => setFillPrice(e.target.value)}
                    placeholder="₹"
                    className="w-20 rounded-card border border-hairline-strong bg-chalk-white px-2 py-1 text-right font-mono text-[12px] text-ink outline-none focus:border-ink-navy"
                  />
                  <button
                    type="button"
                    onClick={fillEmpty}
                    disabled={!fillPrice.trim() || sentCombos.length === 0}
                    className="tap rounded-pill border border-hairline-strong px-3 py-1 text-[12px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Fill empty
                  </button>
                </div>
              </div>
              {matrixBody}
              <p className="mt-1.5 text-[11px] text-muted">
                Empty price = combination not sellable (it will be disabled when ordering). Tinted rows
                already exist — saving updates their price; ×{" "}
                {mode === "add"
                  ? "removes a row from this batch."
                  : "removes a row from this batch — its existing variation is deleted."}{" "}
                ⧉ next to a row/column header copies the last price you typed across every
                combination sharing that value (all Round, all Small, all Neck…). A cell&apos;s name
                defaults to all its axis values joined (e.g. Round · Small) — type in the Name
                field to override it.
              </p>
            </div>

            {/* ── Default combination ── */}
            {sentCombos.length > 0 && (
              <Field label="Default combination" hint="Pre-selected when this add-on is enabled">
                <Select
                  value={defaultKey ?? ""}
                  onChange={(v) => setDefaultKey(v || null)}
                  placeholder="None"
                  options={sentCombos.map((c) => ({
                    value: tupleKey(c),
                    label: (names[tupleKey(c)] ?? "").trim() || autoName(c),
                  }))}
                />
              </Field>
            )}

            {variations.length > 0 && mode === "add" && (
              <div className="rounded-card border border-blue-200 bg-blue-50 px-3 py-2.5 text-[12px] text-blue-800">
                Saving is additive — your {variations.length} existing variation
                {variations.length === 1 ? "" : "s"} are never deleted. Removed rows are simply
                skipped; kept rows get their price refreshed and the rest are added as new variations.
              </div>
            )}
            {variations.length > 0 && mode === "replace" && (
              <div
                className={`rounded-card px-3 py-2.5 text-[12px] ${
                  deleteCount > 0
                    ? "border border-red-200 bg-red-50 text-red-700"
                    : "border border-blue-200 bg-blue-50 text-blue-800"
                }`}
              >
                {deleteCount > 0
                  ? `Replace will permanently delete ${deleteCount} existing variation${deleteCount === 1 ? "" : "s"} not in this grid (every variation the matrix doesn't claim). You'll be asked to confirm.`
                  : `Replace keeps every existing variation — all ${variations.length} are claimed by this grid.`}
              </div>
            )}

            {error && (
              <div className="rounded-card bg-red-50 px-3 py-2.5 text-[13px] text-red-700">{error}</div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-muted">Save mode</span>
                <div className="flex overflow-hidden rounded-pill border border-hairline-strong">
                  {(["add", "replace"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={
                        mode === m
                          ? "tap px-3.5 py-1.5 text-[12px] font-semibold text-chalk-white transition bg-ink-navy"
                          : "tap px-3.5 py-1.5 text-[12px] font-medium text-ink-navy transition hover:bg-mist-navy"
                      }
                      title={
                        m === "add"
                          ? "Create new combinations and refresh prices of matching ones — existing variations are never deleted."
                          : "Make this grid the add-on's full variation set — variations it doesn't claim are deleted."
                      }
                    >
                      {m === "add" ? "Add" : "Replace"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="tap rounded-pill border border-hairline-strong px-5 py-2 text-[13px] font-medium text-ink hover:bg-mist-navy"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={`tap inline-flex items-center gap-2 rounded-pill px-5 py-2 text-[13px] font-medium text-chalk-white transition active:scale-95 disabled:opacity-50 ${
                    mode === "replace" && deleteCount > 0
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-ink-navy hover:bg-ink-navy/90"
                  }`}
                >
                  {saving && (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
                      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                  {saving ? "Saving…" : mode === "add" ? "Add variations" : "Replace variations"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
