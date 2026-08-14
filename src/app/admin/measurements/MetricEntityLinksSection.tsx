"use client";

// Entity attachments editor embedded in the metric edit modal.
//
// Everything that decides WHERE this metric is asked (garment / variation /
// variation-type / add-on / add-on variation) and at which capture scope
// (per_job = once per visit, per_garment = per garment instance) is edited
// here, straight on the metric. This drives the captain checklist; the old
// per-garment mapping in the modal is legacy and does not.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createMeasurementLink,
  deleteMeasurementLink,
  listMeasurementLinks,
  updateMeasurementLink,
  type EntityMeasurementLink,
  type MeasurableEntityType,
} from "@/lib/admin-api";
import { loadEntityHierarchy, type EntityHierarchy } from "@/lib/entity-hierarchy";

const ENTITY_TYPE_OPTIONS: { value: MeasurableEntityType; label: string }[] = [
  { value: "garment", label: "Garment (e.g. Blouse)" },
  { value: "variation", label: "Variation (e.g. Sleeve ▸ Regular short)" },
  { value: "variation_type", label: "Variation type (sub-option)" },
  { value: "addon", label: "Add-on (e.g. Breast cups)" },
  { value: "addon_variation", label: "Add-on variation" },
];

type Scope = "per_job" | "per_garment";

