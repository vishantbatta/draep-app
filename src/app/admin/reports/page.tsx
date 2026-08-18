"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchReportSeries,
  type ReportBucket,
  type ReportMetric,
  type ReportPoint,
  type ReportSeries,
} from "@/lib/admin-api";

const BUCKETS: ReportBucket[] = ["daily", "weekly", "monthly"];

// Quick range shortcuts shown beside the Custom button.
type RangeShortcutKey = "7d" | "30d" | "3m";
const RANGE_SHORTCUTS: { key: RangeShortcutKey; label: string; title: string }[] =
  [
    { key: "7d", label: "7D", title: "Last 7 days" },
    { key: "30d", label: "30D", title: "Last 30 days" },
    { key: "3m", label: "3M", title: "Last 3 months" },
  ];
const DEFAULT_SHORTCUT: RangeShortcutKey = "7d";

/** Inclusive window ending today for a shortcut key. */
function shortcutRange(key: RangeShortcutKey): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  if (key === "3m") from.setMonth(from.getMonth() - 3);
  else from.setDate(from.getDate() - (key === "7d" ? 6 : 29));
  return { from: toISODate(from), to: toISODate(to) };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════════

export default function ReportsPage() {
  // Reports has no secondary nav — clear whatever the previous tab set.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", { detail: null }),
    );
  }, []);

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      <div className="mb-4">
        <h1 className="font-heading text-h3 font-semibold text-ink-navy md:text-h2">
          Reports
        </h1>
        <p className="mt-0.5 text-caption text-muted">
          Revenue booked (all orders), revenue collected (captured payments) and
          orders booked (excluding cancelled &amp; draft) over time.
        </p>
      </div>

      <div className="space-y-4">
        <ReportCard
          title="Revenue booked"
          metric="revenue_booked"
          unit="inr"
          barColor="var(--ink-navy)"
        />
        <ReportCard
          title="Revenue collected"
          metric="revenue_collected"
          unit="inr"
          barColor="var(--draep-orange)"
        />
        <ReportCard
          title="Orders booked"
          metric="orders_booked"
          unit="count"
          barColor="var(--deep-ember)"
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Report card — one metric, its granularity toggle + custom date range
// ═══════════════════════════════════════════════════════════════════════════════

