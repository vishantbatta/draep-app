"use client";

/**
 * Hub QC tool — throwaway stitched-vs-recorded measurement comparison.
 *
 * Flow: order lookup (11-digit order number or UUID) → pick the garment
 * instance → type what the stitched garment actually measures for every
 * body + garment-specific metric → report card of deltas sorted worst
 * first (green ≤0.25", yellow 0.25–0.5", red ≥0.5").
 *
 * Read-only and stateless: every value comes from existing admin read
 * APIs (recorded readings via the measurement-job checklist resolver)
 * and nothing is ever written back. Refreshing wipes everything.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GarmentSelectionSheet } from "@/components/admin/GarmentSelectionSheet";
import {
  fetchAdminJobChecklist,
  fetchGarmentOrderItems,
  fetchGarmentOrdersForOrder,
  fetchJobsForOrder,
  fetchTableRows,
  fetchUserById,
  getAdminToken,
  resolveAssetUrl,
  type AdminJobChecklist,
  type ChecklistMetric,
  type GarmentOrderItemRow,
  type MeasurementJobRow,
  type OrderRow,
} from "@/lib/admin-api";

// ─── Delta bands (inches) ────────────────────────────────────────────────────
const BAND_OK = 0.25; // |Δ| ≤ 0.25  → green
const BAND_FAIL = 0.5; // |Δ| ≥ 0.5  → red (between → yellow)

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Small helpers ───────────────────────────────────────────────────────────

function metricLabel(m: ChecklistMetric): string {
  return m.labels?.en ?? m.code ?? m.id.slice(0, 8);
}

/** 34.50 → "34.5"; keep negatives; trim float noise. */
function fmtNum(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ");
}

