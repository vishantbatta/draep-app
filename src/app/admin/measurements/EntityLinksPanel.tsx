"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createMeasurementLink,
  deleteMeasurementLink,
  fetchAll,
  getLabel,
  listMeasurementLinks,
  listOrphanLinks,
  MEASURABLE_ENTITY_TABLES,
  type EntityMeasurementLink,
  type MeasurableEntityType,
  type OrphanLink,
} from "@/lib/admin-api";
import {
  ConfirmDelete,
  ErrorState,
  LoadingState,
  Modal,
} from "@/app/admin/catalogue/_shared/catalogue-helpers";

// ═══════════════════════════════════════════════════════════════════════════════
//  Entity measurement links manager + orphan sweeper
//
//  Configures WHICH metrics an entity demands: attach where the trigger
//  lives — "it's a blouse" → garment link (per_job body metrics / per_garment
//  fit metrics); "it has sleeves" → sleeve-variation links. The backend
//  write-time-guards every create (422 on unknown entity type / dead entity).
// ═══════════════════════════════════════════════════════════════════════════════

interface EntityRow {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
}

interface MetricRow {
  id: string;
  code: string | null;
  labels: Record<string, string> | null;
}

const ENTITY_TYPE_OPTIONS: { value: MeasurableEntityType; label: string }[] = [
  { value: "garment", label: "Garment" },
  { value: "variation", label: "Variation" },
  { value: "variation_type", label: "Variation type" },
  { value: "addon", label: "Add-on" },
  { value: "addon_variation", label: "Add-on variation" },
];

const SCOPE_OPTIONS = [
  { value: "per_job", label: "per_job — once per visit (base)" },
  { value: "per_garment", label: "per_garment — once per garment instance" },
];