function ReportCard({
  title,
  metric,
  unit,
  barColor,
}: {
  title: string;
  metric: ReportMetric;
  unit: "inr" | "count";
  barColor: string;
}) {
  const [bucket, setBucket] = useState<ReportBucket>("daily");
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [series, setSeries] = useState<ReportSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Custom range panel + the applied range (null = backend default window).
  const [rangeOpen, setRangeOpen] = useState(false);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string } | null>(() => shortcutRange(DEFAULT_SHORTCUT));

  const rangeValid =
    /^\d{4}-\d{2}-\d{2}$/.test(fromInput) &&
    /^\d{4}-\d{2}-\d{2}$/.test(toInput) &&
    fromInput <= toInput;

  // Which shortcut (if any) matches the applied range — matched against
  // today's windows, so a range left applied overnight stops highlighting.
  const activeShortcut = RANGE_SHORTCUTS.find((s) => {
    const r = shortcutRange(s.key);
    return appliedRange?.from === r.from && appliedRange.to === r.to;
  });
  const customActive = rangeOpen || (appliedRange !== null && !activeShortcut);

  // Stale-response guard — rapid bucket/range flips shouldn't race.
  const loadRef = useRef(0);

  useEffect(() => {
    const myLoad = ++loadRef.current;
    setLoading(true);
    setError(null);
    fetchReportSeries(metric, bucket, appliedRange ?? undefined)
      .then((s) => {
        if (loadRef.current === myLoad) {
          setSeries(s);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (loadRef.current === myLoad) {
          setError(err instanceof Error ? err.message : "Failed to load report");
          setLoading(false);
        }
      });
  }, [metric, bucket, appliedRange]);

  const total = useMemo(
    () => (series?.points ?? []).reduce((sum, p) => sum + p.value, 0),
    [series],
  );

  const rangeLabel =
    series &&
    `${formatShort(series.from_date)} – ${formatShort(series.to_date)}`;
  const totalLabel =
    unit === "inr"
      ? `₹${Math.round(total).toLocaleString("en-IN")}`
      : total.toLocaleString("en-IN");
  const bucketNoun =
    bucket === "daily" ? "days" : bucket === "weekly" ? "weeks" : "months";

  return (
    <section className="rounded-card border border-hairline bg-chalk-white p-3 shadow-card md:p-4">
      {/* ── Header: title + summary | granularity + custom range ─────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-4">
        <div className="min-w-0">
          <h2 className="font-heading text-body font-semibold text-ink-navy">
            {title}
          </h2>
          {series && !loading && (
            <p className="mt-0.5 text-caption text-muted">
              {rangeLabel} · {series.points.length} {bucketNoun} ·{" "}
              <span className="font-medium text-ink">Total {totalLabel}</span>
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Bar / line chart type */}
          <div className="flex overflow-hidden rounded-pill border border-hairline-strong">
            <button
              onClick={() => setChartType("bar")}
              title="Bar graph"
              aria-label="Bar graph"
              className={`tap px-2 py-1 transition ${
                chartType === "bar"
                  ? "bg-ink-navy text-chalk-white"
                  : "bg-chalk-white text-ink-navy hover:bg-mist-navy"
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 13V9M8 13V4.5M12.5 13V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => setChartType("line")}
              title="Line graph"
              aria-label="Line graph"
              className={`tap px-2 py-1 transition ${
                chartType === "line"
                  ? "bg-ink-navy text-chalk-white"
                  : "bg-chalk-white text-ink-navy hover:bg-mist-navy"
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                <path d="M2.5 11.5L6 7l3 2.5L13.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Daily / Weekly / Monthly */}
          <div className="flex overflow-hidden rounded-pill border border-hairline-strong">
            {BUCKETS.map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={`tap px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                  bucket === b
                    ? "bg-ink-navy text-chalk-white"
                    : "bg-chalk-white text-ink-navy hover:bg-mist-navy"
                }`}
              >
                {b}
              </button>
            ))}
          </div>

          {/* Quick range shortcuts */}
          {RANGE_SHORTCUTS.map((s) => {
            const active = activeShortcut?.key === s.key;
            return (
              <button
                key={s.key}
                title={s.title}
                aria-label={s.title}
                onClick={() => {
                  setAppliedRange(shortcutRange(s.key));
                  setRangeOpen(false);
                }}
                className={`tap rounded-pill border px-2.5 py-1 font-mono text-caption transition ${
                  active
                    ? "border-accent-text bg-accent-bg text-accent-text"
                    : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
                }`}
              >
                {s.label}
              </button>
            );
          })}

          {/* Custom date range toggle */}
          <button
            onClick={() => setRangeOpen((v) => !v)}
            className={`tap flex items-center gap-1.5 rounded-pill border px-3 py-1 font-mono text-caption transition ${
              customActive
                ? "border-accent-text bg-accent-bg text-accent-text"
                : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {appliedRange && !activeShortcut
              ? `${formatShort(appliedRange.from)} – ${formatShort(appliedRange.to)}`
              : "Custom"}
          </button>
        </div>
      </div>

      {/* ── Custom range inputs ───────────────────────────────────────────── */}
      {rangeOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-card border border-hairline bg-warm-sand/50 p-2">
          <input
            type="date"
            value={fromInput}
            max={toInput || undefined}
            onChange={(e) => setFromInput(e.target.value)}
            aria-label="From date"
            className="rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[13px] text-ink-navy outline-none focus:border-accent-text"
          />
          <span className="text-caption text-muted">to</span>
          <input
            type="date"
            value={toInput}
            min={fromInput || undefined}
            onChange={(e) => setToInput(e.target.value)}
            aria-label="To date"
            className="rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[13px] text-ink-navy outline-none focus:border-accent-text"
          />
          <button
            onClick={() => {
              if (!rangeValid) return;
              setAppliedRange({ from: fromInput, to: toInput });
              setRangeOpen(false);
            }}
            disabled={!rangeValid}
            className="tap rounded-pill bg-ink-navy px-4 py-1 text-eyebrow font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
          {appliedRange && (
            <button
              onClick={() => {
                setAppliedRange(shortcutRange(DEFAULT_SHORTCUT));
                setRangeOpen(false);
              }}
              className="tap rounded-pill border border-hairline-strong px-3 py-1 text-eyebrow text-muted transition hover:bg-mist-navy hover:text-ink-navy"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Chart ─────────────────────────────────────────────────────────── */}
      {error ? (
        <div className="mt-3 flex h-56 items-center justify-center rounded-card border border-error-border bg-error-bg px-4 text-caption text-error-text">
          {error}
        </div>
      ) : loading || !series ? (
        <div className="mt-3 flex h-56 items-center justify-center">
          <span className="text-caption text-muted">Loading…</span>
        </div>
      ) : (
        <MetricChart
          points={series.points}
          bucket={bucket}
          unit={unit}
          color={barColor}
          type={chartType}
        />
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Metric chart — bar or line, dependency-free SVG, scales with its container
// ═══════════════════════════════════════════════════════════════════════════════

const VIEW_W = 720;
const VIEW_H = 280;
const PAD_L = 58;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 30;
const GRID_LINES = 4;
const MAX_X_LABELS = 10;

function MetricChart({
  points,
  bucket,
  unit,
  color,
  type,
}: {
  points: ReportPoint[];
  bucket: ReportBucket;
  unit: "inr" | "count";
  color: string;
  type: "bar" | "line";
}) {
  // Hovered bar index + pointer position + current tooltip page. Hiding is
  // delayed briefly so the pointer can travel from a bar onto the tooltip
  // (to work the pager buttons) without dismissing it.
  const [hover, setHover] = useState<{
    i: number;
    x: number;
    y: number;
    page: number;
  } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setHover(null), 150);
  };
  useEffect(() => cancelHide, []);

  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;

  // Revenue values arrive as rupee integers (same convention as the Orders
  // page's formatPrice) — no conversion needed.
  const values = points.map((p) => p.value);
  const maxValue = Math.max(...values, 0);
  // Axis top = 4 × step, so gridlines sit on clean multiples (0, step, 2step…).
  const axisStep = niceStep(maxValue / GRID_LINES);
  const axisMax = axisStep * GRID_LINES;

  const n = points.length;
  const slot = n > 0 ? plotW / n : plotW;
  const barW = Math.max(2, Math.min(slot * 0.7, 42));
  const y = (v: number) => PAD_T + plotH - (v / axisMax) * plotH;

  const labelEvery = Math.max(1, Math.ceil(n / MAX_X_LABELS));

  // Line geometry — a point at the centre of each bucket's column.
  const linePts = points.map(
    (_, i) => [PAD_L + slot * i + slot / 2, y(values[i])] as const,
  );
  const linePath = linePts
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(" ");
  const baseline = PAD_T + plotH;
  const areaPath =
    linePts.length > 0
      ? `${linePath} L${linePts[linePts.length - 1][0].toFixed(1)} ${baseline} L${linePts[0][0].toFixed(1)} ${baseline} Z`
      : "";

  return (
    <>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        className="mt-3 h-auto w-full select-none"
      >
      {/* Gridlines + y labels */}
      {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
        const v = axisStep * i;
        const gy = y(v);
        return (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={VIEW_W - PAD_R}
              y1={gy}
              y2={gy}
              stroke={i === 0 ? "var(--hairline-strong)" : "var(--hairline)"}
              strokeWidth={i === 0 ? 1.2 : 1}
            />
            <text
              x={PAD_L - 8}
              y={gy + 4}
              textAnchor="end"
              className="fill-current font-mono text-muted"
              fontSize={11}
            >
              {unit === "inr" ? formatINRCompact(v) : formatCountCompact(v)}
            </text>
          </g>
        );
      })}

      {type === "bar"
        ? points.map((p, i) => {
            const v = values[i];
            const bx = PAD_L + slot * i + (slot - barW) / 2;
            const by = y(v);
            const barH = Math.max(v > 0 ? 1 : 0, PAD_T + plotH - by);
            return (
              <rect
                key={p.bucket_start}
                x={bx}
                y={by}
                width={barW}
                height={barH}
                rx={2.5}
                fill={color}
                opacity={hover?.i === i ? 0.7 : 1}
              />
            );
          })
        : linePts.length > 0 && (
            <>
              <path d={areaPath} fill={color} opacity={0.08} />
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((p, i) => (
                <circle
                  key={p.bucket_start}
                  cx={linePts[i][0]}
                  cy={linePts[i][1]}
                  r={hover?.i === i ? 4 : 2.5}
                  fill={hover?.i === i ? "var(--chalk-white)" : color}
                  stroke={color}
                  strokeWidth={hover?.i === i ? 2 : 0}
                />
              ))}
            </>
          )}

      {/* X labels (thinned so they never collide) */}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text
            key={`x-${p.bucket_start}`}
            x={PAD_L + slot * i + slot / 2}
            y={VIEW_H - 8}
            textAnchor="middle"
            className="fill-current font-mono text-muted"
            fontSize={11}
          >
            {xLabel(p.bucket_start, bucket)}
          </text>
        ) : null,
      )}

      {/* Hover hit-areas — one transparent column per bucket, shared by both
          chart types so hovering anywhere in a column opens the tooltip. */}
      {points.map((p, i) => (
        <rect
          key={`hit-${p.bucket_start}`}
          x={PAD_L + slot * i}
          y={PAD_T}
          width={slot}
          height={plotH}
          fill="transparent"
          style={{ pointerEvents: "all" }}
          onMouseEnter={(e) => {
            cancelHide();
            setHover({ i, x: e.clientX, y: e.clientY, page: 0 });
          }}
          onMouseMove={(e) =>
            setHover((h) =>
              h && h.i === i ? { ...h, x: e.clientX, y: e.clientY } : h,
            )
          }
          onMouseLeave={scheduleHide}
        />
      ))}
    </svg>

      {hover && points[hover.i] && (
        <BucketTooltip
          point={points[hover.i]}
          bucket={bucket}
          unit={unit}
          page={hover.page}
          onPage={(page) => setHover((h) => (h ? { ...h, page } : h))}
          x={hover.x}
          y={hover.y}
          onEnter={cancelHide}
          onLeave={scheduleHide}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Hover tooltip — bucket total + customer/value list, paged ‹ › when long
// ═══════════════════════════════════════════════════════════════════════════════

const TOOLTIP_PAGE_SIZE = 5;

function BucketTooltip({
  point,
  bucket,
  unit,
  page,
  onPage,
  x,
  y,
  onEnter,
  onLeave,
}: {
  point: ReportPoint;
  bucket: ReportBucket;
  unit: "inr" | "count";
  page: number;
  onPage: (page: number) => void;
  x: number;
  y: number;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const items = point.items ?? [];
  const pageCount = Math.max(1, Math.ceil(items.length / TOOLTIP_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = items.slice(
    safePage * TOOLTIP_PAGE_SIZE,
    safePage * TOOLTIP_PAGE_SIZE + TOOLTIP_PAGE_SIZE,
  );
  const totalText =
    unit === "inr"
      ? `₹${point.value.toLocaleString("en-IN")}`
      : `${point.value.toLocaleString("en-IN")} ${point.value === 1 ? "order" : "orders"}`;

  // Clamp so the card never leaves the viewport.
  const left = Math.min(x + 14, window.innerWidth - 250);
  const top = Math.max(12, Math.min(y + 14, window.innerHeight - 270));

  return (
    <div
      className="fixed z-50 w-60 rounded-card border border-hairline bg-chalk-white p-2.5 shadow-brand"
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <p className="font-mono text-eyebrow uppercase text-muted">
        {bucketLabel(point.bucket_start, bucket)}
      </p>
      <p className="mt-0.5 font-heading text-body font-semibold text-ink-navy">
        {totalText}
      </p>

      <div className="mt-1.5 space-y-1">
        {rows.length === 0 && (
          <p className="text-caption text-muted">No orders this {bucket === "daily" ? "day" : bucket === "weekly" ? "week" : "month"}</p>
        )}
        {rows.map((it, k) => (
          <div
            key={`${it.label}-${k}`}
            className="flex items-baseline justify-between gap-2 text-caption"
          >
            <span className="truncate text-ink">{it.label}</span>
            <span className="shrink-0 font-mono text-muted">
              ₹{it.value.toLocaleString("en-IN")}
            </span>
          </div>
        ))}
      </div>

      {items.length > TOOLTIP_PAGE_SIZE && (
        <div className="mt-1.5 flex items-center justify-between border-t border-hairline pt-1.5">
          <button
            onClick={() => onPage(safePage - 1)}
            disabled={safePage === 0}
            aria-label="Previous orders"
            className="tap flex h-5 w-5 items-center justify-center rounded-pill border border-hairline-strong text-caption text-ink-navy transition hover:bg-mist-navy disabled:opacity-40"
          >
            ‹
          </button>
          <span className="font-mono text-[11px] text-muted">
            {safePage + 1} / {pageCount}
          </span>
          <button
            onClick={() => onPage(safePage + 1)}
            disabled={safePage === pageCount - 1}
            aria-label="Next orders"
            className="tap flex h-5 w-5 items-center justify-center rounded-pill border border-hairline-strong text-caption text-ink-navy transition hover:bg-mist-navy disabled:opacity-40"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** "YYYY-MM-DD" → local Date (never via new Date(str), which is UTC-parsed). */
function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Local Date → "YYYY-MM-DD" (inverse of parseDay). */
function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const fmtDayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const fmtDayMonthYear = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const fmtMonthYear = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" });
const fmtMonthLong = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

function formatShort(s: string): string {
  return fmtDayMonth.format(parseDay(s));
}

function xLabel(day: string, bucket: ReportBucket): string {
  const d = parseDay(day);
  return bucket === "monthly" ? fmtMonthYear.format(d) : fmtDayMonth.format(d);
}

/** ₹ with Indian k / L / Cr abbreviations (input in rupees). */
function formatINRCompact(rupees: number): string {
  const abs = Math.abs(rupees);
  const trim = (x: number) => (Math.round(x * 10) / 10).toString();
  if (abs >= 1e7) return `₹${trim(rupees / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(rupees / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(rupees / 1e3)}k`;
  return `₹${Math.round(rupees)}`;
}

function formatCountCompact(v: number): string {
  if (Math.abs(v) >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

/** Smallest 1/2/2.5/5×10^k step that covers the given range. */
function niceStep(range: number): number {
  if (range <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(range)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * base >= range) return m * base;
  }
  return 10 * base;
}

/** Human label for a bucket: full date, Mon–Sun range, or month name. */
function bucketLabel(day: string, bucket: ReportBucket): string {
  const d = parseDay(day);
  if (bucket === "monthly") return fmtMonthLong.format(d);
  if (bucket === "weekly") {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    return `${fmtDayMonthYear.format(d)} – ${fmtDayMonthYear.format(end)}`;
  }
  return fmtDayMonthYear.format(d);
}
