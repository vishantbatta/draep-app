"use client";

/**
 * MeasurementsSheet — admin editor for a measurement job's readings, split
 * the way capture works: a Body measurements section (per-visit base
 * metrics) and one block per garment instance (its per-garment metrics
 * grouped by the owning catalog entity, e.g. "Sleeve: regular short").
 * Every row is editable; readings the resolver no longer expects stay
 * visible under "Additional saved readings" so saved data never silently
 * disappears.
 *
 * Props:
 *  - jobId           the measurement job whose readings are edited
 *  - garmentOrderId  optional — when set, only that garment's block renders
 *                    (the "Measurements" button on a garment order card)
 *  - onSaved         called with a summary string after a successful save
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  createTableRow,
  deleteTableRow,
  fetchAdminJobChecklist,
  fetchMeasurementMetrics,
  updateTableRow,
  type AdminJobChecklist,
  type ChecklistMetric,
  type MeasurementMetricRow,
} from "@/lib/admin-api";

/** One editable row. key = `b:{metricId}` (base) or `g:{goId}:{metricId}`. */
interface DraftRow {
  key: string;
  metricId: string;
  garmentOrderId: string | null;
  label: string;
  isRequired: boolean;
  requiredBy?: string;
  extra: boolean;
  valueNumeric: string;
  valueText: string;
  unit: string;
  /** measurements row id when a saved reading exists. */
  rowId?: string;
}

function metricLabel(m: {
  labels: Record<string, string> | null;
  code: string | null;
  id: string;
}): string {
  return m.labels?.en ?? m.code ?? m.id.slice(0, 8);
}

/** "Blouse length: Long waist, Sleeve: Sleeveless" for a required_by hint. */
function requiredByHint(m: ChecklistMetric): string | undefined {
  if (!m.required_by?.length) return undefined;
  return m.required_by
    .map((r) => r.entity_labels.join(", "))
    .filter(Boolean)
    .join("; ");
}

