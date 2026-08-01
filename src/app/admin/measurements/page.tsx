"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchAll,
  getLabel,
  updateTablePriorityOrder,
} from "@/lib/admin-api";
import {
  ConfirmDelete,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  Select,
  TextArea,
  TextInput,
  Thumbnail,
} from "@/app/admin/catalogue/_shared/catalogue-helpers";
import { ConditionBuilderModal } from "./ConditionBuilder";

// ═══════════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════════

interface Metric {
  id: string;
  slug: string | null;
  code: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  unit: string | null;
  priority_order: number | null;
}

interface GarmentMetric {
  id: string;
  garment_id: string | null;
  measurement_metric_id: string | null;
  priority_order: number | null;
  is_required: boolean | null;
  condition_component_id: string | null;
  condition_note: string | null;
}

interface Garment {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
}

interface StyleComponent {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  garment_id: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Language helpers (mirrors catalogue page)
// ═══════════════════════════════════════════════════════════════════════════════

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "bn", label: "Bengali" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "pa", label: "Punjabi" },
];

interface LangRow {
  id: string;
  lang: string;
  value: string;
}

let _langRowCounter = 0;
function newLangRow(lang: string = "", value: string = ""): LangRow {
  _langRowCounter += 1;
  return { id: `lr${_langRowCounter}`, lang, value };
}

function dictToLangRows(dict: Record<string, string> | null): LangRow[] {
  if (!dict) return [];
  return Object.entries(dict).map(([lang, value]) => newLangRow(lang, value));
}

function langRowsToDict(rows: LangRow[]): Record<string, string> | null {
  const dict: Record<string, string> = {};
  for (const row of rows) {
    if (row.lang && row.value.trim()) dict[row.lang] = row.value.trim();
  }
  return Object.keys(dict).length > 0 ? dict : null;
}