/** Newest-first timestamp for a measurement job (any milestone works). */
function jobTs(j: MeasurementJobRow): string {
  return (
    j.completed_at ??
    j.performed_at ??
    j.started_at ??
    j.scheduled_at ??
    j.created_at ??
    ""
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 1.5A6.5 6.5 0 0 1 14.5 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = "lookup" | "pick" | "enter" | "report";

/** A garment instance card on the picker. Deliberately carries no status —
 *  the tool only needs identity, imagery, pricing and the user's note. */
interface GarmentCard {
  id: string; // garment_order_id
  garmentId: string; // catalog garment id (selections sheet input)
  basePrice: number | null;
  /** 1-based instance number within the order ("Blouse #2"). */
  index: number;
  label: string;
  userNote: string | null;
  images: string[];
}

/** One stitched-value input row on the entry screen. */
interface EntryRow {
  key: string; // `b:{metricId}` | `g:{goId}:{metricId}`
  metric: ChecklistMetric;
  group: string; // "Body measurements" | owning entity label
  /** Recorded reading is text (e.g. cup "C") → text input instead of numeric. */
  isText: boolean;
  hasBaseline: boolean;
}

type Band = "ok" | "warn" | "fail";

/** Verdict colors for the PDF (hex — mirrors the CSS token palette). */
const BAND_PDF: Record<Band, { label: string; fg: string; bg: string }> = {
  ok: { label: "OK", fg: "#1C7A48", bg: "#E8F1EC" },
  warn: { label: "Off", fg: "#92580A", bg: "#FEF6E0" },
  fail: { label: "Fail", fg: "#B3382C", bg: "#FCE9E7" },
};

interface ReportNumRow {
  label: string;
  group: string;
  recorded: number;
  stitched: number;
  delta: number;
  band: Band;
}

interface ReportTextRow {
  label: string;
  group: string;
  recorded: string;
  stitched: string;
  matches: boolean;
}

interface SkippedRow {
  label: string;
  group: string;
  reason: "no-baseline" | "not-measured";
}

interface ReportData {
  garment: GarmentCard;
  num: ReportNumRow[];
  text: ReportTextRow[];
  skipped: SkippedRow[];
}

/** garments table row (generic tables API returns every column). */
interface GarmentCatalogRow {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  asset_urls: string[] | null;
  base_price: number | null;
}

// ─── Step strip ──────────────────────────────────────────────────────────────

const STEPS: { key: Phase; label: string }[] = [
  { key: "lookup", label: "Order" },
  { key: "pick", label: "Garment" },
  { key: "enter", label: "Measure" },
  { key: "report", label: "Report" },
];

function StepStrip({ phase }: { phase: Phase }) {
  const activeIdx = STEPS.findIndex((s) => s.key === phase);
  return (
    <div className="mb-5 flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            {i > 0 && (
              <span
                className={`h-px w-4 md:w-6 ${done ? "bg-ink-navy" : "bg-hairline-strong"}`}
              />
            )}
            <span
              className={`flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-medium ${
                active
                  ? "bg-ink-navy text-chalk-white"
                  : done
                    ? "bg-mist-navy text-ink-navy"
                    : "text-muted"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9px] ${
                  active || done ? "bg-chalk-white/20" : "bg-hairline"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HubQcToolPage() {
  // Auth: admin token must exist (re-checked on tab focus so logging in
  // in another tab unlocks this one without a manual refresh).
  const [authOk, setAuthOk] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => setAuthOk(!!getAdminToken());
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  const [phase, setPhase] = useState<Phase>("lookup");
  const [error, setError] = useState<string | null>(null);

  // Lookup
  const [lookupInput, setLookupInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Loaded order context
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [garments, setGarments] = useState<GarmentCard[]>([]);
  const [job, setJob] = useState<MeasurementJobRow | null>(null);
  const [checklist, setChecklist] = useState<AdminJobChecklist | null>(null);
  // Selections (garment_orders_items rows) per garment — feeds the read-only
  // "View details" sheet.
  const [itemsByGo, setItemsByGo] = useState<
    Record<string, GarmentOrderItemRow[]>
  >({});
  // Garment order whose selections sheet is open (picker screen).
  const [detailsGoId, setDetailsGoId] = useState<string | null>(null);

  // Entry + report
  const [selectedGoId, setSelectedGoId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ReportData | null>(null);
  const [building, setBuilding] = useState(false);
  // Compare button — receives focus when Enter is pressed on the last input.
  const compareRef = useRef<HTMLButtonElement>(null);

  // ─── Lookup + context load ────────────────────────────────────────────────

  const loadOrder = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const { rows } = await fetchTableRows<OrderRow>("orders", {
        filters: UUID_RE.test(q) ? { id: q } : { order_number: q },
        perPage: 1,
      });
      const found = rows[0] ?? null;
      if (!found) {
        setError(
          `No order found for "${q}". Check the 11-digit order number or the UUID.`,
        );
        return;
      }

      const [goRows, jobRows] = await Promise.all([
        fetchGarmentOrdersForOrder(found.id),
        fetchJobsForOrder(found.id),
      ]);
      if (goRows.length === 0) {
        setError(`Order ${found.order_number ?? found.id.slice(0, 8)} has no garments.`);
        return;
      }

      // Latest job, preferring a completed one — that's the recorded baseline.
      const sorted = [...jobRows].sort((a, b) => jobTs(b).localeCompare(jobTs(a)));
      const latest = sorted.find((j) => j.status === "completed") ?? sorted[0] ?? null;
      if (!latest) {
        setError(
          `Order ${found.order_number ?? ""} has no measurement job — nothing recorded to compare against.`,
        );
        return;
      }
      const cl = await fetchAdminJobChecklist(latest.id);

      // Images per garment: catalog image + customer-shared assets + item
      // reference photos (first available wins, a few shown as thumbs).
      const uniqueGarmentIds = [
        ...new Set(goRows.map((g) => g.garment_id).filter(Boolean)),
      ] as string[];
      const [itemsByGo, catalogRows] = await Promise.all([
        Promise.all(
          goRows.map((g) =>
            fetchGarmentOrderItems(g.id).catch(
              () => [] as GarmentOrderItemRow[],
            ),
          ),
        ),
        Promise.all(
          uniqueGarmentIds.map((id) =>
            fetchTableRows<GarmentCatalogRow>("garments", {
              filters: { id },
              perPage: 1,
            })
              .then(({ rows: r }) => r[0] ?? null)
              .catch(() => null),
          ),
        ),
      ]);
      const catalogById = new Map(
        catalogRows.filter(Boolean).map((c) => [c!.id, c!]),
      );

      const cards: GarmentCard[] = goRows.map((go, i) => {
        const catalog = catalogById.get(go.garment_id);
        const clLabel = cl.garments.find(
          (g) => g.garment_order_id === go.id,
        )?.label;
        const label =
          clLabel ?? catalog?.labels?.en ?? catalog?.slug ?? `Garment ${i + 1}`;
        const raw = [
          (catalog?.asset_urls ?? [])[0],
          ...(go.assets_shared ?? []),
          ...itemsByGo[i].flatMap((it) => it.images ?? []),
        ].filter((u): u is string => !!u);
        const images = [
          ...new Set(raw.map((u) => resolveAssetUrl(u)).filter((u): u is string => !!u)),
        ];
        return {
          id: go.id,
          garmentId: go.garment_id,
          basePrice: catalog?.base_price ?? null,
          index: i + 1,
          label,
          userNote: go.user_note,
          images,
        };
      });

      setOrder(found);
      setGarments(cards);
      setJob(latest);
      setChecklist(cl);
      setItemsByGo(
        Object.fromEntries(goRows.map((go, i) => [go.id, itemsByGo[i]])),
      );
      setDetailsGoId(null);
      setPhase("pick");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lookup failed";
      if (msg === "No admin token") setAuthOk(false);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  function resetAll() {
    setPhase("lookup");
    setLookupInput("");
    setError(null);
    setOrder(null);
    setGarments([]);
    setJob(null);
    setChecklist(null);
    setItemsByGo({});
    setDetailsGoId(null);
    setSelectedGoId(null);
    setEntries({});
    setReport(null);
    setBuilding(false);
  }

  function backToPick() {
    setPhase("pick");
    setSelectedGoId(null);
    setEntries({});
    setReport(null);
    setDetailsGoId(null);
    setError(null);
  }

  // ─── Entry rows for the selected garment ──────────────────────────────────

  const selected = garments.find((g) => g.id === selectedGoId) ?? null;
  const detailsCard = garments.find((g) => g.id === detailsGoId) ?? null;

  const entryRows = useMemo<EntryRow[]>(() => {
    if (!checklist || !selected) return [];
    const rows: EntryRow[] = checklist.base.map((m) => {
      const r = m.reading;
      return {
        key: `b:${m.id}`,
        metric: m,
        group: "Body measurements",
        isText: !!r?.value_text && r.value_numeric == null,
        hasBaseline: !!r,
      };
    });
    const clGarment = checklist.garments.find(
      (g) => g.garment_order_id === selected.id,
    );
    for (const section of clGarment?.sections ?? []) {
      for (const m of section.metrics) {
        const key = `g:${selected.id}:${m.id}`;
        if (rows.some((r) => r.key === key)) continue; // metric in 2 sections
        const r = m.reading;
        rows.push({
          key,
          metric: m,
          group: section.entity.label,
          isText: !!r?.value_text && r.value_numeric == null,
          hasBaseline: !!r,
        });
      }
    }
    return rows;
  }, [checklist, selected]);

  const filledCount = useMemo(
    () => entryRows.filter((r) => (entries[r.key] ?? "").trim() !== "").length,
    [entryRows, entries],
  );

  // ─── Compare ──────────────────────────────────────────────────────────────

  function compare() {
    if (!selected) return;
    setError(null);
    const num: ReportNumRow[] = [];
    const text: ReportTextRow[] = [];
    const skipped: SkippedRow[] = [];

    for (const row of entryRows) {
      const val = (entries[row.key] ?? "").trim();
      if (val === "") {
        skipped.push({
          label: metricLabel(row.metric),
          group: row.group,
          reason: row.hasBaseline ? "not-measured" : "no-baseline",
        });
        continue;
      }
      const r = row.metric.reading;
      if (!r) {
        // Stitched value typed but nothing recorded to compare against.
        skipped.push({
          label: metricLabel(row.metric),
          group: row.group,
          reason: "no-baseline",
        });
        continue;
      }
      if (row.isText) {
        text.push({
          label: metricLabel(row.metric),
          group: row.group,
          recorded: r.value_text ?? "—",
          stitched: val,
          matches:
            (r.value_text ?? "").trim().toLowerCase() === val.toLowerCase(),
        });
        continue;
      }
      const parsed = Number(val);
      if (Number.isNaN(parsed)) {
        setError(`"${val}" is not a number (${metricLabel(row.metric)}).`);
        return;
      }
      if (r.value_numeric == null) {
        skipped.push({
          label: metricLabel(row.metric),
          group: row.group,
          reason: "no-baseline",
        });
        continue;
      }
      const delta = parsed - r.value_numeric;
      const abs = Math.abs(delta);
      num.push({
        label: metricLabel(row.metric),
        group: row.group,
        recorded: r.value_numeric,
        stitched: parsed,
        delta,
        band: abs <= BAND_OK ? "ok" : abs >= BAND_FAIL ? "fail" : "warn",
      });
    }

    if (num.length + text.length === 0) {
      setError("Nothing to compare — enter at least one stitched measurement.");
      return;
    }
    num.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    setReport({ garment: selected, num, text, skipped });
    setBuilding(false);
    setPhase("report");
  }

  /** Build a one/two-page A4 PDF of the report (Draep logo header, summary
   *  chips, the delta table worst-first, text values + not-compacted rows)
   *  and trigger a file download. ASCII-only text: jsPDF's built-in fonts
   *  are WinAnsi, so no arrows/glyphs beyond ±. */
  async function downloadReport() {
    if (!report || !order) return;
    setBuilding(true);
    setError(null);
    try {
      const [jspdfMod, { default: saveAs }] = await Promise.all([
        import("jspdf"),
        import("file-saver"),
      ]);
      const jsPDF = jspdfMod.jsPDF ?? jspdfMod.default;
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const M = 14; // page margin
      const colEnd = pageW - M; // right edge of content (196mm)
      const orderNumber = order.order_number ?? order.id.slice(0, 8);
      const { garment, num, text, skipped } = report;
      const counts = {
        ok: num.filter((r) => r.band === "ok").length,
        warn: num.filter((r) => r.band === "warn").length,
        fail: num.filter((r) => r.band === "fail").length,
      };
      const garmentTitle =
        garments.length > 1 ? `${garment.label} #${garment.index}` : garment.label;
      let y = 0;

      // ── Header: Draep logo (best-effort) + title block ─────────────────────
      try {
        const res = await fetch("/logo.png");
        if (res.ok) {
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          });
          const img = await new Promise<HTMLImageElement | null>((resolve) => {
            const im = new window.Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = dataUrl;
          });
          if (img && img.naturalWidth > 0) {
            // Downscale + flatten onto white: the source logo is 3745x2302
            // RGBA, and jsPDF's PNG path embeds raw RGBA (~35MB at full res).
            // A small JPEG embeds via DCT and stays a few KB.
            const hPx = 240;
            const wPx = Math.max(1, Math.round((img.naturalWidth / img.naturalHeight) * hPx));
            const canvas = document.createElement("canvas");
            canvas.width = wPx;
            canvas.height = hPx;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, wPx, hPx);
              ctx.drawImage(img, 0, 0, wPx, hPx);
              const h = 11; // mm
              const w = (wPx / hPx) * h;
              pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", M, 13, w, h);
              y = 13 + h + 3;
            }
          }
        }
      } catch {
        // Logo optional — the text header carries the report without it.
      }
      y = Math.max(y, 20);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.setTextColor(8, 48, 104);
      pdf.text("Hub QC Report", colEnd, 18, { align: "right" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(90);
      pdf.text(`Order ${orderNumber} - ${garmentTitle}`, colEnd, 24, { align: "right" });
      if (job?.performed_at) {
        pdf.text(
          `Recorded ${new Date(job.performed_at).toLocaleDateString()}`,
          colEnd,
          29,
          { align: "right" },
        );
      }
      pdf.setTextColor(20);
      y = Math.max(y, 34);

      // ── Summary chips ──────────────────────────────────────────────────────
      const chips: Band[] = ["ok", "warn", "fail"];
      let cx = M;
      for (const band of chips) {
        const b = BAND_PDF[band];
        const label = `${counts[band]} ${b.label === "OK" ? "ok" : b.label === "Off" ? "off" : "fail"}`;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        const chipW = pdf.getTextWidth(label) + 8;
        pdf.setFillColor(b.bg);
        pdf.roundedRect(cx, y, chipW, 7, 2, 2, "F");
        pdf.setTextColor(b.fg);
        pdf.text(label, cx + 4, y + 4.8);
        cx += chipW + 3;
      }
      pdf.setTextColor(20);
      y += 11;

      if (num[0]) {
        const w0 = num[0];
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(60);
        pdf.text(
          `Biggest delta: ${w0.label} ${fmtNum(w0.recorded)} to ${fmtNum(w0.stitched)} in (${w0.delta > 0 ? "+" : ""}${fmtNum(w0.delta)})`,
          M,
          y,
        );
        pdf.setTextColor(20);
        y += 7;
      }
      y += 2;

      // ── Delta table ────────────────────────────────────────────────────────
      function tableHeader() {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        pdf.setTextColor(80);
        pdf.text("MEASUREMENT", M, y);
        pdf.text("RECORDED", 142, y, { align: "right" });
        pdf.text("STITCHED", 162, y, { align: "right" });
        pdf.text("DIFF (in)", 182, y, { align: "right" });
        pdf.text("VERDICT", colEnd, y, { align: "right" });
        pdf.setDrawColor(210);
        pdf.line(M, y + 1.5, colEnd, y + 1.5);
        pdf.setTextColor(20);
        y += 6;
      }

      function ensureSpace(need: number) {
        if (y + need > pageH - 18) {
          pdf.addPage();
          y = 16;
          tableHeader();
        }
      }

      tableHeader();
      for (const r of num) {
        ensureSpace(11);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        pdf.text(r.label, M, y + 3.5);
        pdf.setFontSize(7.5);
        pdf.setTextColor(130);
        pdf.text(r.group, M, y + 7.5);
        pdf.setTextColor(20);
        pdf.setFont("courier", "normal");
        pdf.setFontSize(9.5);
        pdf.text(fmtNum(r.recorded), 142, y + 3.5, { align: "right" });
        pdf.text(fmtNum(r.stitched), 162, y + 3.5, { align: "right" });
        pdf.text(
          `${r.delta > 0 ? "+" : ""}${fmtNum(r.delta)}`,
          182,
          y + 3.5,
          { align: "right" },
        );
        const b = BAND_PDF[r.band];
        pdf.setFont("helvetica", "bold");
        const pillW = pdf.getTextWidth(b.label) + 7;
        pdf.setFillColor(b.bg);
        pdf.roundedRect(colEnd - pillW, y + 0.8, pillW, 5.4, 1.5, 1.5, "F");
        pdf.setTextColor(b.fg);
        pdf.text(b.label, colEnd - pillW + 3.5, y + 4.4);
        pdf.setTextColor(20);
        pdf.setDrawColor(232);
        pdf.line(M, y + 9.2, colEnd, y + 9.2);
        y += 10.5;
      }

      // ── Text values (no delta possible) ───────────────────────────────────
      if (text.length > 0) {
        y += 3;
        ensureSpace(10 + text.length * 6);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text("Text values", M, y + 3.5);
        y += 8;
        for (const r of text) {
          ensureSpace(6);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(9.5);
          pdf.text(r.label, M, y + 3.5);
          pdf.text(`${r.recorded} vs ${r.stitched}`, 182, y + 3.5, { align: "right" });
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(r.matches ? BAND_PDF.ok.fg : BAND_PDF.fail.fg);
          pdf.text(r.matches ? "Match" : "MISMATCH", colEnd, y + 3.5, { align: "right" });
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(20);
          y += 6;
        }
      }

      // ── Not compared ───────────────────────────────────────────────────────
      if (skipped.length > 0) {
        y += 3;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text(`Not compared (${skipped.length})`, M, y + 3.5);
        y += 8;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(110);
        for (const r of skipped) {
          ensureSpace(5);
          pdf.text(
            `${r.label} (${r.group}) - ${r.reason === "no-baseline" ? "nothing recorded during the job" : "left blank"}`,
            M,
            y + 3,
          );
          y += 5;
        }
        pdf.setTextColor(20);
      }

      // ── Footer on every page ───────────────────────────────────────────────
      const pages = pdf.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(130);
        pdf.text(
          `OK within +/-${BAND_OK} in - Off below +/-${BAND_FAIL} in - Fail at +/-${BAND_FAIL} in or more`,
          M,
          pageH - 10,
        );
        pdf.text(`Generated ${new Date().toLocaleString()}`, colEnd, pageH - 10, { align: "right" });
        pdf.text(`${p}/${pages}`, colEnd, pageH - 6, { align: "right" });
      }

      const safe = (s: string) =>
        s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
      saveAs(
        pdf.output("blob"),
        `hub-qc-${safe(orderNumber)}-${safe(garment.label)}-${garment.index}.pdf`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setBuilding(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (authOk === null) {
    return <div className="min-h-screen bg-warm-sand" />;
  }

  if (!authOk) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-warm-sand px-4">
        <div className="w-full max-w-sm rounded-card border border-hairline bg-chalk-white p-6 text-center shadow-card">
          <h1 className="font-heading text-h2 font-semibold text-ink-navy">
            Hub QC Tool
          </h1>
          <p className="mt-2 text-caption text-muted">
            This tool reads order data and needs an admin login.
          </p>
          <a
            href="/admin/login"
            className="tap mt-4 inline-flex items-center rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90"
          >
            Log in as admin
          </a>
          <p className="mt-3 text-[11px] text-muted">
            Log in, then come back to this tab — the tool unlocks automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-warm-sand">
      <main className="mx-auto max-w-column px-4 py-6 md:py-10">
        <header className="mb-4 flex items-end justify-between gap-2">
          <div>
            <h1 className="font-heading text-h3 font-semibold text-ink-navy md:text-h2">
              Hub QC Tool
            </h1>
            <p className="text-[11px] text-muted">
              Compare stitched measurements against the recorded job — nothing is
              saved.
            </p>
          </div>
          {phase !== "lookup" && (
            <button
              type="button"
              onClick={resetAll}
              className="tap shrink-0 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
            >
              New order
            </button>
          )}
        </header>

        <StepStrip phase={phase} />

        {error && (
          <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
            {error}
          </div>
        )}

        {/* ── 1. Lookup ─────────────────────────────────────────────────── */}
        {phase === "lookup" && (
          <>
            <div className="max-w-2xl rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
              <label
                htmlFor="hub-qc-order"
                className="mb-1.5 block font-mono text-eyebrow text-ink-navy"
              >
                Order ID or UUID
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadOrder(lookupInput);
                }}
                className="flex gap-2"
              >
                <input
                  id="hub-qc-order"
                  type="text"
                  value={lookupInput}
                  onChange={(e) => setLookupInput(e.target.value)}
                  placeholder="e.g. 12345678901 or 3f2a…"
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-data text-ink outline-none placeholder:text-muted focus:border-ink-navy"
                />
                <button
                  type="submit"
                  disabled={loading || lookupInput.trim() === ""}
                  className="tap flex items-center gap-2 rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading && <Spinner />}
                  {loading ? "Fetching…" : "Fetch order"}
                </button>
              </form>
              <p className="mt-2 text-[11px] text-muted">
                Takes the 11-digit order number or the order UUID. Only reads
                data — the stitched values you type never leave this page.
              </p>
            </div>

            <div className="mt-4 max-w-2xl">
              <RecentCompletedJobs onPick={(id) => void loadOrder(id)} />
            </div>
          </>
        )}

        {/* ── 2. Garment picker ─────────────────────────────────────────── */}
        {phase === "pick" && order && (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-hairline bg-chalk-white px-4 py-3 text-caption text-ink shadow-card">
              <span className="font-mono text-eyebrow text-ink-navy">
                Order {order.order_number ?? order.id.slice(0, 8)}
              </span>
              <span className="text-muted">
                {garments.length} garment{garments.length > 1 ? "s" : ""}
              </span>
              {job && (
                <span className="text-muted">
                  Job {job.status ? humanize(job.status) : "—"}
                  {job.performed_at
                    ? ` · ${new Date(job.performed_at).toLocaleDateString()}`
                    : ""}
                </span>
              )}
              <span className="text-muted">
                {humanize(order.payment_status)} ·{" "}
                {humanize(order.fulfillment_status)}
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {garments.map((g) => (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedGoId(g.id);
                    setEntries({});
                    setError(null);
                    setPhase("enter");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedGoId(g.id);
                      setEntries({});
                      setError(null);
                      setPhase("enter");
                    }
                  }}
                  className="tap group flex cursor-pointer flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white text-left shadow-card transition outline-none hover:border-ink-navy focus-visible:border-ink-navy"
                >
                  <div className="flex h-36 items-center justify-center gap-1 overflow-hidden bg-mist-navy/40 p-2">
                    {g.images.length > 0 ? (
                      g.images.slice(0, 3).map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={src + i}
                          src={src}
                          alt=""
                          className="h-full max-w-[33%] rounded-md object-cover"
                        />
                      ))
                    ) : (
                      <span className="text-[11px] text-muted">No images</span>
                    )}
                  </div>
                  <div className="flex flex-1 items-start justify-between gap-2 p-3">
                    <div>
                      <p className="text-data font-medium text-ink">
                        {g.label}
                        {garments.length > 1 && (
                          <span className="text-muted"> #{g.index}</span>
                        )}
                      </p>
                      {g.userNote && (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
                          “{g.userNote}”
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailsGoId(g.id);
                      }}
                      className="tap shrink-0 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
                    >
                      View details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 3. Stitched measurement entry ─────────────────────────────── */}
        {phase === "enter" && selected && (
          <div className="max-w-2xl rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
            <div className="mb-4">
              <p className="font-mono text-eyebrow text-ink-navy">
                {selected.label}
                {garments.length > 1 && ` #${selected.index}`}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                Enter what the <strong>stitched garment</strong> measures for each
                row. Recorded values stay hidden until you compare — leave rows
                blank to skip them.
              </p>
            </div>

            <EntryGroups
              rows={entryRows}
              entries={entries}
              onChange={(key, v) =>
                setEntries((prev) => ({ ...prev, [key]: v }))
              }
              onLastEnter={() => compareRef.current?.focus()}
            />

            <div className="sticky bottom-3 mt-5 flex items-center justify-between gap-3 rounded-card border border-hairline bg-chalk-white/95 px-4 py-3 shadow-brand backdrop-blur">
              <span className="text-[11px] text-muted">
                {filledCount} of {entryRows.length} filled
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={backToPick}
                  className="tap rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
                >
                  Back
                </button>
                <button
                  ref={compareRef}
                  type="button"
                  onClick={compare}
                  onKeyDown={(e) => {
                    // Explicit keyboard activation — some embedded browsers
                    // skip the native Enter/Space default on buttons.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      compare();
                    }
                  }}
                  disabled={filledCount === 0}
                  className="tap rounded-pill bg-ink-navy px-6 py-2 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Compare
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 4. Report card ────────────────────────────────────────────── */}
        {phase === "report" && report && order && (
          <ReportCard
            report={report}
            orderNumber={order.order_number ?? order.id.slice(0, 8)}
            job={job}
            building={building}
            onDownload={() => void downloadReport()}
            onEdit={() => {
              // Keep selectedGoId + entries — the entry screen re-renders
              // with every previously typed value prefilled.
              setReport(null);
              setPhase("enter");
            }}
            onAnother={backToPick}
          />
        )}

        {/* Read-only selections sheet (picker "View details") */}
        {detailsCard && (
          <GarmentSelectionSheet
            open
            garmentId={detailsCard.garmentId}
            garmentOrderId={detailsCard.id}
            initialItems={itemsByGo[detailsCard.id] ?? []}
            basePrice={detailsCard.basePrice}
            readOnly
            title={`${detailsCard.label} selections`}
            onClose={() => setDetailsGoId(null)}
          />
        )}
      </main>
    </div>
  );
}