export function MeasurementsSheet({
  open,
  onClose,
  jobId,
  garmentOrderId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  garmentOrderId?: string | null;
  onSaved?: (summary: string) => void;
}) {
  const [checklist, setChecklist] = useState<AdminJobChecklist | null>(null);
  const [catalog, setCatalog] = useState<MeasurementMetricRow[]>([]);
  const [drafts, setDrafts] = useState<Map<string, DraftRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-dismiss timer armed after a successful save.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Add-metric picker per scope: "base" or the garment_order_id.
  const [addPick, setAddPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cl, cat] = await Promise.all([
        fetchAdminJobChecklist(jobId),
        catalog.length > 0
          ? Promise.resolve(catalog)
          : fetchMeasurementMetrics(),
      ]);
      setCatalog(cat);
      setChecklist(cl);
      setDrafts(seedDrafts(cl));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load measurements");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (open && jobId) void load();
    if (!open) {
      setChecklist(null);
      setDrafts(new Map());
      setAddPick({});
      setError(null);
      setSaved(false);
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open, jobId, load]);

  const garments = useMemo(
    () =>
      garmentOrderId
        ? (checklist?.garments ?? []).filter(
            (g) => g.garment_order_id === garmentOrderId,
          )
        : (checklist?.garments ?? []),
    [checklist, garmentOrderId],
  );

  function setField(
    key: string,
    field: "valueNumeric" | "valueText" | "unit",
    value: string,
  ) {
    setDrafts((prev) => {
      const row = prev.get(key);
      if (!row) return prev;
      const next = new Map(prev);
      next.set(key, { ...row, [field]: value });
      return next;
    });
  }

  function removeRow(key: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  /** Add a catalog metric (no saved reading yet) to a scope's draft. */
  function addMetric(scope: string, garmentId: string | null, metricId: string) {
    if (!metricId) return;
    const key = garmentId ? `g:${garmentId}:${metricId}` : `b:${metricId}`;
    if (drafts.has(key)) return;
    const metric = catalog.find((m) => m.id === metricId);
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(key, {
        key,
        metricId,
        garmentOrderId: garmentId,
        label: metric
          ? metricLabel(metric)
          : metricId.slice(0, 8),
        isRequired: false,
        extra: false,
        valueNumeric: "",
        valueText: "",
        unit: metric?.unit ?? "",
      });
      return next;
    });
    setAddPick((prev) => ({ ...prev, [scope]: "" }));
  }

  async function save() {
    if (!checklist) return;
    setSaving(true);
    setError(null);
    try {
      // Saved reading ids present when the sheet loaded — used to detect
      // rows the admin removed from the draft.
      const loadedRowIds = new Set(
        [
          ...checklist.base,
          ...checklist.garments.flatMap((g) =>
            g.sections.flatMap((s) => s.metrics),
          ),
        ]
          .map((m) => m.reading?.id)
          .filter((x): x is string => !!x),
      );

      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const row of drafts.values()) {
        const num = row.valueNumeric.trim();
        const txt = row.valueText.trim();
        const valueNumeric = num === "" ? null : Number(num);
        const valueText = txt === "" ? null : txt;
        if (valueNumeric !== null && Number.isNaN(valueNumeric)) {
          throw new Error(`"${num}" is not a number (${row.label})`);
        }
        // Exactly-one-value rule (DB CHECK): blank both + existing row →
        // delete; blank both + no row → nothing to write.
        if (valueNumeric === null && valueText === null) {
          if (row.rowId) {
            await deleteTableRow("measurements", row.rowId);
            deleted++;
          }
          continue;
        }
        const payload: Record<string, unknown> = {
          measurement_job_id: jobId,
          measurement_metric_id: row.metricId,
          garment_order_id: row.garmentOrderId,
          value_numeric: valueNumeric,
          value_text: valueText,
          unit: row.unit.trim() || null,
          captured_at: new Date().toISOString(),
        };
        if (row.rowId) {
          await updateTableRow("measurements", row.rowId, payload);
          updated++;
        } else {
          await createTableRow("measurements", payload);
          created++;
        }
      }

      const keptRowIds = new Set(
        Array.from(drafts.values())
          .map((r) => r.rowId)
          .filter((x): x is string => !!x),
      );
      for (const rowId of loadedRowIds) {
        if (!keptRowIds.has(rowId)) {
          await deleteTableRow("measurements", rowId);
          deleted++;
        }
      }

      const summary = [
        created > 0 && `${created} created`,
        updated > 0 && `${updated} updated`,
        deleted > 0 && `${deleted} deleted`,
      ]
        .filter(Boolean)
        .join(", ");
      onSaved?.(summary ? `Measurements saved (${summary})` : "No changes");

      // Success state on the button, then dismiss the sheet. Reopening
      // reloads the checklist fresh, so no refetch is needed here.
      setSaved(true);
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null;
        onClose();
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save measurements");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs focus:border-ink-navy focus:outline-none";

  function renderRows(rows: DraftRow[], scope: string, garmentId: string | null) {
    // Drafts hold the live edit state; fall back to the seeded row when a
    // metric has no draft (shouldn't happen, but keeps render total).
    const ordered = rows.map((row) => drafts.get(row.key) ?? row);
    return (
      <>
        <tbody>
          {ordered.map((row) => (
            <tr key={row.key} className="border-b border-hairline last:border-0">
              <td className="py-1.5 pr-2 text-ink">
                {row.label}
                {row.isRequired && (
                  <span className="ml-0.5 text-red-500" title="Required">
                    *
                  </span>
                )}
                {row.extra && (
                  <span
                    className="ml-1 rounded bg-mist-navy px-1 text-[9px] uppercase tracking-wide text-muted"
                    title="Saved reading the current design selections no longer ask for"
                  >
                    extra
                  </span>
                )}
                {row.requiredBy && (
                  <div
                    className="text-[10px] text-muted"
                    title={`Needed by: ${row.requiredBy}`}
                  >
                    ↳ {row.requiredBy}
                  </div>
                )}
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={row.valueNumeric}
                  onChange={(e) =>
                    setField(row.key, "valueNumeric", e.target.value)
                  }
                  aria-label={`${row.label} numeric value`}
                  className={`w-20 ${inputCls}`}
                />
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="text"
                  value={row.valueText}
                  onChange={(e) => setField(row.key, "valueText", e.target.value)}
                  aria-label={`${row.label} text value`}
                  className={`w-28 ${inputCls}`}
                />
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="text"
                  value={row.unit}
                  onChange={(e) => setField(row.key, "unit", e.target.value)}
                  aria-label={`${row.label} unit`}
                  className={`w-14 ${inputCls}`}
                />
              </td>
              <td className="py-1.5">
                <button
                  onClick={() => removeRow(row.key)}
                  title="Remove"
                  className="flex h-6 w-6 items-center justify-center rounded text-red-500 transition hover:bg-red-50"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 5h10M6 5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V5M5 5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
          {ordered.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2.5 text-center text-muted">
                No metrics expected here.
              </td>
            </tr>
          )}
        </tbody>
        {/* Add-metric picker for this scope */}
        <tfoot>
          <tr>
            <td colSpan={5} className="pt-1.5">
              <div className="flex items-center gap-2">
                <select
                  value={addPick[scope] ?? ""}
                  onChange={(e) =>
                    setAddPick((prev) => ({ ...prev, [scope]: e.target.value }))
                  }
                  aria-label="Add metric"
                  className={`flex-1 ${inputCls}`}
                >
                  <option value="">— Add metric —</option>
                  {catalog
                    .filter(
                      (m) =>
                        !drafts.has(
                          garmentId ? `g:${garmentId}:${m.id}` : `b:${m.id}`,
                        ),
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {metricLabel(m)}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => addMetric(scope, garmentId, addPick[scope] ?? "")}
                  disabled={!addPick[scope]}
                  className="rounded-md bg-ink-navy px-3 py-1 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
                >
                  + Add
                </button>
              </div>
            </td>
          </tr>
        </tfoot>
      </>
    );
  }

  /** Does the loaded checklist already expect this metric in this scope? */
  function checklistHasMetric(metricId: string, garmentId: string | null) {
    if (!checklist) return true;
    if (garmentId === null) return checklist.base.some((m) => m.id === metricId);
    return checklist.garments
      .find((g) => g.garment_order_id === garmentId)
      ?.sections.some((s) => s.metrics.some((m) => m.id === metricId));
  }

  /** Draft rows the admin added that the checklist doesn't expect. */
  function addedRows(garmentId: string | null): DraftRow[] {
    return Array.from(drafts.values()).filter(
      (r) =>
        r.garmentOrderId === garmentId &&
        !checklistHasMetric(r.metricId, garmentId),
    );
  }

  const tableHead = (
    <thead>
      <tr className="border-b border-hairline text-[10px] uppercase tracking-wide text-muted">
        <th className="py-1.5 pr-2 font-medium">Metric</th>
        <th className="py-1.5 pr-2 font-medium">Numeric</th>
        <th className="py-1.5 pr-2 font-medium">Text</th>
        <th className="py-1.5 pr-2 font-medium">Unit</th>
        <th className="py-1.5"></th>
      </tr>
    </thead>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={garmentOrderId ? "Garment Measurements" : "Manage Measurements"}
      className="max-w-2xl"
      footer={
        <div>
          {error && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="mb-2 text-[10px] text-muted">
            Exactly one of numeric/text per row — blank both to delete. Rows
            marked <span className="text-red-500">*</span> are required by this
            order&apos;s design selections.
          </div>
          <button
            onClick={() => void save()}
            disabled={saving || saved || loading}
            className="tap w-full rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary transition hover:bg-tape/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                Saving…
              </span>
            ) : saved ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2.5 8.5 6 12l7.5-8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Saved!
              </span>
            ) : (
              "Save measurements"
            )}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="py-6 text-center text-xs text-muted">
          Loading measurements…
        </div>
      ) : !checklist ? (
        <div className="py-6 text-center text-xs text-muted">
          {error ?? "No checklist loaded."}
        </div>
      ) : (
        <>
          {/* ── Body measurements (per visit) ─────────────────────────── */}
          {!garmentOrderId && (
            <section className="mb-4">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-navy">
                Body measurements
              </h3>
              <p className="mb-1.5 text-[10px] text-muted">
                Per-visit readings shared across every garment on the order.
              </p>
              <table className="w-full text-left text-xs">
                {tableHead}
                {renderRows(
                  [
                    ...checklist.base.map(
                      (m) => drafts.get(`b:${m.id}`) ?? draftFromMetric(m, null),
                    ),
                    ...addedRows(null),
                  ],
                  "base",
                  null,
                )}
              </table>
            </section>
          )}

          {/* ── Per-garment sections ──────────────────────────────────── */}
          {garments.map((g) => (
            <section key={g.garment_order_id} className="mb-4">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-navy">
                {g.label}
                {g.status && (
                  <span className="ml-2 font-normal normal-case text-muted">
                    {g.status.replace(/_/g, " ")}
                  </span>
                )}
              </h3>
              {g.sections.length === 0 && (
                <p className="mb-1.5 text-[10px] text-muted">
                  No garment-level metrics expected for this design.
                </p>
              )}
              {g.sections.map((s) => (
                <div key={`${s.entity.type}:${s.entity.id ?? "extra"}`} className="mb-2">
                  {g.sections.length > 1 && (
                    <div className="mb-0.5 text-[10px] font-medium text-muted">
                      {s.entity.label}
                    </div>
                  )}
                  <table className="w-full text-left text-xs">
                    {tableHead}
                    {renderRows(
                      s.metrics.map(
                        (m) =>
                          drafts.get(`g:${g.garment_order_id}:${m.id}`) ??
                          draftFromMetric(m, g.garment_order_id),
                      ),
                      g.garment_order_id,
                      g.garment_order_id,
                    )}
                  </table>
                </div>
              ))}
              {/* Admin-added rows for this garment (not expected by the
                  resolver) render in their own trailing table. */}
              {addedRows(g.garment_order_id).length > 0 && (
                <div className="mb-2">
                  <div className="mb-0.5 text-[10px] font-medium text-muted">
                    Added by you
                  </div>
                  <table className="w-full text-left text-xs">
                    {tableHead}
                    {renderRows(
                      addedRows(g.garment_order_id),
                      g.garment_order_id,
                      g.garment_order_id,
                    )}
                  </table>
                </div>
              )}
            </section>
          ))}

          {!garmentOrderId && garments.length === 0 && (
            <div className="py-4 text-center text-xs text-muted">
              No garment orders on this order yet.
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}

/** Seed the draft map from a loaded checklist (expected + extra readings). */
function seedDrafts(cl: AdminJobChecklist): Map<string, DraftRow> {
  const drafts = new Map<string, DraftRow>();
  for (const m of cl.base) {
    drafts.set(`b:${m.id}`, draftFromMetric(m, null));
  }
  for (const g of cl.garments) {
    for (const s of g.sections) {
      for (const m of s.metrics) {
        drafts.set(
          `g:${g.garment_order_id}:${m.id}`,
          draftFromMetric(m, g.garment_order_id),
        );
      }
    }
  }
  return drafts;
}

function draftFromMetric(
  m: ChecklistMetric,
  garmentOrderId: string | null,
): DraftRow {
  return {
    key: garmentOrderId ? `g:${garmentOrderId}:${m.id}` : `b:${m.id}`,
    metricId: m.id,
    garmentOrderId,
    label: metricLabel(m),
    isRequired: !!m.is_required,
    requiredBy: requiredByHint(m),
    extra: !!m.extra,
    valueNumeric:
      m.reading?.value_numeric !== null && m.reading?.value_numeric !== undefined
        ? String(m.reading.value_numeric)
        : "",
    valueText: m.reading?.value_text ?? "",
    unit: m.reading?.unit ?? m.unit ?? "",
    rowId: m.reading?.id,
  };
}