function LangRowEditor({
  rows,
  onChange,
  label,
  multiline,
  placeholder,
}: {
  rows: LangRow[];
  onChange: (rows: LangRow[]) => void;
  label: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const usedLangs = new Set(rows.map((r) => r.lang));
  const availableLangs = LANGUAGE_OPTIONS.filter((o) => !usedLangs.has(o.code));
  function updateRow(id: string, patch: Partial<LangRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }
  function addRow() {
    const nextLang = availableLangs[0]?.code ?? "";
    onChange([...rows, newLangRow(nextLang)]);
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="mb-1 block text-[12px] font-medium text-ink-navy">{label}</span>
        <button
          type="button"
          onClick={addRow}
          disabled={availableLangs.length === 0}
          className="tap flex items-center gap-1 rounded-pill border border-hairline-strong px-2 py-0.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add language
        </button>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
            No {label.toLowerCase()} added yet.
          </div>
        )}
        {rows.map((row) => {
          const rowAvailable = [
            ...LANGUAGE_OPTIONS.filter((o) => o.code === row.lang),
            ...availableLangs,
          ];
          return (
            <div key={row.id} className="flex items-start gap-2">
              <select
                value={row.lang}
                onChange={(e) => updateRow(row.id, { lang: e.target.value })}
                className="shrink-0 rounded-card border border-hairline-strong bg-chalk-white px-2 py-2 text-[13px] text-ink outline-none focus:border-ink-navy"
              >
                {rowAvailable.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {multiline ? (
                <textarea
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  placeholder={placeholder}
                  rows={2}
                  className="min-w-0 flex-1 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-navy"
                />
              ) : (
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  placeholder={placeholder}
                  className="min-w-0 flex-1 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-navy"
                />
              )}
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="tap mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-500"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main page
// ═══════════════════════════════════════════════════════════════════════════════

export default function MeasurementsPage() {
  return <MeasurementsPageInner />;
}

function MeasurementsPageInner() {
  const router = useRouter();

  // ─── State ────────────────────────────────────────────────────────────────
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [garmentMetrics, setGarmentMetrics] = useState<GarmentMetric[]>([]);
  const [garments, setGarments] = useState<Garment[]>([]);
  const [components, setComponents] = useState<StyleComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Filters
  const [filterGarmentId, setFilterGarmentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Edit modal
  const [editMetric, setEditMetric] = useState<Metric | null>(null);
  const [editMode, setEditMode] = useState<"create" | "edit">("edit");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Metric | null>(null);

  // Conditions manager modal
  const [showConditionsModal, setShowConditionsModal] = useState(false);

  const triggerReload = useCallback(() => setReloadKey((k) => k + 1), []);

  // ─── Reorder (drag-and-drop) ──────────────────────────────────────────────
  const reorder = useCallback((reorderedItems: Metric[]) => {
    // Optimistic: update local state immediately
    setMetrics((prev) => {
      // Replace only items that appear in reorderedItems (by id), preserving any
      // items that are not currently in the visible/filtered view.
      const reorderedIds = new Set(reorderedItems.map((m) => m.id));
      const others = prev.filter((m) => !reorderedIds.has(m.id));
      const reordered = reorderedItems.map((m, idx) => ({ ...m, priority_order: idx + 1 }));
      const merged = [...others, ...reordered];
      merged.sort((a, b) => {
        const pa = a.priority_order ?? Number.MAX_SAFE_INTEGER;
        const pb = b.priority_order ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return (a.code ?? "").localeCompare(b.code ?? "");
      });
      return merged;
    });

    // Persist to backend (parallel PUTs)
    void Promise.all(
      reorderedItems.map((m, idx) =>
        updateTablePriorityOrder("measurement_metrics", m.id, idx + 1).catch((e) => {
          console.error(`Reorder failed for measurement_metrics/${m.id}:`, e);
        }),
      ),
    );
  }, []);

  // ─── Emit secondary sidebar items — Catalogue sub-tabs ─────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "Catalogue",
              active: false,
              onClick: () => router.push("/admin/catalogue"),
            },
            {
              label: "Measurements",
              active: true,
              onClick: () => router.push("/admin/measurements"),
            },
            {
              label: "Validation Rules",
              active: false,
              onClick: () => router.push("/admin/catalogue/validation-rules"),
            },
          ],
        },
      }),
    );
    return () => {
      window.dispatchEvent(new CustomEvent("admin-sidebar-update", { detail: null }));
    };
  }, [router]);

  // ─── Load all data ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchAll<Metric>("measurement_metrics"),
      fetchAll<GarmentMetric>("garment_measurement_metrics"),
      fetchAll<Garment>("garments"),
      fetchAll<StyleComponent>("garment_style_component"),
    ])
      .then(([m, gm, g, c]) => {
        // Sort by priority_order (nulls/zero last), then by code as secondary key
        m.sort((a, b) => {
          const pa = a.priority_order ?? Number.MAX_SAFE_INTEGER;
          const pb = b.priority_order ?? Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
          return (a.code ?? "").localeCompare(b.code ?? "");
        });
        setMetrics(m);
        setGarmentMetrics(gm);
        setGarments(g);
        setComponents(c);
      })
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  // ─── Build lookup maps ────────────────────────────────────────────────────
  const garmentMap = useMemo(() => {
    const map = new Map<string, Garment>();
    garments.forEach((g) => map.set(g.id, g));
    return map;
  }, [garments]);

  const componentMap = useMemo(() => {
    const map = new Map<string, StyleComponent>();
    components.forEach((c) => map.set(c.id, c));
    return map;
  }, [components]);

  // ─── For each metric, find connected garments + components ────────────────
  const metricConnections = useMemo(() => {
    const connections = new Map<
      string,
      { garments: { garment: Garment; gm: GarmentMetric }[]; components: StyleComponent[] }
    >();

    for (const metric of metrics) {
      connections.set(metric.id, { garments: [], components: [] });
    }

    for (const gm of garmentMetrics) {
      const conn = connections.get(gm.measurement_metric_id ?? "");
      if (!conn) continue;
      const garment = gm.garment_id ? garmentMap.get(gm.garment_id) : null;
      if (garment) {
        conn.garments.push({ garment, gm });
        // Also resolve the condition component
        if (gm.condition_component_id) {
          const comp = componentMap.get(gm.condition_component_id);
          if (comp && !conn.components.find((c) => c.id === comp.id)) {
            conn.components.push(comp);
          }
        }
      }
    }

    return connections;
  }, [metrics, garmentMetrics, garmentMap, componentMap]);

  // ─── Filtered metrics ─────────────────────────────────────────────────────
  const filteredMetrics = useMemo(() => {
    let result = metrics;

    // Filter by garment
    if (filterGarmentId) {
      const metricIdsForGarment = new Set(
        garmentMetrics
          .filter((gm) => gm.garment_id === filterGarmentId)
          .map((gm) => gm.measurement_metric_id)
          .filter(Boolean) as string[],
      );
      result = result.filter((m) => metricIdsForGarment.has(m.id));
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          (m.code ?? "").toLowerCase().includes(q) ||
          (m.labels?.en ?? "").toLowerCase().includes(q) ||
          (m.slug ?? "").toLowerCase().includes(q),
      );
    }

    return result;
  }, [metrics, filterGarmentId, garmentMetrics, search]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-warm-sand">
      {/* ═══ Hero Header ═══════════════════════════════════════════════════ */}
      <MeasureHeader
        count={metrics.length}
        onAdd={() => { setEditMode("create"); setShowCreateModal(true); }}
        onManageConditions={() => setShowConditionsModal(true)}
      />

      {/* ═══ Content area ══════════════════════════════════════════════════ */}
      <div className="mx-auto max-w-7xl px-4 pb-16 md:px-6">
        {/* ─── Filter bar ──────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-hairline bg-warm-sand/90 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Left: Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Garment filter */}
              <FilterDropdown
                label="All Garments"
                value={filterGarmentId}
                options={garments.map((g) => ({
                  value: g.id,
                  label: getLabel(g.labels, g.slug, g.id),
                }))}
                onChange={(v) => setFilterGarmentId(v)}
              />

              {/* Clear filters */}
              {filterGarmentId && (
                <button
                  onClick={() => setFilterGarmentId(null)}
                  className="tap flex items-center gap-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[12px] font-medium text-muted transition hover:text-ink-navy"
                >
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Clear
                </button>
              )}
            </div>

            {/* Right: Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search metrics..."
                className="w-full rounded-pill border border-hairline-strong bg-chalk-white py-2 pl-9 pr-4 text-[13px] outline-none transition focus:border-ink-navy lg:w-72"
              />
            </div>
          </div>

          {/* Result count */}
          <div className="mt-2 text-[11px] font-medium text-muted">
            Showing <span className="text-ink-navy">{filteredMetrics.length}</span> of {metrics.length} metrics
          </div>
        </div>

        {/* ─── Content ────────────────────────────────────────────────────── */}
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={triggerReload} />
        ) : filteredMetrics.length === 0 ? (
          <EmptyState
            message="No metrics match your filters"
            onAdd={metrics.length === 0 ? () => { setEditMode("create"); setShowCreateModal(true); } : undefined}
            addLabel="Add Metric"
          />
        ) : (
          <ReorderableMetricGrid
            items={filteredMetrics}
            disabled={!!filterGarmentId || search.trim().length > 0}
            onReorder={reorder}
            renderItem={(metric) => {
              const conn = metricConnections.get(metric.id);
              return (
                <MetricCard
                  metric={metric}
                  garments={conn?.garments ?? []}
                  components={conn?.components ?? []}
                  garmentMap={garmentMap}
                  componentMap={componentMap}
                  onEdit={() => {
                    setEditMetric(metric);
                    setEditMode("edit");
                  }}
                  onDelete={() => setDeleteTarget(metric)}
                />
              );
            }}
          />
        )}
      </div>

      {/* ═══ Edit / Create modal ════════════════════════════════════════════ */}
      {showCreateModal && (
        <MetricFormModal
          mode="create"
          metric={null}
          garments={garments}
          existingGarmentMetricRows={[]}
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false);
            triggerReload();
          }}
        />
      )}
      {editMetric && editMode === "edit" && (
        <MetricFormModal
          mode="edit"
          metric={editMetric}
          garments={garments}
          existingGarmentMetricRows={garmentMetrics.filter(
            (gm) => gm.measurement_metric_id === editMetric.id,
          )}
          onClose={() => setEditMetric(null)}
          onSaved={() => {
            setEditMetric(null);
            triggerReload();
          }}
        />
      )}

      {/* ═══ Delete confirm ═════════════════════════════════════════════════ */}
      <ConfirmDelete
        open={!!deleteTarget}
        title="Delete Metric"
        message={`Delete "${deleteTarget ? getLabel(deleteTarget.labels, deleteTarget.slug, deleteTarget.id) : ""}"? This will also remove all garment mappings for this metric.`}
        onConfirm={async () => {
          if (!deleteTarget) return;
          // Delete via generic table API
          try {
            const { getAdminToken } = await import("@/lib/admin-api");
            const token = getAdminToken();
            const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
            await fetch(`${API_URL}/admin/tables/measurement_metrics/${deleteTarget.id}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
            setDeleteTarget(null);
            triggerReload();
          } catch {
            // If generic delete doesn't work, still trigger reload
            setDeleteTarget(null);
            triggerReload();
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ═══ Conditions Manager ═════════════════════════════════════════════ */}
      {showConditionsModal && (
        <ConditionBuilderModal onClose={() => setShowConditionsModal(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Filter Dropdown — styled pill select
// ═══════════════════════════════════════════════════════════════════════════════

function FilterDropdown({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className={`tap appearance-none rounded-pill border py-1.5 pl-3 pr-8 text-[12px] font-medium outline-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
          value
            ? "border-ink-navy bg-ink-navy text-chalk-white"
            : "border-hairline-strong bg-chalk-white text-ink-navy"
        }`}
      >
        <option value="">{label}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2"
        viewBox="0 0 12 12"
        fill="none"
        style={{ color: value ? "white" : "currentColor" }}
      >
        <path d="M3 4.5L6 8l3-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Hero Header — tape-measure themed gradient banner
// ═══════════════════════════════════════════════════════════════════════════════

function MeasureHeader({
  count,
  onAdd,
  onManageConditions,
}: {
  count: number;
  onAdd: () => void;
  onManageConditions: () => void;
}) {
  return (
    <div className="relative overflow-hidden border-b border-hairline bg-gradient-to-br from-ink-navy via-[#0a2d5e] to-[#0d3d7a]">
      {/* Decorative tick marks */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
        <div className="flex h-full items-end gap-0">
          {Array.from({ length: 80 }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 bg-white ${i % 5 === 0 ? "h-12" : i % 2 === 0 ? "h-6" : "h-3"}`}
            />
          ))}
        </div>
      </div>

      {/* Tape accent line */}
      <div className="absolute left-0 right-0 top-[40%] h-px bg-gradient-to-r from-transparent via-tape/30 to-transparent" />

      <div className="relative mx-auto flex max-w-7xl items-start justify-between px-4 py-8 md:px-6 md:py-10">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tape/20 backdrop-blur-sm">
              <svg className="h-6 w-6 text-tape" viewBox="0 0 20 20" fill="none">
                <rect x="2.5" y="6" width="15" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5.5 6v2.5M8.5 6v3.5M11.5 6v2.5M14.5 6v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M5.5 14v-2.5M8.5 14v-3.5M11.5 14v-2.5M14.5 14v-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-tape/80">
              Measurement DB
            </span>
          </div>

          <h1 className="mt-3 font-heading text-2xl font-bold text-chalk-white md:text-3xl">
            Measurements
          </h1>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-chalk-white/60">
            {count} body metrics in the catalog — each card shows connected garments and style components.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2">
          {/* Manage Conditions */}
          <button
            onClick={onManageConditions}
            className="tap inline-flex items-center gap-1.5 rounded-pill border border-chalk-white/20 bg-chalk-white/10 px-3.5 py-2 text-[13px] font-medium text-chalk-white backdrop-blur-sm transition hover:bg-chalk-white/20 active:scale-95"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 5.5h9M3.5 8h9M3.5 10.5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M13 9.5l1.5 1.5L13 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Manage Conditions</span>
            <span className="sm:hidden">Conditions</span>
          </button>

          {/* Add Metric */}
          <button
            onClick={onAdd}
            className="tap inline-flex items-center gap-1.5 rounded-pill bg-tape px-4 py-2 text-[13px] font-semibold text-ink-navy shadow-lg transition hover:brightness-110 active:scale-95"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Add Metric</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ReorderableMetricGrid — drag-and-drop wrapper for MetricCard