// ─── Entry groups (body + per-selection sections) ────────────────────────────

function EntryGroups({
  rows,
  entries,
  onChange,
  onLastEnter,
}: {
  rows: EntryRow[];
  entries: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** Enter pressed on the last input (focus moves to Compare). */
  onLastEnter: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, EntryRow[]>();
    for (const r of rows) {
      const list = map.get(r.group) ?? [];
      list.push(r);
      map.set(r.group, list);
    }
    return [...map.entries()];
  }, [rows]);

  /** Enter/Next advances focus to the following input, selecting its value
   *  so a retyped measurement replaces the old one; on the last input it
   *  hands focus to the Compare button. */
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    e.preventDefault();
    const inputs = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("input"),
    );
    const idx = inputs.indexOf(target);
    const next = inputs[idx + 1];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    } else {
      onLastEnter();
    }
  }

  const lastKey = rows.length > 0 ? rows[rows.length - 1].key : null;

  const inputCls =
    "w-24 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-data text-ink focus:border-ink-navy focus:outline-none";

  return (
    <div className="space-y-5" onKeyDown={handleKeyDown}>
      {groups.map(([group, groupRows]) => (
        <div key={group}>
          <p className="mb-1.5 font-mono text-eyebrow text-ink-navy">
            {group}
          </p>
          <div className="divide-y divide-hairline rounded-card border border-hairline">
            {groupRows.map((row) => {
              const val = entries[row.key] ?? "";
              const isLast = row.key === lastKey;
              const keyHint = isLast ? "done" : "next";
              return (
                <div
                  key={row.key}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-data text-ink">
                      {metricLabel(row.metric)}
                      {row.metric.is_required && (
                        <span className="ml-0.5 text-error-text">*</span>
                      )}
                    </p>
                    {!row.hasBaseline && (
                      <p className="text-[10px] text-muted">
                        no recorded baseline
                      </p>
                    )}
                  </div>
                  {row.isText ? (
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => onChange(row.key, e.target.value)}
                      placeholder="stitched"
                      aria-label={`${metricLabel(row.metric)} stitched value`}
                      enterKeyHint={keyHint}
                      className={`${inputCls} w-20`}
                    />
                  ) : (
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={val}
                      onChange={(e) => onChange(row.key, e.target.value)}
                      placeholder="0.0"
                      aria-label={`${metricLabel(row.metric)} stitched value`}
                      enterKeyHint={keyHint}
                      className={inputCls}
                    />
                  )}
                  <span className="w-4 shrink-0 text-[10px] text-muted">
                    {row.isText ? "" : "in"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="py-6 text-center text-caption text-muted">
          No measurements expected for this garment.
        </p>
      )}
    </div>
  );
}

// ─── Report card ─────────────────────────────────────────────────────────────

const BAND_STYLE: Record<Band, { chip: string; row: string; label: string }> = {
  ok: {
    chip: "bg-success-bg text-success-text border-success-border",
    row: "",
    label: "OK",
  },
  warn: {
    chip: "bg-warning-bg text-warning-text border-warning-border",
    row: "",
    label: "Off",
  },
  fail: {
    chip: "bg-error-bg text-error-text border-error-border",
    row: "",
    label: "Fail",
  },
};

function ReportCard({
  report,
  orderNumber,
  job,
  building,
  onDownload,
  onEdit,
  onAnother,
}: {
  report: ReportData;
  orderNumber: string;
  job: MeasurementJobRow | null;
  building: boolean;
  onDownload: () => void;
  onEdit: () => void;
  onAnother: () => void;
}) {
  const { garment, num, text, skipped } = report;
  const counts = {
    ok: num.filter((r) => r.band === "ok").length,
    warn: num.filter((r) => r.band === "warn").length,
    fail: num.filter((r) => r.band === "fail").length,
  };
  const worst = num[0] ?? null;

  return (
    <div className="max-w-2xl space-y-4">
      {/* Summary header */}
      <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-eyebrow text-ink-navy">
              Order {orderNumber} · {garment.label} #{garment.index}
            </p>
            <h2 className="mt-1 font-heading text-h3 font-semibold text-ink-navy">
              Stitched vs recorded
            </h2>
            {job?.performed_at && (
              <p className="text-[11px] text-muted">
                Recorded {new Date(job.performed_at).toLocaleDateString()} ·{" "}
                {humanize(job.status)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <span className="rounded-pill border border-success-border bg-success-bg px-3 py-1 text-[11px] font-medium text-success-text">
              {counts.ok} ok
            </span>
            <span className="rounded-pill border border-warning-border bg-warning-bg px-3 py-1 text-[11px] font-medium text-warning-text">
              {counts.warn} off
            </span>
            <span className="rounded-pill border border-error-border bg-error-bg px-3 py-1 text-[11px] font-medium text-error-text">
              {counts.fail} fail
            </span>
          </div>
        </div>

        {worst && (
          <div
            className={`mt-4 rounded-card border px-4 py-3 ${BAND_STYLE[worst.band].chip}`}
          >
            <p className="text-[10px] font-mono uppercase tracking-wide opacity-70">
              Biggest delta
            </p>
            <p className="text-data font-medium">
              {worst.label}: {fmtNum(worst.recorded)} → {fmtNum(worst.stitched)}{" "}
              in (Δ {worst.delta > 0 ? "+" : ""}
              {fmtNum(worst.delta)})
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="tap flex items-center gap-2 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path
                d="M9.7 3.3l3 3M2.5 13.5l.9-3.3a2 2 0 0 1 .5-.9l6.1-6.1a1.5 1.5 0 0 1 2.1 0l.7.7a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a2 2 0 0 1-.9.5l-3.3.9z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Edit measurements
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={building}
            className="tap flex items-center gap-2 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            {building && <Spinner />}
            {building ? "Building PDF…" : "Download report"}
          </button>
          <button
            type="button"
            onClick={onAnother}
            className="tap rounded-pill bg-ink-navy px-4 py-2 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90"
          >
            QC next garment in this order
          </button>
          <span className="ml-auto text-[10px] text-muted">
            green ≤ ±{BAND_OK}″ · yellow &lt; ±{BAND_FAIL}″ · red ≥ ±{BAND_FAIL}″
          </span>
        </div>
      </div>

      {/* Numeric deltas, worst first */}
      {num.length > 0 && (
        <div className="overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline bg-mist-navy/40 text-left">
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-ink-navy">
                  Measurement
                </th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-ink-navy">
                  Recorded
                </th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-ink-navy">
                  Stitched
                </th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-ink-navy">
                  Δ
                </th>
                <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-ink-navy">
                  Verdict
                </th>
              </tr>
            </thead>
            <tbody>
              {num.map((r) => (
                <tr key={r.label + r.group} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2">
                    <p className="text-data text-ink">{r.label}</p>
                    <p className="text-[10px] text-muted">{r.group}</p>
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-data text-muted">
                    {fmtNum(r.recorded)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-data text-ink">
                    {fmtNum(r.stitched)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-data text-ink">
                    {r.delta > 0 ? "+" : ""}
                    {fmtNum(r.delta)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`rounded-pill border px-2 py-0.5 text-[10px] font-medium ${BAND_STYLE[r.band].chip}`}
                    >
                      {BAND_STYLE[r.band].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Text comparisons (cup size etc. — no delta possible) */}
      {text.length > 0 && (
        <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <p className="mb-2 font-mono text-eyebrow text-ink-navy">
            Text values
          </p>
          <div className="divide-y divide-hairline">
            {text.map((r) => (
              <div
                key={r.label}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-data text-ink">{r.label}</span>
                <span className="flex items-center gap-2 font-mono text-data text-muted">
                  {r.recorded} → {r.stitched}
                  <span
                    className={`rounded-pill border px-2 py-0.5 text-[10px] font-medium ${
                      r.matches
                        ? "bg-success-bg text-success-text border-success-border"
                        : "bg-error-bg text-error-text border-error-border"
                    }`}
                  >
                    {r.matches ? "Match" : "Mismatch"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Not compared */}
      {skipped.length > 0 && (
        <details className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <summary className="cursor-pointer font-mono text-eyebrow text-ink-navy">
            Not compared ({skipped.length})
          </summary>
          <div className="mt-2 divide-y divide-hairline">
            {skipped.map((r) => (
              <div
                key={r.label + r.reason}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="text-caption text-ink">
                  {r.label}
                  <span className="ml-1 text-[10px] text-muted">
                    ({r.group})
                  </span>
                </span>
                <span className="text-[10px] text-muted">
                  {r.reason === "no-baseline"
                    ? "nothing recorded during the job"
                    : "left blank"}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Recent completed measurement jobs (order picker) ────────────────────────

/** One hydrated row: a completed measurement job tied to an order. */
interface RecentRow {
  job: MeasurementJobRow;
  orderNumber: string | null;
  customerName: string | null;
}

function RecentCompletedJobs({ onPick }: { onPick: (orderId: string) => void }) {
  const PER_PAGE = 10;
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState<MeasurementJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Hydration caches survive page flips so revisits cost no requests.
  const [orderById, setOrderById] = useState<
    Record<string, { order_number: string | null; user_id: string | null }>
  >({});
  const [nameByUser, setNameByUser] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows, total: t } = await fetchTableRows<MeasurementJobRow>(
        "measurement_jobs",
        {
          page,
          perPage: PER_PAGE,
          sortColumn: "created_at",
          sortDirection: "desc",
          filters: { status: "completed" },
        },
      );
      const withOrder = rows.filter((j) => j.order_id);
      setJobs(withOrder);
      setTotal(t);

      const orderIds = [...new Set(withOrder.map((j) => j.order_id!))].filter(
        (id) => !(id in orderById),
      );
      const userIds = [
        ...new Set(
          withOrder.map((j) => j.user_id).filter(Boolean) as string[],
        ),
      ].filter((id) => !(id in nameByUser));

      const [orderRows, userRows] = await Promise.all([
        Promise.all(
          orderIds.map(async (id) => {
            try {
              const { rows: r } = await fetchTableRows<{
                id: string;
                order_number: string | null;
                user_id: string | null;
              }>("orders", { filters: { id }, perPage: 1 });
              return r[0] ?? null;
            } catch {
              return null;
            }
          }),
        ),
        Promise.all(
          userIds.map(async (id) => {
            try {
              return await fetchUserById(id);
            } catch {
              return null;
            }
          }),
        ),
      ]);

      if (orderRows.some(Boolean)) {
        setOrderById((prev) => {
          const next = { ...prev };
          orderRows.filter(Boolean).forEach((o) => {
            next[o!.id] = {
              order_number: o!.order_number,
              user_id: o!.user_id,
            };
          });
          return next;
        });
      }
      if (userRows.some(Boolean)) {
        setNameByUser((prev) => {
          const next = { ...prev };
          userRows.filter(Boolean).forEach((u) => {
            next[u!.id] = u!.name ?? "Unnamed";
          });
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recent jobs");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const rowsHydrated: RecentRow[] = jobs.map((job) => ({
    job,
    orderNumber: job.order_id
      ? (orderById[job.order_id]?.order_number ?? null)
      : null,
    customerName: job.user_id ? (nameByUser[job.user_id] ?? null) : null,
  }));

  return (
    <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
      <p className="mb-3 font-mono text-eyebrow text-ink-navy">
        Recent completed jobs
      </p>

      {loading && (
        <p className="flex items-center gap-2 py-4 text-caption text-muted">
          <Spinner /> Loading recent jobs…
        </p>
      )}
      {!loading && error && (
        <p className="py-2 text-caption text-error-text">{error}</p>
      )}
      {!loading && !error && rowsHydrated.length === 0 && (
        <p className="py-4 text-center text-caption text-muted">
          No completed measurement jobs yet.
        </p>
      )}

      {!loading && rowsHydrated.length > 0 && (
        <div className="divide-y divide-hairline rounded-card border border-hairline">
          {rowsHydrated.map(({ job, orderNumber, customerName }) => (
            <button
              key={job.id}
              type="button"
              onClick={() => job.order_id && onPick(job.order_id)}
              className="tap flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-mist-navy/40"
            >
              <div className="min-w-0">
                <p className="font-mono text-data font-medium text-ink-navy">
                  {orderNumber ?? "—"}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {customerName ?? "—"} · {job.order_id?.slice(0, 8) ?? "—"}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-muted">
                {job.performed_at
                  ? new Date(job.performed_at).toLocaleDateString()
                  : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-caption">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="tap rounded-pill border border-hairline-strong bg-chalk-white px-4 py-1.5 font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            className="tap rounded-pill border border-hairline-strong bg-chalk-white px-4 py-1.5 font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
