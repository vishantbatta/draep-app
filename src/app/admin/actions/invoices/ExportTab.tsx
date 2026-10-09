"use client";

/**
 * Configure → Invoices → Export.
 *
 * Filters (issue-date range, type, terms/reason) drive a debounced preview
 * against POST /admin/invoices/export (format=json). Export downloads the
 * finance-register xlsx (format=xlsx, built server-side in the reference
 * template — month-per-sheet, exact headers, live tax formulas, state
 * dropdown). With "Include PDFs" on, the tab renders every selected document
 * with the SAME deterministic client renderer used for single downloads
 * (renderGstDocumentPdfBlob) and bundles xlsx + PDFs into one zip via JSZip.
 * Failed renders are skipped and reported, never aborting the batch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  downloadInvoiceExportXlsx,
  exportInvoices,
  type ExportDocType,
  type ExportReason,
  type ExportTerm,
  type InvoiceExportResult,
} from "@/lib/admin-api";
import {
  gstDocumentPdfFilename,
  paiseToRupeeString,
  renderGstDocumentPdfBlob,
  type GstDocument,
} from "@/lib/gst-documents";

// ─── Filter option vocabulary ────────────────────────────────────────────────

const TYPE_OPTIONS: { key: ExportDocType; label: string; hint: string }[] = [
  { key: "payment_invoice", label: "Payment invoices", hint: "Minted when a payment was captured" },
  { key: "manual_invoice", label: "Manual invoices", hint: "Counter sales typed here" },
  { key: "credit_note", label: "Credit notes", hint: "Refunds and corrections" },
];

const TERMS_OPTIONS: { key: ExportTerm; label: string }[] = [
  { key: "paid_in_full", label: "Paid in Full" },
  { key: "due_on_receipt", label: "Due on receipt" },
  { key: "partially_paid", label: "Partially paid" },
];

const REASON_OPTIONS: { key: ExportReason; label: string }[] = [
  { key: "refund", label: "Refund" },
  { key: "payment_recorded_in_error", label: "Recorded in error" },
];

/** >100 PDFs triggers the "this will take a few minutes" confirm. */
const PDF_CONFIRM_THRESHOLD = 100;
/** Renders two at a time — each is a 3× A4 raster; more blows up memory. */
const PDF_CONCURRENCY = 2;

