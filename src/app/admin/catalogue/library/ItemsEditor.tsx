"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminCreateLibraryItem,
  adminDeleteLibraryItem,
  adminGetPicker,
  adminListLibraryItems,
  adminUpdateLibraryItem,
  type LibraryItem,
  type PickerTree,
} from "@/lib/admin-api";

// ─── Helpers ───────────────────────────────────────────────────────────────

function en(d: Record<string, string> | null | undefined): string {
  return d?.en ?? "";
}

/** Build a human-readable label for an existing item. */
function itemLabel(item: LibraryItem): string {
  if (item.type === "variation") {
    const comp = en(item.component_label) || "Component";
    const varn = en(item.variation_label) || "—";
    const t = en(item.variation_type_label);
    return t ? `${comp}: ${varn} (${t})` : `${comp}: ${varn}`;
  }
  // add_on
  const addon = en(item.addon_label) || "Add-on";
  const varn = en(item.addon_variation_label);
  const placement = (item.placement ?? []).join(", ");
  const tail = [varn, placement && `[${placement}]`].filter(Boolean).join(" ");
  return tail ? `${addon}${tail ? " — " + tail : ""}` : addon;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ItemsEditor({ libraryId }: { libraryId: string }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [tree, setTree] = useState<PickerTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pickers
  const [adding, setAdding] = useState<"variation" | "add_on" | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [itms, tr] = await Promise.all([
        adminListLibraryItems(libraryId),
        adminGetPicker(libraryId),
      ]);
      setItems(itms);
      setTree(tr);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const variationItems = items.filter((i) => i.type === "variation");
  const addonItems = items.filter((i) => i.type === "add_on");

  async function handleDelete(itemId: string) {
    setBusy(true);
    setErr(null);
    try {
      await adminDeleteLibraryItem(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(payload: Parameters<typeof adminCreateLibraryItem>[1]) {
    setBusy(true);
    setErr(null);
    try {
      const created = await adminCreateLibraryItem(libraryId, payload);
      setItems((prev) => [...prev, created]);
      setAdding(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(itemId: string, patch: Parameters<typeof adminUpdateLibraryItem>[1]) {
    setBusy(true);
    setErr(null);
    try {
      const updated = await adminUpdateLibraryItem(itemId, patch);
      setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="py-4 text-[12px] text-muted">Loading items…</div>;
  }

  if (!tree) {
    return <div className="py-4 text-[12px] text-muted">No catalog available.</div>;
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {err}
        </div>
      )}

      {/* ─── Structure (variations) ─────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-semibold text-ink-navy">
            Structure <span className="text-muted">· {variationItems.length}</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding(adding === "variation" ? null : "variation")}
            className="rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:opacity-50"
          >
            {adding === "variation" ? "Cancel" : "+ Add component"}
          </button>
        </div>

        {adding === "variation" && (
          <VariationPicker
            tree={tree}
            existingComponentIds={variationItems.map((i) => i.garment_style_component_id).filter(Boolean) as string[]}
            disabled={busy}
            onCreate={handleCreate}
            onCancel={() => setAdding(null)}
          />
        )}

        <div className="space-y-1.5">
          {variationItems.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              tree={tree}
              busy={busy}
              onDelete={() => handleDelete(it.id)}
              onUpdate={(patch) => handleUpdate(it.id, patch)}
            />
          ))}
          {variationItems.length === 0 && adding !== "variation" && (
            <p className="text-[12px] text-muted">No structure items.</p>
          )}
        </div>
      </div>

      {/* ─── Add-ons ─────────────────────────────────────────────────────── */}
      <div className="border-t border-hairline pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-semibold text-ink-navy">
            Add-ons <span className="text-muted">· {addonItems.length}</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding(adding === "add_on" ? null : "add_on")}
            className="rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:opacity-50"
          >
            {adding === "add_on" ? "Cancel" : "+ Add add-on"}
          </button>
        </div>

        {adding === "add_on" && (
          <AddonPicker
            tree={tree}
            existingAddonIds={addonItems.map((i) => i.addon_id).filter(Boolean) as string[]}
            disabled={busy}
            onCreate={handleCreate}
            onCancel={() => setAdding(null)}
          />
        )}

        <div className="space-y-1.5">
          {addonItems.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              tree={tree}
              busy={busy}
              onDelete={() => handleDelete(it.id)}
              onUpdate={(patch) => handleUpdate(it.id, patch)}
            />
          ))}
          {addonItems.length === 0 && adding !== "add_on" && (
            <p className="text-[12px] text-muted">No add-ons.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ItemRow (existing item, inline edit + delete) ─────────────────────────

function ItemRow({
  item,
  tree,
  busy,
  onDelete,
  onUpdate,
}: {
  item: LibraryItem;
  tree: PickerTree;
  busy: boolean;
  onDelete: () => void;
  onUpdate: (patch: Parameters<typeof adminUpdateLibraryItem>[1]) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-card border border-hairline bg-chalk-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
            {item.type === "variation" ? "VAR" : "ADD"}
          </span>
          <span className="truncate text-[13px] text-ink-navy">{itemLabel(item)}</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          aria-label="Remove"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {expanded && (
        <ItemEditor item={item} tree={tree} busy={busy} onUpdate={onUpdate} />
      )}
    </div>
  );
}

function ItemEditor({
  item,
  tree,
  busy,
  onUpdate,
}: {
  item: LibraryItem;
  tree: PickerTree;
  busy: boolean;
  onUpdate: (patch: Parameters<typeof adminUpdateLibraryItem>[1]) => void;
}) {
  if (item.type === "variation") {
    const comp = tree.components.find((c) => c.id === item.garment_style_component_id);
    if (!comp) return <div className="mt-2 text-[11px] text-muted">Component no longer exists.</div>;
    return (
      <div className="mt-2 space-y-2">
        <Selector
          label="Variation"
          value={item.variation_id ?? ""}
          options={comp.variations.map((v) => ({ id: v.id, label: en(v.labels) || v.slug || v.id, sub: v.price != null ? `₹${v.price}` : undefined }))}
          disabled={busy}
          onChange={(variation_id) => onUpdate({ variation_id, variation_type_id: null })}
        />
        {(() => {
          const v = comp.variations.find((x) => x.id === item.variation_id);
          if (!v || v.types.length === 0) return null;
          return (
            <Selector
              label="Type"
              value={item.variation_type_id ?? ""}
              options={v.types.map((t) => ({ id: t.id, label: en(t.labels) || t.slug || t.id, sub: t.price != null ? `₹${t.price}` : undefined }))}
              disabled={busy}
              onChange={(variation_type_id) => onUpdate({ variation_type_id })}
            />
          );
        })()}
      </div>
    );
  }

  // add_on
  const ad = tree.addons.find((a) => a.id === item.addon_id);
  return (
    <div className="mt-2 space-y-2">
      {ad && ad.variations.length > 0 && (
        <Selector
          label="Variation"
          value={item.addon_variation_id ?? ""}
          options={ad.variations.map((v) => ({ id: v.id, label: en(v.labels) || v.slug || v.id, sub: v.price != null ? `₹${v.price}` : undefined }))}
          disabled={busy}
          onChange={(addon_variation_id) => onUpdate({ addon_variation_id })}
        />
      )}
      {ad && ad.placements && ad.placements.length > 0 && (
        <PlacementCheckboxes
          value={item.placement ?? []}
          options={ad.placements}
          disabled={busy}
          onChange={(placement) => onUpdate({ placement })}
        />
      )}
    </div>
  );
}

// ─── Variations picker (add new) ───────────────────────────────────────────

function VariationPicker({
  tree,
  existingComponentIds,
  disabled,
  onCreate,
  onCancel,
}: {
  tree: PickerTree;
  existingComponentIds: string[];
  disabled: boolean;
  onCreate: (payload: Parameters<typeof adminCreateLibraryItem>[1]) => void;
  onCancel: () => void;
}) {
  const availableComponents = tree.components.filter(
    (c) => !existingComponentIds.includes(c.id),
  );

  const [componentId, setComponentId] = useState<string>(availableComponents[0]?.id ?? "");
  const [variationId, setVariationId] = useState<string>("");
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [variationTypeId, setVariationTypeId] = useState<string>("");

  // When component changes, reset variation + types
  useEffect(() => {
    setVariationId("");
    setVariationTypeId("");
  }, [componentId]);

  const component = availableComponents.find((c) => c.id === componentId);

  // When variation changes, capture its types
  useEffect(() => {
    if (!component) {
      setTypeIds([]);
      return;
    }
    const v = component.variations.find((x) => x.id === variationId);
    setTypeIds(v ? v.types.map((t) => t.id) : []);
    setVariationTypeId("");
  }, [variationId, component]);

  if (availableComponents.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-mist-navy/40 px-3 py-2 text-[12px] text-muted">
        All components already have a selection.
      </div>
    );
  }

  function handleCreate() {
    if (!componentId || !variationId) return;
    onCreate({
      garment_style_component_id: componentId,
      variation_id: variationId,
      variation_type_id: variationTypeId || null,
    });
  }

  return (
    <div className="mb-2 rounded-card border border-hairline bg-warm-sand/30 p-3">
      <div className="grid grid-cols-3 gap-2">
        <Selector
          label="Component"
          value={componentId}
          options={availableComponents.map((c) => ({ id: c.id, label: en(c.labels) || c.slug || c.id }))}
          disabled={disabled}
          onChange={setComponentId}
        />
        <Selector
          label="Variation"
          value={variationId}
          options={(component?.variations ?? []).map((v) => ({ id: v.id, label: en(v.labels) || v.slug || v.id, sub: v.price != null ? `₹${v.price}` : undefined }))}
          disabled={disabled || !component}
          onChange={setVariationId}
        />
        {typeIds.length > 0 && (
          <Selector
            label="Type"
            value={variationTypeId}
            options={(component?.variations.find((v) => v.id === variationId)?.types ?? []).map((t) => ({ id: t.id, label: en(t.labels) || t.slug || t.id, sub: t.price != null ? `₹${t.price}` : undefined }))}
            disabled={disabled}
            onChange={setVariationTypeId}
          />
        )}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-card px-3 py-1 text-[12px] text-muted transition hover:text-ink-navy"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={disabled || !componentId || !variationId}
          className="rounded-card bg-ink-navy px-3 py-1 text-[12px] font-semibold text-chalk-white transition hover:bg-navy-interactive disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Add-on picker (add new) ───────────────────────────────────────────────

function AddonPicker({
  tree,
  existingAddonIds,
  disabled,
  onCreate,
  onCancel,
}: {
  tree: PickerTree;
  existingAddonIds: string[];
  disabled: boolean;
  onCreate: (payload: Parameters<typeof adminCreateLibraryItem>[1]) => void;
  onCancel: () => void;
}) {
  const availableAddons = tree.addons.filter((a) => !existingAddonIds.includes(a.id));

  const [addonId, setAddonId] = useState<string>(availableAddons[0]?.id ?? "");
  const [addonVariationId, setAddonVariationId] = useState<string>("");
  const [placement, setPlacement] = useState<string[]>([]);

  useEffect(() => {
    setAddonVariationId("");
    setPlacement([]);
  }, [addonId]);

  const addon = availableAddons.find((a) => a.id === addonId);

  if (availableAddons.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-mist-navy/40 px-3 py-2 text-[12px] text-muted">
        All add-ons already added.
      </div>
    );
  }

  function handleCreate() {
    if (!addonId) return;
    onCreate({
      addon_id: addonId,
      addon_variation_id: addonVariationId || null,
      placement: placement.length > 0 ? placement : null,
    });
  }

  return (
    <div className="mb-2 rounded-card border border-hairline bg-warm-sand/30 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Selector
          label="Add-on"
          value={addonId}
          options={availableAddons.map((a) => ({ id: a.id, label: en(a.labels) || a.slug || a.id, sub: a.type ?? undefined }))}
          disabled={disabled}
          onChange={setAddonId}
        />
        {addon && addon.variations.length > 0 && (
          <Selector
            label="Variation"
            value={addonVariationId}
            options={addon.variations.map((v) => ({ id: v.id, label: en(v.labels) || v.slug || v.id, sub: v.price != null ? `₹${v.price}` : undefined }))}
            disabled={disabled}
            onChange={setAddonVariationId}
          />
        )}
      </div>
      {addon && addon.placements && addon.placements.length > 0 && (
        <div className="mt-2">
          <PlacementCheckboxes
            value={placement}
            options={addon.placements}
            disabled={disabled}
            onChange={setPlacement}
          />
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-card px-3 py-1 text-[12px] text-muted transition hover:text-ink-navy"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={disabled || !addonId}
          className="rounded-card bg-ink-navy px-3 py-1 text-[12px] font-semibold text-chalk-white transition hover:bg-navy-interactive disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Primitives ────────────────────────────────────────────────────────────

function Selector({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; sub?: string }[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-card border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[13px] outline-none focus:border-ink-navy"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}{o.sub ? ` (${o.sub})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlacementCheckboxes({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string[];
  options: string[];
  disabled?: boolean;
  onChange: (v: string[]) => void;
}) {
  function toggle(opt: string) {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  }

  return (
    <div>
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">Placement</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const checked = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt)}
              className={`rounded-pill border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                checked
                  ? "border-ink-navy bg-ink-navy text-chalk-white"
                  : "border-hairline-strong bg-chalk-white text-ink hover:bg-mist-navy"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