// ═══════════════════════════════════════════════════════════════════════════════

function ReorderableMetricGrid({
  items,
  disabled,
  onReorder,
  renderItem,
}: {
  items: Metric[];
  disabled: boolean;
  onReorder: (reordered: Metric[]) => void;
  renderItem: (item: Metric) => React.ReactNode;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (index: number) => (e: React.DragEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (index: number) => (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverIndex(index);
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (index: number) => (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      if (dragIndex === null || dragIndex === index) return;
      const reordered = [...items];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(index, 0, moved);
      onReorder(reordered);
    },
    [disabled, dragIndex, items, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item, index) => {
        const isDragging = dragIndex === index;
        const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;
        return (
          <div
            key={item.id}
            draggable={!disabled}
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDrop={handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={`group relative transition ${
              isDragging ? "opacity-40" : ""
            } ${
              isOver ? "ring-2 ring-tape ring-offset-2 rounded-card" : ""
            }`}
          >
            {!disabled && (
              <div className="absolute left-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 cursor-grab items-center justify-center rounded-lg bg-chalk-white/90 text-ink-navy shadow-sm backdrop-blur-sm opacity-0 transition group-hover:opacity-100 active:cursor-grabbing">
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="5" cy="4" r="1.2" fill="currentColor" />
                  <circle cx="5" cy="8" r="1.2" fill="currentColor" />
                  <circle cx="5" cy="12" r="1.2" fill="currentColor" />
                  <circle cx="11" cy="4" r="1.2" fill="currentColor" />
                  <circle cx="11" cy="8" r="1.2" fill="currentColor" />
                  <circle cx="11" cy="12" r="1.2" fill="currentColor" />
                </svg>
              </div>
            )}
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Metric Card — shows metric info + connected garments/components as tags
// ═══════════════════════════════════════════════════════════════════════════════

function MetricCard({
  metric,
  garments,
  components,
  garmentMap,
  componentMap,
  onEdit,
  onDelete,
}: {
  metric: Metric;
  garments: { garment: Garment; gm: GarmentMetric }[];
  components: StyleComponent[];
  garmentMap: Map<string, Garment>;
  componentMap: Map<string, StyleComponent>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = getLabel(metric.labels, metric.slug, metric.id);
  const desc = metric.descriptions?.en ?? null;

  // Unique garments
  const uniqueGarments = useMemo(() => {
    const seen = new Set<string>();
    return garments.filter((g) => {
      if (seen.has(g.garment.id)) return false;
      seen.add(g.garment.id);
      return true;
    });
  }, [garments]);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card transition hover:border-hairline-strong hover:shadow-lg">
      {/* ─── Image ────────────────────────────────────────────────────────── */}
      <div className="relative aspect-[4/3] overflow-hidden bg-mist-navy">
        <Thumbnail urls={metric.asset_urls} className="h-full w-full object-cover" />

        {/* Unit badge */}
        <div className="absolute right-2 top-2">
          <span className="inline-flex items-center gap-1 rounded-pill bg-chalk-white/90 px-2 py-0.5 font-mono text-[10px] font-medium text-ink-navy backdrop-blur-sm">
            {metric.unit ?? "—"}
          </span>
        </div>

        {/* Hover actions */}
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100" style={{ marginRight: "32px" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="tap flex h-7 w-7 items-center justify-center rounded-lg bg-chalk-white/90 text-ink-navy shadow-sm backdrop-blur-sm transition hover:bg-chalk-white"
            title="Edit"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="tap flex h-7 w-7 items-center justify-center rounded-lg bg-chalk-white/90 text-red-600 shadow-sm backdrop-blur-sm transition hover:bg-red-50"
            title="Delete"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 4.5h9M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M5 4.5l.5 8a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Content ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-heading text-[14px] font-semibold leading-tight text-ink-navy">{label}</h3>
        <p className="mt-0.5 font-mono text-[11px] text-muted">{metric.code}</p>

        {desc && (
          <p className={`mt-2 text-[12px] leading-relaxed text-muted ${expanded ? "" : "line-clamp-2"}`}>
            {desc}
          </p>
        )}
        {desc && desc.length > 80 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-[11px] font-medium text-tape hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}

        {/* ─── Connected Garments ────────────────────────────────────────── */}
        {uniqueGarments.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M2 4h8v6H2zM2 4l4-3 4 3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              Garments
            </div>
            <div className="flex flex-wrap gap-1">
              {uniqueGarments.map(({ garment, gm }) => (
                <span
                  key={garment.id}
                  className="inline-flex items-center gap-1 rounded-pill border border-ink-navy/15 bg-ink-navy/5 px-2 py-0.5 text-[10px] font-medium text-ink-navy"
                  title={`Priority: ${gm.priority_order ?? "—"} • ${gm.is_required ? "Required" : "Optional"}${gm.condition_note ? " • " + gm.condition_note : ""}`}
                >
                  {getLabel(garment.labels, garment.slug, garment.id)}
                  {gm.is_required && (
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Required" />
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ─── Connected Style Components ────────────────────────────────── */}
        {components.length > 0 && (
          <div className="mt-2">
            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M4 2L2 6l2 4M8 2l2 4-2 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Condition Components
            </div>
            <div className="flex flex-wrap gap-1">
              {components.map((comp) => (
                <span
                  key={comp.id}
                  className="inline-flex items-center gap-1 rounded-pill border border-tape/20 bg-tape/5 px-2 py-0.5 text-[10px] font-medium text-tape"
                  title={comp.slug ?? ""}
                >
                  {getLabel(comp.labels, comp.slug, comp.id)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ─── Language pills ────────────────────────────────────────────── */}
        {metric.labels && Object.keys(metric.labels).filter((l) => l !== "en").length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1 border-t border-hairline pt-2">
            {Object.entries(metric.labels)
              .filter(([lang]) => lang !== "en")
              .map(([lang, val]) => (
                <span
                  key={lang}
                  className="inline-flex items-center gap-1 rounded bg-mist-navy px-1.5 py-0.5 text-[9px] text-ink-navy"
                >
                  <span className="font-mono font-bold uppercase">{lang}</span>
                  <span className="max-w-[80px] truncate">{val}</span>
                </span>
              ))}
          </div>
        )}

        {/* Spacer + edit on hover at bottom */}
        <div className="flex-1" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Metric Form Modal — create or edit a metric (with garment attachment)
// ═══════════════════════════════════════════════════════════════════════════════

interface GarmentAttachment {
  garmentId: string;
  priorityOrder: number | null;
  isRequired: boolean;
  conditionNote: string;
}

function MetricFormModal({
  mode,
  metric,
  garments,
  existingGarmentMetricRows,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  metric: Metric | null;
  garments: Garment[];
  existingGarmentMetricRows: GarmentMetric[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const d = metric;
  const [code, setCode] = useState(d?.code ?? "");
  const [slug, setSlug] = useState(d?.slug ?? "");
  const [unit, setUnit] = useState(d?.unit ?? "in");
  const [urlsText, setUrlsText] = useState(
    Array.isArray(d?.asset_urls) ? d!.asset_urls.join("\n") : "",
  );
  const [labelRows, setLabelRows] = useState<LangRow[]>(() => {
    const rows = dictToLangRows(d?.labels ?? null);
    if (!rows.some((r) => r.lang === "en")) rows.unshift(newLangRow("en"));
    return rows;
  });
  const [descRows, setDescRows] = useState<LangRow[]>(() =>
    dictToLangRows(d?.descriptions ?? null),
  );

  // Garment attachments — seeded from existing rows in edit mode
  const [attachments, setAttachments] = useState<Record<string, GarmentAttachment>>(() => {
    const init: Record<string, GarmentAttachment> = {};
    for (const gm of existingGarmentMetricRows) {
      if (gm.garment_id) {
        init[gm.garment_id] = {
          garmentId: gm.garment_id,
          priorityOrder: gm.priority_order,
          isRequired: gm.is_required ?? false,
          conditionNote: gm.condition_note ?? "",
        };
      }
    }
    return init;
  });

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const labels = langRowsToDict(labelRows);
  const descriptions = langRowsToDict(descRows);

  const attachedIds = Object.keys(attachments);

  function toggleGarment(garmentId: string) {
    setAttachments((prev) => {
      const next = { ...prev };
      if (next[garmentId]) {
        delete next[garmentId];
      } else {
        next[garmentId] = {
          garmentId,
          priorityOrder: null,
          isRequired: false,
          conditionNote: "",
        };
      }
      return next;
    });
  }

  function updateAttachment(garmentId: string, patch: Partial<GarmentAttachment>) {
    setAttachments((prev) => ({
      ...prev,
      [garmentId]: { ...prev[garmentId], ...patch },
    }));
  }

  function parseUrls(text: string): string[] | null {
    const trimmed = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return trimmed.length > 0 ? trimmed : null;
  }

  async function handleSubmit() {
    if (!labels?.en?.trim()) {
      setFormError("English label is required");
      return;
    }
    if (!code.trim()) {
      setFormError("Code is required");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const { getAdminToken } = await import("@/lib/admin-api");
      const token = getAdminToken();
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

      const body: Record<string, unknown> = {
        code: code.trim(),
        slug: slug.trim() || code.trim().toLowerCase().replace(/\s+/g, "_"),
        labels,
        descriptions,
        asset_urls: parseUrls(urlsText),
        unit: unit.trim() || null,
      };

      const url =
        mode === "create"
          ? `${API_URL}/admin/tables/measurement_metrics`
          : `${API_URL}/admin/tables/measurement_metrics/${d!.id}`;

      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: { message?: string } })?.error?.message ?? `Failed (${res.status})`,
        );
      }

      // After metric is saved, sync garment attachments.
      // For "create" mode, we need the new metric ID from the response.
      const createdBody =
        mode === "create" ? await res.json().catch(() => ({})) : null;

      // Determine the saved metric ID for syncing attachments.
      const newMetricId: string | null =
        mode === "create"
          ? (createdBody as { id?: string | null })?.id ?? null
          : (d?.id ?? null);

      // Inline attachment sync — diff desired vs existing, then create/delete
      if (newMetricId) {
        const existingByGarment = new Map<string, GarmentMetric>();
        for (const gm of existingGarmentMetricRows) {
          if (gm.garment_id) existingByGarment.set(gm.garment_id, gm);
        }

        const desiredGarmentIds = new Set(Object.keys(attachments));
        const currentGarmentIds = new Set(existingByGarment.keys());

        const toCreate: string[] = [];
        for (const gid of desiredGarmentIds) {
          if (!currentGarmentIds.has(gid)) toCreate.push(gid);
        }

        const toDelete: string[] = [];
        for (const gid of currentGarmentIds) {
          if (!desiredGarmentIds.has(gid)) {
            const gm = existingByGarment.get(gid);
            if (gm) toDelete.push(gm.id);
          }
        }

        const syncHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };

        const syncPromises: Promise<Response>[] = [];

        for (const gid of toCreate) {
          const att = attachments[gid];
          syncPromises.push(
            fetch(`${API_URL}/admin/tables/garment_measurement_metrics`, {
              method: "POST",
              headers: syncHeaders,
              body: JSON.stringify({
                garment_id: gid,
                measurement_metric_id: newMetricId,
                priority_order: att.priorityOrder,
                is_required: att.isRequired,
                condition_note: att.conditionNote.trim() || null,
              }),
            }),
          );
        }

        for (const rowId of toDelete) {
          syncPromises.push(
            fetch(`${API_URL}/admin/tables/garment_measurement_metrics/${rowId}`, {
              method: "DELETE",
              headers: syncHeaders,
            }),
          );
        }

        if (syncPromises.length > 0) {
          await Promise.all(syncPromises);
        }
      }

      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={true}
      title={mode === "create" ? "New Measurement Metric" : `Edit: ${getLabel(d?.labels, d?.slug ?? null, d?.id ?? "")}`}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {/* Code */}
        <Field label="Code *" hint="Stable machine key, e.g. bust_full_round">
          <TextInput
            value={code}
            onChange={setCode}
            placeholder="armhole_round_left"
          />
        </Field>

        {/* Slug */}
        <Field label="Slug" hint="URL-safe identifier (defaults to code if empty)">
          <TextInput
            value={slug}
            onChange={setSlug}
            placeholder="auto-generated from code"
          />
        </Field>

        {/* Unit */}
        <Field label="Unit">
          <Select
            value={unit}
            onChange={setUnit}
            options={[
              { value: "in", label: "Inches (in)" },
              { value: "cm", label: "Centimeters (cm)" },
              { value: "mm", label: "Millimeters (mm)" },
            ]}
          />
        </Field>

        {/* Labels */}
        <LangRowEditor
          rows={labelRows}
          onChange={setLabelRows}
          label="Labels *"
          placeholder="e.g. Bust (Full Round)"
        />

        {/* Descriptions */}
        <LangRowEditor
          rows={descRows}
          onChange={setDescRows}
          label="Descriptions"
          multiline
          placeholder="How to measure..."
        />

        {/* Asset URLs */}
        <Field label="Asset URLs" hint="Measurement card images — one URL per line">
          <TextArea
            value={urlsText}
            onChange={setUrlsText}
            placeholder="https://...\nhttps://..."
            rows={3}
          />
        </Field>

        {/* ─── Garment Attachment ─────────────────────────────────────────── */}
        <div className="rounded-card border border-hairline bg-mist-navy/30 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <svg className="h-4 w-4 text-ink-navy" viewBox="0 0 16 16" fill="none">
              <path d="M2 5h12v8H2zM2 5l3-3h6l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <span className="text-[12px] font-semibold text-ink-navy">Attach to Garments</span>
            <span className="ml-auto text-[10px] font-medium text-muted">
              {attachedIds.length} connected
            </span>
          </div>

          {/* Garment pills — toggle selection */}
          <div className="flex flex-wrap gap-1.5">
            {garments.length === 0 && (
              <span className="text-[11px] text-muted">No garments available.</span>
            )}
            {garments.map((g) => {
              const attached = !!attachments[g.id];
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGarment(g.id)}
                  className={`tap inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-medium transition ${
                    attached
                      ? "border-ink-navy bg-ink-navy text-chalk-white"
                      : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
                  }`}
                >
                  {attached && (
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.5L5 9l4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {getLabel(g.labels, g.slug, g.id)}
                </button>
              );
            })}
          </div>

          {/* Per-garment settings for attached garments */}
          {attachedIds.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-hairline pt-2">
              {attachedIds.map((gid) => {
                const att = attachments[gid];
                const g = garments.find((x) => x.id === gid);
                if (!g || !att) return null;
                return (
                  <div key={gid} className="rounded-lg border border-hairline bg-chalk-white p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-ink-navy">
                        {getLabel(g.labels, g.slug, g.id)}
                      </span>
                      <label className="flex cursor-pointer items-center gap-1 text-[11px] text-ink-navy">
                        <input
                          type="checkbox"
                          checked={att.isRequired}
                          onChange={(e) => updateAttachment(gid, { isRequired: e.target.checked })}
                          className="h-3.5 w-3.5 accent-ink-navy"
                        />
                        Required
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">Priority</label>
                        <input
                          type="number"
                          value={att.priorityOrder ?? ""}
                          onChange={(e) =>
                            updateAttachment(gid, {
                              priorityOrder: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          placeholder="—"
                          className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-ink-navy"
                        />
                      </div>
                      <div className="flex-[2]">
                        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">Condition note</label>
                        <input
                          type="text"
                          value={att.conditionNote}
                          onChange={(e) => updateAttachment(gid, { conditionNote: e.target.value })}
                          placeholder="e.g. Only if sleeves are fitted"
                          className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-ink-navy"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Error */}
        {formError && (
          <div className="rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
            {formError}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-hairline pt-4">
          <button
            onClick={onClose}
            className="tap rounded-card border border-hairline-strong px-4 py-2 text-[13px] text-ink hover:bg-mist-navy"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="tap inline-flex items-center gap-2 rounded-card bg-ink-navy px-4 py-2 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95 disabled:opacity-50"
          >
            {saving && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
                <path d="M10 2a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {mode === "create" ? "Create Metric" : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