/** "yyyy-mm-dd" for a wall-clock moment in IST (same helper as the page). */
function istDateStr(d: Date): string {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}`;
}

function fyStartIst(): string {
  const ist = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60_000);
  const april = ist.getMonth() >= 3 ? ist.getFullYear() : ist.getFullYear() - 1;
  return `${april}-04-01`;
}

type Phase = { kind: "idle" } | { kind: "working"; label: string; done: number; total: number };

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function ExportTab() {
  const today = istDateStr(new Date());
  const fyStart = fyStartIst();

  const [dateFrom, setDateFrom] = useState(fyStart);
  const [dateTo, setDateTo] = useState(today);
  const [types, setTypes] = useState<Set<ExportDocType>>(
    new Set(["payment_invoice", "manual_invoice", "credit_note"]),
  );
  const [terms, setTerms] = useState<Set<ExportTerm>>(new Set());
  const [reasons, setReasons] = useState<Set<ExportReason>>(new Set());
  const [includePdfs, setIncludePdfs] = useState(false);

  const [preview, setPreview] = useState<InvoiceExportResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cancelRef = useRef(false);

  const cnSelected = types.has("credit_note");
  const filters = useMemo(
    () => ({
      date_from: dateFrom || null,
      date_to: dateTo || null,
      types: [...types],
      terms: [...terms],
      reasons: cnSelected ? [...reasons] : [],
    }),
    [dateFrom, dateTo, types, terms, reasons, cnSelected],
  );

  // Debounced preview — the same filter set the export will use.
  useEffect(() => {
    let alive = true;
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await exportInvoices(filters);
        if (alive) {
          setPreview(res);
          setExportError(null);
        }
      } catch (e) {
        if (alive) setExportError(e instanceof Error ? e.message : "Failed to preview export");
      } finally {
        if (alive) setPreviewLoading(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [filters]);

  const rangeValid = !dateFrom || !dateTo || dateFrom <= dateTo;
  const totalDocs = preview ? preview.summary.invoiceCount + preview.summary.creditNoteCount : 0;
  const canExport = rangeValid && totalDocs > 0 && phase.kind === "idle";

  /** Quick range presets ("All time" clears both bounds). */
  const presets = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const firstOfThis = `${today.slice(0, 7)}-01`;
    const d = new Date(`${firstOfThis}T00:00:00`);
    d.setMonth(d.getMonth() - 1);
    const prevYm = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const lastDayPrev = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return [
      { label: "This month", from: firstOfThis, to: today },
      { label: "Last month", from: `${prevYm}-01`, to: `${prevYm}-${pad(lastDayPrev)}` },
      { label: "This FY", from: fyStart, to: today },
      { label: "All time", from: "", to: "" },
    ];
  }, [today, fyStart]);

  function toggleType(key: ExportDocType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev; // never allow zero types
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleChip<T extends string>(set: Set<T>, key: T, updater: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updater(next);
  }

  const handleExport = useCallback(async () => {
    if (!preview) return;
    setDoneMsg(null);
    setExportError(null);
    cancelRef.current = false;

    const docs: GstDocument[] = includePdfs
      ? [...preview.invoices, ...preview.creditNotes]
      : [];

    if (includePdfs && docs.length > PDF_CONFIRM_THRESHOLD) {
      const ok = window.confirm(
        `This will render ${docs.length} PDFs in your browser — it can take a few minutes. Continue?`,
      );
      if (!ok) return;
    }

    try {
      setPhase({ kind: "working", label: "Building workbook…", done: 0, total: includePdfs ? docs.length : 0 });
      const { blob: xlsx, filename: xlsxName } = await downloadInvoiceExportXlsx(filters);

      if (!includePdfs) {
        const { default: saveAs } = await import("file-saver");
        saveAs(xlsx, xlsxName);
        setDoneMsg(`Downloaded ${xlsxName} — ${preview.summary.invoiceCount} invoice(s), ${preview.summary.creditNoteCount} credit note(s).`);
        return;
      }

      // Zip: xlsx at the root + every PDF under pdfs/. Failed renders are
      // skipped and reported — the rest of the zip still goes out.
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      zip.file(xlsxName, xlsx);
      const pdfFolder = zip.folder("pdfs");
      if (!pdfFolder) throw new Error("Could not create zip folder");
      const folder = pdfFolder; // narrowed JSZip for the closure below

      let done = 0;
      const failures: string[] = [];
      const queue = [...docs];
      async function worker() {
        while (queue.length > 0 && !cancelRef.current) {
          const doc = queue.shift();
          if (!doc) break;
          try {
            const pdf = await renderGstDocumentPdfBlob(doc);
            folder.file(gstDocumentPdfFilename(doc), pdf);
          } catch {
            failures.push(doc.number ?? doc.id);
          }
          done += 1;
          setPhase({ kind: "working", label: "Rendering PDFs…", done, total: docs.length });
        }
      }
      await Promise.all(Array.from({ length: PDF_CONCURRENCY }, worker));

      if (cancelRef.current) {
        setDoneMsg("Export cancelled — nothing was downloaded.");
        return;
      }

      setPhase({ kind: "working", label: "Zipping…", done: docs.length, total: docs.length });
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const { default: saveAs } = await import("file-saver");
      const zipName = `${preview.summary.basename.replace("DRAEP - FINANCE", "DRAEP - INVOICES")}.zip`;
      saveAs(zipBlob, zipName);

      const failedNote = failures.length
        ? ` Skipped ${failures.length} PDF(s): ${failures.join(", ")}.`
        : "";
      setDoneMsg(
        `Downloaded ${zipName} — workbook + ${docs.length - failures.length} PDF(s).${failedNote}`,
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setPhase({ kind: "idle" });
    }
  }, [preview, includePdfs, filters]);

  const summary = preview?.summary;

  return (
    <div className="space-y-5">
      {/* ── Filter card ── */}
      <div className="space-y-5 rounded-xl border border-hairline bg-chalk-white p-4 md:p-6">
        {/* Date range */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Date of invoice generation
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              min={fyStart}
              max={today}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text"
              aria-label="From date"
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              value={dateTo}
              min={fyStart}
              max={today}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text"
              aria-label="To date"
            />
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  setDateFrom(preset.from);
                  setDateTo(preset.to);
                }}
                className="rounded-pill border border-hairline px-2.5 py-1 text-[11px] font-medium text-muted transition hover:bg-mist-navy/40 hover:text-ink"
              >
                {preset.label}
              </button>
            ))}
          </div>
          {!rangeValid && (
            <p className="mt-1 text-[11px] text-red-600">From date must be on or before to date.</p>
          )}
        </div>

        {/* Type */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Type</div>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                title={opt.hint}
                className={`flex cursor-pointer items-center gap-2 rounded-pill border px-3 py-1.5 text-caption transition ${
                  types.has(opt.key)
                    ? "border-ink-navy bg-ink-navy/5 font-medium text-ink"
                    : "border-hairline text-muted hover:bg-mist-navy/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={types.has(opt.key)}
                  onChange={() => toggleType(opt.key)}
                  className="h-3.5 w-3.5 accent-ink-navy"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Terms (invoices) */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Terms <span className="font-normal normal-case">(invoices — none selected = all)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TERMS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => toggleChip(terms, opt.key, setTerms)}
                className={`rounded-pill border px-3 py-1.5 text-caption transition ${
                  terms.has(opt.key)
                    ? "border-ink-navy bg-ink-navy/5 font-medium text-ink"
                    : "border-hairline text-muted hover:bg-mist-navy/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reason (credit notes) */}
        <div className={cnSelected ? "" : "opacity-40"}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Reason <span className="font-normal normal-case">(credit notes — none selected = all)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {REASON_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => toggleChip(reasons, opt.key, setReasons)}
                disabled={!cnSelected}
                className={`rounded-pill border px-3 py-1.5 text-caption transition disabled:cursor-not-allowed ${
                  reasons.has(opt.key)
                    ? "border-ink-navy bg-ink-navy/5 font-medium text-ink"
                    : "border-hairline text-muted hover:bg-mist-navy/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Include PDFs */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-hairline bg-warm-sand/40 px-3 py-2.5">
          <input
            type="checkbox"
            checked={includePdfs}
            onChange={(e) => setIncludePdfs(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-ink-navy"
          />
          <span>
            <span className="block text-caption font-medium text-ink">
              Include PDFs of all documents (zip)
            </span>
            <span className="block text-[11px] leading-snug text-muted">
              Exports one zip: the xlsx plus a <span className="font-mono">pdfs/</span> folder with
              every selected invoice and credit note — rendered in your browser, so large ranges
              take a few minutes.
            </span>
          </span>
        </label>

        {/* Summary + action */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <div className="min-w-0 text-xs text-muted">
            {previewLoading && !preview ? (
              "Counting matching documents…"
            ) : summary ? (
              totalDocs === 0 ? (
                "Nothing matches these filters."
              ) : (
                <>
                  <span className="font-medium text-ink">
                    {summary.invoiceCount} invoice{summary.invoiceCount === 1 ? "" : "s"}
                  </span>{" "}
                  · {summary.creditNoteCount} credit note{summary.creditNoteCount === 1 ? "" : "s"} ·
                  taxable {paiseToRupeeString(summary.taxablePaise)}
                  <span className="block text-[11px]">
                    Workbook sheets: {summary.months.join(", ")}
                    {summary.creditNoteCount > 0 ? " + CREDIT NOTES" : ""}
                  </span>
                </>
              )
            ) : (
              "—"
            )}
          </div>
          <div className="flex items-center gap-2">
            {phase.kind === "working" && (
              <button
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-mist-navy/40"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={!canExport}
              className="tap rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase.kind === "working"
                ? phase.label
                : includePdfs
                  ? `Export zip${totalDocs ? ` (${totalDocs})` : ""}`
                  : "Export xlsx"}
            </button>
          </div>
        </div>

        {/* Progress */}
        {phase.kind === "working" && phase.total > 0 && (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-pill bg-mist-navy">
              <div
                className="h-full rounded-pill bg-ink-navy transition-all"
                style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {phase.label} {phase.done}/{phase.total}
            </div>
          </div>
        )}

        {exportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {exportError}
          </div>
        )}
        {doneMsg && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            {doneMsg}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted">
        The workbook replicates the finance register exactly — one sheet per month
        (MMM YYYY), the GSTR-1-style two-tier header, live tax formulas and the state
        dropdown. Credit notes ride on their own sheet. Export never writes; documents
        are immutable either way.
      </p>
    </div>
  );
}