export function MetricEntityLinksSection({ metricId }: { metricId: string }) {
  const [links, setLinks] = useState<EntityMeasurementLink[]>([]);
  const [hierarchy, setHierarchy] = useState<EntityHierarchy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Picker state
  const [pickerType, setPickerType] = useState<MeasurableEntityType>("garment");
  const [search, setSearch] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [pickedScope, setPickedScope] = useState<Scope>("per_job");
  const [pickedRequired, setPickedRequired] = useState(true);
  const [attaching, setAttaching] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // Cascading tier filters for non-garment picks (garment ▸ component ▸ parent).
  const [filterGarmentId, setFilterGarmentId] = useState("");
  const [filterComponentId, setFilterComponentId] = useState("");
  const [filterMidId, setFilterMidId] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<EntityMeasurementLink | null>(null);

  const reload = useCallback(async () => {
    try {
      setLinks(await listMeasurementLinks({ measurement_metric_id: metricId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attachments");
    }
  }, [metricId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([reload(), loadEntityHierarchy()])
      .then(([, h]) => {
        if (alive) setHierarchy(h);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  // Reset the picker when the type changes
  useEffect(() => {
    setPickedIds(new Set());
    setSearch("");
    setFilterGarmentId("");
    setFilterComponentId("");
    setFilterMidId("");
  }, [pickerType]);

  const options = useMemo(
    () => hierarchy?.optionsByType[pickerType] ?? [],
    [hierarchy, pickerType],
  );

  // Entities already linked to this metric (type:id) — disabled in the list.
  const attachedKeys = useMemo(
    () => new Set(links.map((l) => `${l.entity_type}:${l.entity_id}`)),
    [links],
  );

  // ─── Cascading filter option sets ─────────────────────────────────────────
  const garmentFilterOptions = useMemo(
    () => hierarchy?.optionsByType.garment ?? [],
    [hierarchy],
  );

  const componentFilterOptions = useMemo(() => {
    let comps = hierarchy?.componentOptions ?? [];
    if (filterGarmentId) comps = comps.filter((c) => c.garmentId === filterGarmentId);
    return comps;
  }, [hierarchy, filterGarmentId]);

  // The tier between the filter and the picked type: variations for
  // variation_type picks, add-ons for addon_variation picks.
  const midFilterOptions = useMemo(() => {
    if (pickerType === "variation_type") {
      let vars = hierarchy?.optionsByType.variation ?? [];
      if (filterGarmentId) vars = vars.filter((o) => o.garmentId === filterGarmentId);
      if (filterComponentId) vars = vars.filter((o) => o.componentId === filterComponentId);
      return vars;
    }
    if (pickerType === "addon_variation") {
      let addons = hierarchy?.optionsByType.addon ?? [];
      if (filterGarmentId) addons = addons.filter((o) => o.garmentId === filterGarmentId);
      return addons;
    }
    return [];
  }, [hierarchy, pickerType, filterGarmentId, filterComponentId]);

  const filteredOptions = useMemo(() => {
    let opts = options;
    if (filterGarmentId) opts = opts.filter((o) => o.garmentId === filterGarmentId);
    if (pickerType === "variation" && filterComponentId)
      opts = opts.filter((o) => o.componentId === filterComponentId);
    if (pickerType === "variation_type") {
      if (filterComponentId) opts = opts.filter((o) => o.componentId === filterComponentId);
      if (filterMidId) opts = opts.filter((o) => o.parentId === filterMidId);
    }
    if (pickerType === "addon_variation" && filterMidId)
      opts = opts.filter((o) => o.parentId === filterMidId);
    if (search.trim()) {
      const q = search.toLowerCase();
      opts = opts.filter((o) => o.label.toLowerCase().includes(q));
    }
    return opts;
  }, [options, pickerType, filterGarmentId, filterComponentId, filterMidId, search]);

  const selectableOptions = useMemo(
    () => filteredOptions.filter((o) => !attachedKeys.has(`${pickerType}:${o.id}`)),
    [filteredOptions, attachedKeys, pickerType],
  );

  const midFilterLabel =
    pickerType === "variation_type" ? "Variation" : pickerType === "addon_variation" ? "Add-on" : "";

  const labelFor = useCallback(
    (l: EntityMeasurementLink) =>
      hierarchy?.optionFor(l.entity_type, l.entity_id)?.label ??
      `${l.entity_type} ${l.entity_id?.slice(0, 8) ?? "?"}…`,
    [hierarchy],
  );

  const typeChip = (l: EntityMeasurementLink) =>
    ENTITY_TYPE_OPTIONS.find((o) => o.value === l.entity_type)?.label.split(" (")[0] ??
    String(l.entity_type);

  async function attach() {
    setPickerError(null);
    if (pickedIds.size === 0) {
      setPickerError("Pick at least one entity.");
      return;
    }
    setAttaching(true);
    const failures: string[] = [];
    await Promise.all(
      [...pickedIds].map(async (entityId) => {
        try {
          await createMeasurementLink({
            entity_type: pickerType,
            entity_id: entityId,
            measurement_metric_id: metricId,
            capture_scope: pickedScope,
            is_required: pickedRequired,
          });
        } catch {
          failures.push(
            hierarchy?.optionFor(pickerType, entityId)?.label ?? entityId.slice(0, 8),
          );
        }
      }),
    );
    setPickedIds(new Set());
    await reload();
    if (failures.length > 0)
      setPickerError(`Could not attach: ${failures.join(", ")}`);
    setAttaching(false);
  }

  async function patchLink(id: string, patch: Parameters<typeof updateMeasurementLink>[1]) {
    try {
      await updateMeasurementLink(id, patch);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update link");
    }
  }

  async function detach() {
    if (!deleteTarget) return;
    try {
      await deleteMeasurementLink(deleteTarget.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to detach");
    }
    setDeleteTarget(null);
    await reload();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Entity attachments — drives the captain checklist
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Attach this metric where its trigger lives: garment (&ldquo;it&rsquo;s a
        blouse&rdquo;), a style variation (&ldquo;it has sleeves&rdquo;), or an
        add-on. Scope decides once-per-visit (per_job) vs per-garment-instance
        (per_garment).
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-slate-400">Loading attachments…</p>
      ) : (
        <>
          {error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {/* Existing links */}
          {links.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-center text-xs text-slate-400">
              Not attached to any entity yet — this metric won&rsquo;t appear in
              any checklist.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {links
                .slice()
                .sort(
                  (a, b) =>
                    String(a.entity_type).localeCompare(String(b.entity_type)) ||
                    labelFor(a).localeCompare(labelFor(b)),
                )
                .map((l) => (
                  <li key={l.id} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {labelFor(l)}
                          {l.is_required && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                              REQ
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {typeChip(l)}
                        </p>
                      </div>
                      <button
                        onClick={() => setDeleteTarget(l)}
                        className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                      >
                        Detach
                      </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        Scope
                        <select
                          value={l.capture_scope ?? "per_job"}
                          onChange={(e) =>
                            patchLink(l.id, {
                              capture_scope: e.target.value as Scope,
                            })
                          }
                          className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                        >
                          <option value="per_job">per job (once per visit)</option>
                          <option value="per_garment">per garment (per instance)</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={l.is_required ?? false}
                          onChange={(e) =>
                            patchLink(l.id, { is_required: e.target.checked })
                          }
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        Order
                        <input
                          type="number"
                          defaultValue={l.priority_order ?? ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const next = v ? Number(v) : null;
                            if (next !== l.priority_order)
                              patchLink(l.id, { priority_order: next });
                          }}
                          className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs"
                        />
                      </label>
                    </div>
                  </li>
                ))}
            </ul>
          )}

          {/* Attach picker */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">
              + Attach to entities
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">
                  Entity type
                </span>
                <select
                  value={pickerType}
                  onChange={(e) =>
                    setPickerType(e.target.value as MeasurableEntityType)
                  }
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {ENTITY_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">
                  Scope
                </span>
                <select
                  value={pickedScope}
                  onChange={(e) => setPickedScope(e.target.value as Scope)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="per_job">per job (once per visit)</option>
                  <option value="per_garment">per garment (per instance)</option>
                </select>
              </label>
            </div>

            {/* Tier filters — narrow the list from the top of the hierarchy down */}
            {pickerType !== "garment" && (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">
                    Garment
                  </span>
                  <select
                    value={filterGarmentId}
                    onChange={(e) => {
                      setFilterGarmentId(e.target.value);
                      setFilterComponentId("");
                      setFilterMidId("");
                    }}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">All garments</option>
                    {garmentFilterOptions.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.shortLabel}
                      </option>
                    ))}
                  </select>
                </label>
                {(pickerType === "variation" || pickerType === "variation_type") && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">
                      Component
                    </span>
                    <select
                      value={filterComponentId}
                      onChange={(e) => {
                        setFilterComponentId(e.target.value);
                        setFilterMidId("");
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">All components</option>
                      {componentFilterOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {midFilterLabel && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">
                      {midFilterLabel}
                    </span>
                    <select
                      value={filterMidId}
                      onChange={(e) => setFilterMidId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">All {midFilterLabel.toLowerCase()}s</option>
                      {midFilterOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.shortLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entities (name or path)…"
              className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />

            {/* Multi-check entity list — every checked entity gets its own link */}
            <div className="mt-1 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {filteredOptions.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-slate-400">
                  No entities match the filters.
                </p>
              ) : (
                filteredOptions.map((o) => {
                  const already = attachedKeys.has(`${pickerType}:${o.id}`);
                  const checked = pickedIds.has(o.id);
                  return (
                    <label
                      key={o.id}
                      className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                        already ? "opacity-50" : "cursor-pointer hover:bg-slate-50"
                      }`}
                      title={o.label}
                    >
                      <input
                        type="checkbox"
                        disabled={already}
                        checked={checked}
                        onChange={() =>
                          setPickedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(o.id)) next.delete(o.id);
                            else next.add(o.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-700">
                        {o.label}
                      </span>
                      {already && (
                        <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                          attached
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={pickedRequired}
                    onChange={(e) => setPickedRequired(e.target.checked)}
                  />
                  Required (gates completion)
                </label>
                {selectableOptions.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPickedIds(
                          new Set(selectableOptions.map((o) => o.id)),
                        )
                      }
                      className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
                    >
                      Select all ({selectableOptions.length})
                    </button>
                    {pickedIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setPickedIds(new Set())}
                        className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
                      >
                        Clear
                      </button>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={attach}
                disabled={attaching || pickedIds.size === 0}
                className="rounded-pill bg-ink-navy px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {attaching
                  ? "Attaching…"
                  : pickedIds.size > 0
                    ? `Attach (${pickedIds.size})`
                    : "Attach"}
              </button>
            </div>
            {pickerError && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {pickerError}
              </p>
            )}
          </div>
        </>
      )}

      {/* Detach confirm */}
      {deleteTarget && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-800">
            Detach this metric from{" "}
            <strong>{labelFor(deleteTarget)}</strong>?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={detach}
              className="rounded-pill bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
            >
              Detach
            </button>
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-pill border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
