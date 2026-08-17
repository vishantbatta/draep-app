"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  fetchAll,
  getLabel,
  listMeasurementLinks,
  updateTablePriorityOrder,
  type EntityMeasurementLink,
} from "@/lib/admin-api";
import {
  loadEntityHierarchy,
  type EntityHierarchy,
} from "@/lib/entity-hierarchy";
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
import { MetricEntityLinksSection } from "./MetricEntityLinksSection";
import { EntityLinksPanel } from "./EntityLinksPanel";

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

interface Garment {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
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
  return (
    <Suspense fallback={<LoadingState />}>
      <MeasurementsPageInner />
    </Suspense>
  );
}

function MeasurementsPageInner() {
  const router = useRouter();

  // ─── State ────────────────────────────────────────────────────────────────
  const [adminView, setAdminView] = useState<"catalog" | "links">("catalog");
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [garments, setGarments] = useState<Garment[]>([]);
  const [entityLinks, setEntityLinks] = useState<EntityMeasurementLink[]>([]);
  const [hierarchy, setHierarchy] = useState<EntityHierarchy | null>(null);
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

  // ─── Emit secondary sidebar items — Configure sub-tabs ─────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "Slot Scheduling",
              active: false,
              onClick: () => router.push("/admin/actions/slot-scheduling"),
            },
            {
              label: "URLs",
              active: false,
              onClick: () => router.push("/admin/actions/urls"),
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
            {
              label: "SOP Video Generator",
              active: false,
              onClick: () => router.push("/admin/actions/sop-video"),
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
      fetchAll<Garment>("garments"),
      listMeasurementLinks(),
      loadEntityHierarchy(),
    ])
      .then(([m, g, links, h]) => {
        // Sort by priority_order (nulls/zero last), then by code as secondary key
        m.sort((a, b) => {
          const pa = a.priority_order ?? Number.MAX_SAFE_INTEGER;
          const pb = b.priority_order ?? Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
          return (a.code ?? "").localeCompare(b.code ?? "");
        });
        setMetrics(m);
        setGarments(g);
        setEntityLinks(links);
        setHierarchy(h);
      })
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  // ─── Deep-link: ?metric=<id> auto-opens that metric's edit modal ──────────
  // Used by the entity pages' "Measurements to take" section (Edit buttons).
  const searchParams = useSearchParams();
  useEffect(() => {
    if (loading) return;
    const id = searchParams.get("metric");
    if (!id) return;
    const m = metrics.find((x) => x.id === id);
    if (!m) return;
    setEditMetric(m);
    setEditMode("edit");
    // Clear the param so closing the modal doesn't re-open it on refresh.
    router.replace("/admin/measurements", { scroll: false });
  }, [searchParams, metrics, loading, router]);

  // ─── Build lookup maps ────────────────────────────────────────────────────
  const garmentMap = useMemo(() => {
    const map = new Map<string, Garment>();
    garments.forEach((g) => map.set(g.id, g));
    return map;
  }, [garments]);

  // ─── Entity links per metric (drives chips + garment filter) ──────────────
  const metricLinks = useMemo(() => {
    const byMetric = new Map<string, EntityMeasurementLink[]>();
    metrics.forEach((m) => byMetric.set(m.id, []));
    for (const link of entityLinks) {
      const arr = byMetric.get(link.measurement_metric_id ?? "");
      if (arr) arr.push(link);
    }
    return byMetric;
  }, [metrics, entityLinks]);

  // ─── Filtered metrics ─────────────────────────────────────────────────────
  const filteredMetrics = useMemo(() => {
    let result = metrics;

    // Filter by garment — a metric matches if any of its entity links
    // resolves (through the catalogue hierarchy) to that garment.
    if (filterGarmentId) {
      result = result.filter((m) =>
        (metricLinks.get(m.id) ?? []).some(
          (l) =>
            hierarchy?.optionFor(l.entity_type, l.entity_id)?.garmentId ===
            filterGarmentId,
        ),
      );
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
  }, [metrics, filterGarmentId, metricLinks, hierarchy, search]);

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
        {/* ─── View switcher: catalog vs entity links ─────────────────────── */}
        <div className="mb-4 flex items-center gap-2">
          {(["catalog", "links"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setAdminView(v)}
              className={`tap rounded-pill px-4 py-2 text-[13px] font-semibold transition ${
                adminView === v
                  ? "bg-ink-navy text-chalk-white shadow-card"
                  : "border border-hairline-strong bg-chalk-white text-muted hover:text-ink-navy"
              }`}
            >
              {v === "catalog" ? "Metric catalog" : "Entity links"}
            </button>
          ))}
        </div>

        {adminView === "links" ? (
          <EntityLinksPanel />
        ) : (
          <>
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
              return (
                <MetricCard
                  metric={metric}
                  links={metricLinks.get(metric.id) ?? []}
                  hierarchy={hierarchy}
                  garmentMap={garmentMap}
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
        </>
        )}
      </div>

      {/* ═══ Edit / Create modal ════════════════════════════════════════════ */}
      {showCreateModal && (
        <MetricFormModal
          mode="create"
          metric={null}
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
          message={`Delete "${deleteTarget ? getLabel(deleteTarget.labels, deleteTarget.slug, deleteTarget.id) : ""}"? This will also remove all entity attachments for this metric.`}
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
            {count} body metrics in the catalog — each card shows the garments and entities it is attached to.
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
//  Metric Card — shows metric info + entity-attachment tags (garments/entities)
// ═══════════════════════════════════════════════════════════════════════════════

function MetricCard({
  metric,
  links,
  hierarchy,
  garmentMap,
  onEdit,
  onDelete,
}: {
  metric: Metric;
  links: EntityMeasurementLink[];
  hierarchy: EntityHierarchy | null;
  garmentMap: Map<string, Garment>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = getLabel(metric.labels, metric.slug, metric.id);
  const desc = metric.descriptions?.en ?? null;

  // Resolve each link to its hierarchy option once.
  const resolved = useMemo(
    () =>
      links
        .map((l) => ({ link: l, option: hierarchy?.optionFor(l.entity_type, l.entity_id) ?? null }))
        .filter((r) => r.option !== null),
    [links, hierarchy],
  );

  // Garments the metric reaches, through any entity level.
  const uniqueGarments = useMemo(() => {
    const byId = new Map<string, { garment: Garment; required: boolean }>();
    for (const { link, option } of resolved) {
      const garment = option!.garmentId ? garmentMap.get(option!.garmentId) : null;
      if (!garment) continue;
      const prev = byId.get(garment.id);
      byId.set(garment.id, {
        garment,
        required: (prev?.required ?? false) || !!link.is_required,
      });
    }
    return [...byId.values()];
  }, [resolved, garmentMap]);

  // Non-garment attachments (variations, add-ons, …) — the card's entity chips.
  const entityChips = useMemo(
    () => resolved.filter((r) => r.option!.type !== "garment"),
    [resolved],
  );

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

        {/* ─── Connected Garments (derived from entity links) ──────────────── */}
        {uniqueGarments.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M2 4h8v6H2zM2 4l4-3 4 3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              Garments
            </div>
            <div className="flex flex-wrap gap-1">
              {uniqueGarments.map(({ garment, required }) => (
                <span
                  key={garment.id}
                  className="inline-flex items-center gap-1 rounded-pill border border-ink-navy/15 bg-ink-navy/5 px-2 py-0.5 text-[10px] font-medium text-ink-navy"
                  title={required ? "At least one required link" : "All links optional"}
                >
                  {getLabel(garment.labels, garment.slug, garment.id)}
                  {required && (
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Required" />
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ─── Entity attachments (variations / add-ons / …) ───────────────── */}
        {entityChips.length > 0 && (
          <div className="mt-2">
            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M4 2L2 6l2 4M8 2l2 4-2 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Attached Entities
            </div>
            <div className="flex flex-wrap gap-1">
              {entityChips.slice(0, 4).map(({ link, option }) => (
                <span
                  key={link.id}
                  className="inline-flex items-center gap-1 rounded-pill border border-tape/20 bg-tape/5 px-2 py-0.5 text-[10px] font-medium text-tape"
                  title={`${option!.label} • ${link.capture_scope === "per_job" ? "per job" : "per garment"}${link.is_required ? " • Required" : ""}`}
                >
                  {option!.shortLabel}
                </span>
              ))}
              {entityChips.length > 4 && (
                <span className="inline-flex items-center rounded-pill border border-tape/20 bg-tape/5 px-2 py-0.5 text-[10px] font-medium text-tape">
                  +{entityChips.length - 4}
                </span>
              )}
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

function MetricFormModal({
  mode,
  metric,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  metric: Metric | null;
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

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const labels = langRowsToDict(labelRows);
  const descriptions = langRowsToDict(descRows);

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

        {/* ─── Entity attachments (drives the captain checklist) ──────────── */}
        {mode === "edit" && d?.id && <MetricEntityLinksSection metricId={d.id} />}

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

