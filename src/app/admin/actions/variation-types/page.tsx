"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createVariationType,
  deleteVariationType,
  fetchTableData,
  updateVariationType,
  type AdminTableData,
  type SortDirection,
  type SortState,
  type VariationType,
  type VariationTypeCreateInput,
  type VariationTypeUpdateInput,
} from "@/lib/admin-api";
import {
  SmartCell,
  SmartMobileCard,
  buildRelationMap,
  type RelationConfig,
  type RelationMap,
} from "../_shared/table-renderers";

const PER_PAGE = 20;

// ─── Sub-tabs for Actions (shared) ───────────────────────────────────────────

const ACTION_TABS = [
  { key: "garments", label: "Garments", href: "/admin/actions/garments" },
  { key: "style-components", label: "Style Components", href: "/admin/actions/style-components" },
  { key: "variations", label: "Variations", href: "/admin/actions/variations" },
  { key: "variation-types", label: "Variation Types", href: "/admin/actions/variation-types" },
  { key: "addons", label: "Add-ons", href: "/admin/actions/addons" },
  { key: "addon-variations", label: "Add-on Variations", href: "/admin/actions/addon-variations" },
] as const;

type ActionTabKey = (typeof ACTION_TABS)[number]["key"];

export default function VariationTypesActionPage() {
  const router = useRouter();
  const [activeActionTab] = useState<ActionTabKey>("variation-types");

  // ─── Data state ──────────────────────────────────────────────────────────
  const [data, setData] = useState<AdminTableData | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ column: null, direction: "desc" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Form state ──────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);

  // ─── Variations for dropdown + relation map ──────────────────────────────
  const [variations, setVariations] = useState<{ id: string; label: string }[]>([]);
  const [variationMap, setVariationMap] = useState<RelationMap>({});

  useEffect(() => {
    fetchTableData("garment_style_component_variations", 1, 100)
      .then((d) => {
        setVariations(
          d.rows.map((r) => {
            const labels = r.labels as Record<string, string> | null;
            const slug = String(r.slug ?? r.id);
            return {
              id: String(r.id),
              label: labels?.en ?? slug,
            };
          }),
        );
        setVariationMap(buildRelationMap(d.rows));
      })
      .catch(() => {});
  }, []);

  const relations: RelationConfig[] = [
    { column: "variation_id", entityLabel: "Variation", map: variationMap },
  ];

  // ─── Push action sub-tabs to sidebar ─────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: ACTION_TABS.map((t) => ({
            label: t.label,
            active: activeActionTab === t.key,
            onClick: () => router.push(t.href),
          })),
        },
      }),
    );
  }, [activeActionTab, router]);

  // ─── Load data ───────────────────────────────────────────────────────────
  const loadRef = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const myLoadId = ++loadRef.current;
    setLoading(true);
    setError(null);

    fetchTableData("garment_style_component_variation_types", page, PER_PAGE, sort)
      .then((d) => {
        if (loadRef.current === myLoadId) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (loadRef.current === myLoadId) {
          setError(err instanceof Error ? err.message : "Failed to load variation types");
          setLoading(false);
        }
      });
  }, [page, sort, reloadKey]);

  // ─── Keyboard pagination ─────────────────────────────────────────────────
  const totalPages = data?.total_pages ?? 1;
  const goNext = useCallback(() => setPage((p) => Math.min(p + 1, totalPages)), [totalPages]);
  const goPrev = useCallback(() => setPage((p) => Math.max(p - 1, 1)), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  function handleSort(col: string) {
    setPage(1);
    setSort((prev) => {
      if (prev.column === col) {
        const nextDir: SortDirection = prev.direction === "asc" ? "desc" : "asc";
        return { column: col, direction: nextDir };
      }
      return { column: col, direction: "asc" };
    });
  }

  function handleCreated() {
    setShowForm(false);
    setPage(1);
    setReloadKey((k) => k + 1);
  }

  function handleUpdated() {
    setEditingRow(null);
    setReloadKey((k) => k + 1);
  }

  function handleDelete(row: Record<string, unknown>) {
    const vtId = String(row.id ?? "");
    const slug = String(row.slug ?? vtId);
    if (!confirm(`Delete variation type "${slug}"? This cannot be undone.`)) return;
    deleteVariationType(vtId)
      .then(() => {
        if (editingRow?.id === row.id) setEditingRow(null);
        setReloadKey((k) => k + 1);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to delete variation type");
      });
  }

  function rowToVariationType(row: Record<string, unknown>): VariationType {
    return {
      id: String(row.id ?? ""),
      slug: (row.slug as string) ?? null,
      variation_id: (row.variation_id as string) ?? null,
      priority_order: (row.priority_order as number) ?? null,
      labels: (row.labels as Record<string, string>) ?? null,
      descriptions: (row.descriptions as Record<string, string>) ?? null,
      asset_urls: (row.asset_urls as string[]) ?? null,
      ideal_for: (row.ideal_for as string[]) ?? null,
      not_ideal_for: (row.not_ideal_for as string[]) ?? null,
      price: (row.price as number) ?? null,
    };
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-h3 font-semibold text-ink-navy md:text-h2">
            Variation Types
          </h1>
          {data && (
            <span className="shrink-0 rounded-pill bg-mist-navy px-2.5 py-0.5 font-mono text-caption text-ink-navy">
              {data.total}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className={`tap flex items-center gap-1.5 rounded-pill px-4 py-2 text-caption font-medium transition ${
            showForm
              ? "border border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
              : "bg-ink-navy text-chalk-white hover:bg-ink-navy/90"
          }`}
        >
          {showForm ? (
            <>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Cancel
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add Variation Type
            </>
          )}
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <VariationTypeForm
          variations={variations}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Edit Form */}
      {editingRow && (
        <VariationTypeForm
          variations={variations}
          existing={rowToVariationType(editingRow)}
          onUpdated={handleUpdated}
          onCancel={() => setEditingRow(null)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-card border border-hairline bg-chalk-white shadow-card md:block">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <span className="text-caption text-muted">Loading…</span>
          </div>
        ) : data && data.rows.length > 0 ? (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline bg-mist-navy">
                {data.columns.map((col) => (
                  <SortableTh key={col} column={col} sort={sort} onSort={handleSort} />
                ))}
                <th className="sticky right-0 z-10 whitespace-nowrap border-l border-hairline bg-mist-navy px-3 py-2.5 font-mono text-eyebrow text-ink-navy shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, idx) => {
                const isEditing = editingRow?.id === row.id;
                return (
                  <tr key={idx} className="border-b border-hairline transition last:border-b-0 hover:bg-warm-sand">
                    {data.columns.map((col) => (
                      <td key={col} className="whitespace-nowrap px-3 py-2 text-data text-ink">
                        <SmartCell column={col} value={row[col]} relations={relations} />
                      </td>
                    ))}
                    <td className="sticky right-0 z-10 whitespace-nowrap border-l border-hairline bg-chalk-white px-3 py-2 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => isEditing ? setEditingRow(null) : setEditingRow(row)}
                          className={`tap flex items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] font-medium transition ${
                            isEditing
                              ? "border border-hairline-strong text-muted hover:bg-mist-navy"
                              : "border border-hairline-strong text-ink-navy hover:bg-mist-navy"
                          }`}
                        >
                          {isEditing ? (
                            <>
                              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                              Close
                            </>
                          ) : (
                            <>
                              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                                <path d="M8.5 1.5l2 2L4 10H2v-2l6.5-6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                              </svg>
                              Edit
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          className="tap flex items-center gap-1 rounded-pill border border-hairline-strong px-2.5 py-1 text-[12px] font-medium text-error-text transition hover:bg-error-bg"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                            <path d="M3 3.5h6M5 3.5V2.5h2v1M4 3.5L4.5 10h3L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="flex h-48 items-center justify-center">
            <span className="text-caption text-muted">No variation types yet. Click &quot;Add Variation Type&quot; to create one.</span>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
            <span className="text-caption text-muted">Loading…</span>
          </div>
        ) : data && data.rows.length > 0 ? (
          data.rows.map((row, idx) => {
            const isEditing = editingRow?.id === row.id;
            return (
              <div key={idx}>
                <SmartMobileCard row={row} columns={data.columns} relations={relations} />
                <div className="mt-1 flex justify-end gap-1.5">
                  <button
                    onClick={() => isEditing ? setEditingRow(null) : setEditingRow(row)}
                    className={`tap flex items-center gap-1 rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                      isEditing
                        ? "border border-hairline-strong text-muted"
                        : "border border-hairline-strong text-ink-navy"
                    }`}
                  >
                    {isEditing ? "Close" : "Edit"}
                  </button>
                  <button
                    onClick={() => handleDelete(row)}
                    className="tap flex items-center gap-1 rounded-pill border border-hairline-strong px-3 py-1 text-[12px] font-medium text-error-text transition hover:bg-error-bg"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
            <span className="text-caption text-muted">No variation types yet</span>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              disabled={page <= 1}
              className="tap flex items-center gap-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden>←</span> Prev
            </button>
            <button
              onClick={goNext}
              disabled={page >= totalPages}
              className="tap flex items-center gap-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next <span aria-hidden>→</span>
            </button>
          </div>
          <span className="font-mono text-caption text-muted">
            {data.page} / {data.total_pages}
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Language multi-row editor
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
        <label className="font-mono text-eyebrow text-ink-navy">{label}</label>
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
          const langOpt = LANGUAGE_OPTIONS.find((o) => o.code === row.lang);
          const rowAvailable = [
            ...LANGUAGE_OPTIONS.filter((o) => o.code === row.lang),
            ...availableLangs,
          ];
          return (
            <div key={row.id} className="flex items-start gap-2">
              <select
                value={row.lang}
                onChange={(e) => updateRow(row.id, { lang: e.target.value })}
                className="mt-0.5 w-28 shrink-0 rounded-pill border border-hairline-strong bg-chalk-white px-2 py-2 text-[13px] text-ink-navy outline-none focus:border-accent-text"
              >
                {!langOpt && <option value="">—</option>}
                {rowAvailable.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>

              {multiline ? (
                <textarea
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  placeholder={placeholder}
                  rows={2}
                  className="min-w-0 flex-1 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text"
                />
              ) : (
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  placeholder={placeholder}
                  className="min-w-0 flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text"
                />
              )}

              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="tap mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-muted transition hover:bg-error-bg hover:text-error-text"
                aria-label="Remove"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
//  Variation Type Form (Add + Edit)
// ═══════════════════════════════════════════════════════════════════════════════

function autoSlug(enLabel: string): string {
  const name = enLabel
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const shortUuid = crypto.randomUUID().split("-")[0];
  return `${name}_random_${shortUuid}`;
}

function VariationTypeForm({
  variations,
  existing,
  onCreated,
  onUpdated,
  onCancel,
}: {
  variations: { id: string; label: string }[];
  existing?: VariationType;
  onCreated?: () => void;
  onUpdated?: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!existing;

  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [slugManual, setSlugManual] = useState(isEdit);
  const [variationId, setVariationId] = useState(existing?.variation_id ?? "");
  const [priorityOrder, setPriorityOrder] = useState(
    existing?.priority_order != null ? String(existing.priority_order) : "",
  );
  const [price, setPrice] = useState(
    existing?.price != null ? String(existing.price) : "",
  );
  const [labelRows, setLabelRows] = useState<LangRow[]>(() => {
    const rows = dictToLangRows(existing?.labels ?? null);
    if (!rows.some((r) => r.lang === "en")) rows.unshift(newLangRow("en"));
    return rows;
  });
  const [descRows, setDescRows] = useState<LangRow[]>(() =>
    dictToLangRows(existing?.descriptions ?? null),
  );
  const [assetUrls, setAssetUrls] = useState(
    Array.isArray(existing?.asset_urls) ? existing!.asset_urls.join("\n") : "",
  );
  const [idealFor, setIdealFor] = useState(
    Array.isArray(existing?.ideal_for) ? existing!.ideal_for.join(", ") : "",
  );
  const [notIdealFor, setNotIdealFor] = useState(
    Array.isArray(existing?.not_ideal_for) ? existing!.not_ideal_for.join(", ") : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const enLabel = labelRows.find((r) => r.lang === "en")?.value ?? "";

  function handleEnLabelChange(rows: LangRow[]) {
    setLabelRows(rows);
    if (!slugManual) {
      const newEn = rows.find((r) => r.lang === "en")?.value ?? "";
      if (newEn.trim()) {
        setSlug(autoSlug(newEn));
      } else {
        setSlug("");
      }
    }
  }

  function handleSlugChange(value: string) {
    setSlugManual(true);
    setSlug(value);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const errors: string[] = [];

    const enLabelValue = labelRows.find((r) => r.lang === "en")?.value.trim() ?? "";
    if (!enLabelValue) errors.push("English label is required.");
    if (!variationId) errors.push("Variation is required.");
    if (!priorityOrder.trim()) {
      errors.push("Priority order is required.");
    } else {
      const parsed = parseInt(priorityOrder, 10);
      if (isNaN(parsed) || parsed < 0) errors.push("Priority order must be a valid positive number.");
    }
    if (!price.trim()) {
      errors.push("Price is required.");
    } else {
      const parsed = parseInt(price, 10);
      if (isNaN(parsed) || parsed < 0) errors.push("Price must be a valid positive number.");
    }

    const urls = assetUrls.split("\n").map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0) errors.push("At least one asset URL is required.");

    if (errors.length > 0) {
      setShowErrors(true);
      setFormError(errors.join(" "));
      return;
    }

    let finalSlug = slug.trim();
    if (!finalSlug) finalSlug = autoSlug(enLabelValue);

    const labels: Record<string, string> = {};
    for (const row of labelRows) {
      if (row.lang && row.value.trim()) labels[row.lang] = row.value.trim();
    }
    const descriptions: Record<string, string> = {};
    for (const row of descRows) {
      if (row.lang && row.value.trim()) descriptions[row.lang] = row.value.trim();
    }

    const idealForArr = idealFor.split(",").map((s) => s.trim()).filter(Boolean);
    const notIdealForArr = notIdealFor.split(",").map((s) => s.trim()).filter(Boolean);

    setSubmitting(true);

    if (isEdit && existing && onUpdated) {
      const payload: VariationTypeUpdateInput = {
        slug: finalSlug,
        variation_id: variationId,
        priority_order: parseInt(priorityOrder, 10),
        price: parseInt(price, 10),
        labels,
        descriptions,
        asset_urls: urls,
        ideal_for: idealForArr,
        not_ideal_for: notIdealForArr,
      };
      updateVariationType(existing.id, payload)
        .then(() => onUpdated())
        .catch((err) => {
          setFormError(err instanceof Error ? err.message : "Failed to update variation type");
          setSubmitting(false);
        });
    } else if (onCreated) {
      const payload: VariationTypeCreateInput = {
        slug: finalSlug,
        variation_id: variationId,
        priority_order: parseInt(priorityOrder, 10),
        price: parseInt(price, 10),
        labels,
        descriptions,
        asset_urls: urls,
        ideal_for: idealForArr,
        not_ideal_for: notIdealForArr,
      };
      createVariationType(payload)
        .then(() => onCreated())
        .catch((err) => {
          setFormError(err instanceof Error ? err.message : "Failed to create variation type");
          setSubmitting(false);
        });
    }
  }

  const enLabelMissing = showErrors && !enLabel.trim();
  const variationMissing = showErrors && !variationId;
  const priorityMissing = showErrors && !priorityOrder.trim();
  const priceMissing = showErrors && !price.trim();
  const noAssetUrl = showErrors && !assetUrls.split("\n").map((s) => s.trim()).filter(Boolean).length;

  const inputCls = "w-full rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text";

  return (
    <form
      onSubmit={handleSubmit}
      className={`mb-4 rounded-card border p-4 shadow-card md:p-6 ${
        isEdit ? "border-accent-text/30 bg-chalk-white" : "border-hairline bg-chalk-white"
      }`}
    >
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-heading text-body font-semibold text-ink-navy">
          {isEdit ? "Edit Variation Type" : "New Variation Type"}
        </h2>
        {isEdit && existing && (
          <span className="truncate font-mono text-[11px] text-muted">
            {existing.id}
          </span>
        )}
      </div>

      {formError && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-3 py-2 text-caption text-error-text">
          {formError}
        </div>
      )}

      {/* Labels */}
      <div className="mb-5">
        <div className={`rounded-card ${enLabelMissing ? "border border-error-border bg-error-bg/30" : "border border-transparent"} p-1 -m-1`}>
          <LangRowEditor
            rows={labelRows}
            onChange={isEdit ? setLabelRows : handleEnLabelChange}
            label="Labels *"
            placeholder="e.g. V-Shape"
          />
        </div>
      </div>

      {/* Slug + Variation + Priority + Price */}
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Slug {slugManual && <span className="text-muted">(manual)</span>}
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder={enLabel ? autoSlug(enLabel) : "auto-generated"}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-muted">
            Auto-generated from English label. Click to edit.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Variation *
          </label>
          <select
            value={variationId}
            onChange={(e) => setVariationId(e.target.value)}
            className={`${inputCls} ${variationMissing ? "border-error-border" : ""}`}
          >
            <option value="">Select variation…</option>
            {variations.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Priority Order *
          </label>
          <input
            type="number"
            value={priorityOrder}
            onChange={(e) => setPriorityOrder(e.target.value)}
            placeholder="1"
            className={`${inputCls} ${priorityMissing ? "border-error-border" : ""}`}
          />
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Price *
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="200"
            className={`${inputCls} ${priceMissing ? "border-error-border" : ""}`}
          />
        </div>
      </div>

      {/* Descriptions */}
      <div className="mb-5">
        <LangRowEditor
          rows={descRows}
          onChange={setDescRows}
          label="Descriptions"
          multiline
          placeholder="e.g. A V-shaped neckline option…"
        />
      </div>

      {/* Ideal For / Not Ideal For */}
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Ideal For
          </label>
          <input
            type="text"
            value={idealFor}
            onChange={(e) => setIdealFor(e.target.value)}
            placeholder="slim, athletic (comma-separated)"
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-muted">Comma-separated body types</p>
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Not Ideal For
          </label>
          <input
            type="text"
            value={notIdealFor}
            onChange={(e) => setNotIdealFor(e.target.value)}
            placeholder="plus-size (comma-separated)"
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-muted">Comma-separated body types</p>
        </div>
      </div>

      {/* Asset URLs */}
      <div className="mb-5">
        <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
          Asset URLs *
        </label>
        <textarea
          value={assetUrls}
          onChange={(e) => setAssetUrls(e.target.value)}
          placeholder="One URL per line"
          rows={2}
          className={`w-full rounded-card border bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text ${
            noAssetUrl ? "border-error-border" : "border-hairline-strong"
          }`}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="tap rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : isEdit ? "Save Changes" : "Create Variation Type"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="tap rounded-pill border border-hairline-strong px-4 py-2.5 text-caption text-muted transition hover:bg-mist-navy hover:text-ink-navy"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Shared components
// ═══════════════════════════════════════════════════════════════════════════════

function SortableTh({
  column,
  sort,
  onSort,
}: {
  column: string;
  sort: SortState;
  onSort: (col: string) => void;
}) {
  const isActive = sort.column === column;
  return (
    <th className="whitespace-nowrap px-3 py-2.5 font-mono text-eyebrow text-ink-navy">
      <button
        onClick={() => onSort(column)}
        className={`group inline-flex items-center gap-1 transition ${
          isActive ? "text-accent-text" : "text-ink-navy hover:text-accent-text"
        }`}
      >
        <span>{column}</span>
        {isActive && (
          <span className="text-[10px]">{sort.direction === "asc" ? "↑" : "↓"}</span>
        )}
      </button>
    </th>
  );
}
