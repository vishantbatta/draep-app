"use client";

// Measurements-to-take editor embedded in the catalogue entity edit forms.
//
// The entity→metrics mirror of MetricEntityLinksSection (which lives on the
// metric side): shows every measurement metric attached to THIS entity, lets
// the admin attach/detach metrics and tweak each link's capture scope /
// required / order. Editing the metric itself (labels, unit, rules) is NOT
// done here — "Edit" deep-links to the metric's edit modal on
// /admin/measurements.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createMeasurementLink,
  deleteMeasurementLink,
  fetchMeasurementMetrics,
  getLabel,
  listMeasurementLinks,
  updateMeasurementLink,
  type EntityMeasurementLink,
  type MeasurableEntityType,
  type MeasurementMetricRow,
} from "@/lib/admin-api";

type Scope = "per_job" | "per_garment";

export function EntityMetricsSection({
  entityType,
  entityId,
}: {
  entityType: MeasurableEntityType;
  entityId: string;
}) {
  const router = useRouter();

  const [links, setLinks] = useState<EntityMeasurementLink[]>([]);
  const [metrics, setMetrics] = useState<MeasurementMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Picker state
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [pickedScope, setPickedScope] = useState<Scope>("per_job");
  const [pickedRequired, setPickedRequired] = useState(true);
  const [pickedOrder, setPickedOrder] = useState<string>("");
  const [attaching, setAttaching] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<EntityMeasurementLink | null>(null);

  const reload = useCallback(async () => {
    try {
      setLinks(await listMeasurementLinks({ entity_type: entityType, entity_id: entityId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attached measurements");
    }
  }, [entityType, entityId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      reload(),
      // Catalog is small and static-ish; fetched once per mount alongside links.
      fetchMeasurementMetrics().catch(() => [] as MeasurementMetricRow[]),
    ])
      .then(([, catalog]) => {
        if (alive) setMetrics(catalog);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  const metricById = useMemo(
    () => new Map(metrics.map((m) => [m.id, m])),
    [metrics],
  );

  const labelFor = useCallback(
    (l: EntityMeasurementLink) => {
      const m = l.measurement_metric_id ? metricById.get(l.measurement_metric_id) : null;
      return m ? getLabel(m.labels, m.code, m.id) : `metric ${l.measurement_metric_id?.slice(0, 8) ?? "?"}…`;
    },
    [metricById],
  );

  // Metrics already attached — disabled in the picker.
  const attachedMetricIds = useMemo(
    () => new Set(links.map((l) => l.measurement_metric_id)),
    [links],
  );

  const filteredMetrics = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return metrics;
    return metrics.filter(
      (m) =>
        getLabel(m.labels, m.code, m.id).toLowerCase().includes(q) ||
        (m.code ?? "").toLowerCase().includes(q),
    );
  }, [metrics, search]);

  const selectableMetrics = useMemo(
    () => filteredMetrics.filter((m) => !attachedMetricIds.has(m.id)),
    [filteredMetrics, attachedMetricIds],
  );

  async function attach() {
    setPickerError(null);
    if (pickedIds.size === 0) {
      setPickerError("Pick at least one metric.");
      return;
    }
    setAttaching(true);
    const failures: string[] = [];
    await Promise.all(
      [...pickedIds].map(async (metricId) => {
        try {
          await createMeasurementLink({
            entity_type: entityType,
            entity_id: entityId,
            measurement_metric_id: metricId,
            capture_scope: pickedScope,
            is_required: pickedRequired,
            priority_order: pickedOrder ? Number(pickedOrder) : null,
          });
        } catch {
          const m = metricById.get(metricId);
          failures.push(m ? getLabel(m.labels, m.code, m.id) : metricId.slice(0, 8));
        }
      }),
    );
    setPickedIds(new Set());
    await reload();
    if (failures.length > 0) setPickerError(`Could not attach: ${failures.join(", ")}`);
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
        Measurements to take — drives the captain checklist
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Metrics attached to this entity. Scope decides once-per-visit
        (per_job) vs per-garment-instance (per_garment). Metric details are
        edited on the Measurements page.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-slate-400">Loading measurements…</p>
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
              No measurements attached yet — this entity adds nothing to the
              captain&rsquo;s checklist.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {links
                .slice()
                .sort((a, b) => (a.priority_order ?? 999) - (b.priority_order ?? 999))
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
                          <span
                            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              l.capture_scope === "per_garment"
                                ? "bg-violet-50 text-violet-700"
                                : "bg-blue-50 text-blue-700"
                            }`}
                          >
                            {l.capture_scope === "per_garment" ? "per garment" : "per job"}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {metricById.get(l.measurement_metric_id ?? "")?.code ?? ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            l.measurement_metric_id &&
                            router.push(
                              `/admin/measurements?metric=${l.measurement_metric_id}`,
                            )
                          }
                          className="text-xs font-medium text-ink-navy hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(l)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Detach
                        </button>
                      </div>
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
          {showPicker ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="mb-2 text-xs font-semibold text-slate-600">
                  + Attach metrics
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowPicker(false);
                    setPickedIds(new Set());
                    setSearch("");
                  }}
                  className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mb-2 grid gap-2 sm:grid-cols-3">
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
                <label className="flex items-end gap-1.5 pb-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={pickedRequired}
                    onChange={(e) => setPickedRequired(e.target.checked)}
                  />
                  Required (gates completion)
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">
                    Order
                  </span>
                  <input
                    type="number"
                    value={pickedOrder}
                    onChange={(e) => setPickedOrder(e.target.value)}
                    placeholder="auto"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>

              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search metrics (name or code)…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />

              {/* Multi-check metric list — every checked metric gets its own link */}
              <div className="mt-1 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {filteredMetrics.length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-slate-400">
                    No metrics match the search.
                  </p>
                ) : (
                  filteredMetrics.map((m) => {
                    const already = attachedMetricIds.has(m.id);
                    const checked = pickedIds.has(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                          already ? "opacity-50" : "cursor-pointer hover:bg-slate-50"
                        }`}
                        title={getLabel(m.labels, m.code, m.id)}
                      >
                        <input
                          type="checkbox"
                          disabled={already}
                          checked={checked}
                          onChange={() =>
                            setPickedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-slate-700">
                          {getLabel(m.labels, m.code, m.id)}
                          {m.code && (
                            <span className="ml-2 font-mono text-[10px] text-slate-400">
                              {m.code}
                            </span>
                          )}
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
                  {selectableMetrics.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setPickedIds(new Set(selectableMetrics.map((m) => m.id)))
                        }
                        className="text-[11px] font-medium text-slate-500 underline hover:text-slate-700"
                      >
                        Select all ({selectableMetrics.length})
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
          ) : (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="mt-3 rounded-pill border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              + Add metric
            </button>
          )}
        </>
      )}

      {/* Detach confirm */}
      {deleteTarget && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-800">
            Detach <strong>{labelFor(deleteTarget)}</strong> from this entity? It
            stops appearing in the captain&rsquo;s checklist for it.
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