export function EntityLinksPanel() {
  // ── Links view ──
  const [links, setLinks] = useState<EntityMeasurementLink[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterType, setFilterType] = useState<string>("");
  const [filterEntityId, setFilterEntityId] = useState<string>("");

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [entityType, setEntityType] = useState<MeasurableEntityType>("garment");
  const [entityId, setEntityId] = useState("");
  const [entityOptions, setEntityOptions] = useState<EntityRow[]>([]);
  const [entitySearch, setEntitySearch] = useState("");
  const [metricId, setMetricId] = useState("");
  const [scope, setScope] = useState<"per_job" | "per_garment">("per_job");
  const [isRequired, setIsRequired] = useState(true);
  const [priority, setPriority] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<EntityMeasurementLink | null>(null);

  // ── Orphans view ──
  const [view, setView] = useState<"links" | "orphans">("links");
  const [orphans, setOrphans] = useState<OrphanLink[]>([]);
  const [orphansLoading, setOrphansLoading] = useState(false);
  const [orphansError, setOrphansError] = useState<string | null>(null);
  const [cleanedCount, setCleanedCount] = useState<number | null>(null);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ls, ms] = await Promise.all([
        listMeasurementLinks({
          entity_type: filterType || undefined,
          entity_id: filterEntityId || undefined,
        }),
        metrics.length
          ? Promise.resolve(metrics)
          : fetchAll<MetricRow>("measurement_metrics"),
      ]);
      setLinks(ls);
      setMetrics(ms);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterEntityId]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  // Load entity options when the picker's type changes
  useEffect(() => {
    setEntityId("");
    setEntitySearch("");
    fetchAll<EntityRow>(MEASURABLE_ENTITY_TABLES[entityType])
      .then(setEntityOptions)
      .catch(() => setEntityOptions([]));
  }, [entityType]);

  const metricById = useMemo(() => {
    const map = new Map<string, MetricRow>();
    metrics.forEach((m) => map.set(m.id, m));
    return map;
  }, [metrics]);

  // Group links by entity for display
  const grouped = useMemo(() => {
    const map = new Map<string, EntityMeasurementLink[]>();
    for (const l of links) {
      const key = `${l.entity_type}:${l.entity_id}`;
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [links]);

  async function handleCreate() {
    setFormError(null);
    if (!entityId || !metricId) {
      setFormError("Pick an entity and a metric.");
      return;
    }
    setCreating(true);
    try {
      await createMeasurementLink({
        entity_type: entityType,
        entity_id: entityId,
        measurement_metric_id: metricId,
        capture_scope: scope,
        is_required: isRequired,
        priority_order: priority.trim() ? Number(priority.trim()) : null,
      });
      setShowCreate(false);
      setMetricId("");
      setPriority("");
      await loadLinks();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to create link");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMeasurementLink(deleteTarget.id);
      setDeleteTarget(null);
      await loadLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete link");
      setDeleteTarget(null);
    }
  }

  async function loadOrphans(cleanup = false) {
    setOrphansLoading(true);
    setOrphansError(null);
    setCleanedCount(null);
    try {
      const res = await listOrphanLinks(cleanup);
      setOrphans(res.orphans);
      if (cleanup) setCleanedCount(res.cleaned);
    } catch (e) {
      setOrphansError(e instanceof Error ? e.message : "Failed to load orphans");
    } finally {
      setOrphansLoading(false);
    }
  }

  useEffect(() => {
    if (view === "orphans" && orphans.length === 0 && !cleanedCount) {
      loadOrphans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const filteredEntityOptions = entityOptions.filter((o) => {
    if (!entitySearch.trim()) return true;
    const q = entitySearch.toLowerCase();
    return (
      (o.slug ?? "").toLowerCase().includes(q) ||
      Object.values(o.labels ?? {}).some((v) => v.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4">
      {/* View switcher */}
      <div className="flex items-center gap-2">
        {(["links", "orphans"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-pill px-3 py-1.5 text-sm font-medium transition ${
              view === v
                ? "bg-ink-navy text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {v === "links" ? "Entity links" : "Orphan sweeper"}
          </button>
        ))}
      </div>

      {view === "links" ? (
        <>
          {/* Filters + create */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Entity type
              </span>
              <select
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value);
                  setFilterEntityId("");
                }}
                className="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All types</option>
                {ENTITY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Entity id
              </span>
              <input
                type="text"
                value={filterEntityId}
                onChange={(e) => setFilterEntityId(e.target.value)}
                placeholder="exact UUID filter"
                className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              onClick={() => loadLinks()}
              className="rounded-pill border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Apply
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="ml-auto rounded-pill bg-ink-navy px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              + Attach metric
            </button>
          </div>

          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={loadLinks} />
          ) : grouped.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm font-semibold text-slate-700">
                No measurement links
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Attach metrics to garments, variations or add-ons to build
                capture checklists.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {grouped.map(([key, group]) => {
                const [etype, eid] = key.split(":");
                const typeLabel =
                  ENTITY_TYPE_OPTIONS.find((o) => o.value === etype)?.label ??
                  etype;
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-200 bg-white"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                      <div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {typeLabel}
                        </span>
                        <span className="ml-2 font-mono text-xs text-slate-500">
                          {eid?.slice(0, 8)}…
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {group.length} link{group.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {group
                        .slice()
                        .sort(
                          (a, b) =>
                            (a.priority_order ?? 999) - (b.priority_order ?? 999),
                        )
                        .map((l) => {
                          const metric = l.measurement_metric_id
                            ? metricById.get(l.measurement_metric_id)
                            : null;
                          return (
                            <li
                              key={l.id}
                              className="flex items-center justify-between px-4 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">
                                  {metric
                                    ? getLabel(
                                        metric.labels,
                                        metric.code,
                                        metric.id,
                                      )
                                    : l.measurement_metric_id}
                                  {l.is_required && (
                                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                      REQ
                                    </span>
                                  )}
                                </p>
                                <p className="font-mono text-[11px] text-slate-400">
                                  {metric?.code ?? "—"}
                                  {l.priority_order != null &&
                                    ` · #${l.priority_order}`}
                                  {l.condition_note ? ` · ${l.condition_note}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    l.capture_scope === "per_job"
                                      ? "bg-blue-50 text-blue-700"
                                      : "bg-violet-50 text-violet-700"
                                  }`}
                                >
                                  {l.capture_scope}
                                </span>
                                <button
                                  onClick={() => setDeleteTarget(l)}
                                  className="text-xs font-medium text-red-600 hover:underline"
                                >
                                  Detach
                                </button>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ── Orphan sweeper ── */
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">
              Links whose entity no longer exists (entity_id has no FK by
              design — this sweeper is the safety net for delete paths that
              bypass the app-layer cascade, e.g. raw table edits).
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => loadOrphans(false)}
                disabled={orphansLoading}
                className="rounded-pill border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {orphansLoading ? "Scanning…" : "Re-scan"}
              </button>
              <button
                onClick={() => loadOrphans(true)}
                disabled={orphansLoading || orphans.length === 0}
                className="rounded-pill bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Clean {orphans.length} orphan{orphans.length === 1 ? "" : "s"}
              </button>
            </div>
            {cleanedCount != null && cleanedCount > 0 && (
              <p className="mt-2 text-sm font-medium text-green-700">
                Deleted {cleanedCount} orphan link{cleanedCount === 1 ? "" : "s"}.
              </p>
            )}
          </div>

          {orphansError ? (
            <ErrorState
              message={orphansError}
              onRetry={() => loadOrphans(false)}
            />
          ) : !orphansLoading && orphans.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm font-semibold text-slate-700">No orphans</p>
              <p className="mt-1 text-xs text-slate-500">
                Every link points at a live entity.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {orphans.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between px-4 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {o.entity_type}
                    </p>
                    <p className="font-mono text-[11px] text-slate-400">
                      {o.entity_id}
                      {o.capture_scope ? ` · ${o.capture_scope}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Create modal ── */}
      <Modal
        open={showCreate}
        title="Attach metric to entity"
        onClose={() => setShowCreate(false)}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Entity type
            </span>
            <select
              value={entityType}
              onChange={(e) =>
                setEntityType(e.target.value as MeasurableEntityType)
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {ENTITY_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Entity
            </span>
            <input
              type="text"
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              placeholder="Search by slug or label…"
              className="mb-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              size={Math.min(6, Math.max(3, filteredEntityOptions.length))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— pick an entity —</option>
              {filteredEntityOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {getLabel(o.labels, o.slug, o.id)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Metric
            </span>
            <select
              value={metricId}
              onChange={(e) => setMetricId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— pick a metric —</option>
              {metrics
                .slice()
                .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {getLabel(m.labels, m.code, m.id)} ({m.code})
                  </option>
                ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Capture scope
            </span>
            <select
              value={scope}
              onChange={(e) =>
                setScope(e.target.value as "per_job" | "per_garment")
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
              />
              Required (gates completion)
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Order
              </span>
              <input
                type="text"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="#"
                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          {formError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-pill border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="rounded-pill bg-ink-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {creating ? "Attaching…" : "Attach"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete confirm ── */}
      <ConfirmDelete
        open={!!deleteTarget}
        title="Detach metric link"
        message={
          deleteTarget
            ? `Detach ${
                deleteTarget.measurement_metric_id &&
                metricById.get(deleteTarget.measurement_metric_id)?.code
                  ? metricById.get(deleteTarget.measurement_metric_id)!.code
                  : "this metric"
              } from this ${deleteTarget.entity_type}?`
            : ""
        }
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
