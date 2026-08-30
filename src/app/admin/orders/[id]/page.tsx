"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchTableRows,
  createUserLoginLink,
  fetchUserById,
  fetchStyleCaptains,
  fetchGarmentOrdersForOrder,
  fetchGarmentOrderItems,
  fetchJobsForOrder,
  fetchTransactionsForOrder,
  fetchGarments,
  fetchMeasurementMetrics,
  fetchJobReadings,
  fetchOrderGarmentOrders,
  fetchOrderGarmentMaterials,
  resolveAssetUrl,
  garmentLabel,
  updateOrder,
  updateGarmentOrder,
  updateMeasurementJob,
  updateTableRow,
  createTableRow,
  createGarmentOrder,
  createMeasurementJob,
  confirmOrderSlot,
  deleteGarmentOrder,
  deleteTableRow,
  fetchOrderAdjustments,
  createOrderAdjustment,
  updateOrderAdjustment,
  deleteOrderAdjustment,
  fetchGarmentTree,
  catalogLabel,
  formatOrderSlot,
  type OrderRow,
  type GarmentOrderRow,
  type GarmentOrderItemRow,
  type MeasurementJobRow,
  type TransactionRow,
  type UserRow,
  type GarmentRow,
  type FulfillmentStatus,
  type PaymentStatus,
  type GarmentOrderStatus,
  type JobStatus,
  type MeasurementMetricRow,
  type MeasurementReadingRow,
  type BodyMeasurementWithMetric,
  type GarmentMeasurementGroup,
  type GarmentTree,
  type AddressRow,
  type AdminSlotOption,
  type OrderAdjustmentRow,
} from "@/lib/admin-api";
import { ACQUISITION_FIELDS } from "@/lib/acquisition";
import { SlotPicker } from "@/components/admin/SlotPicker";
import { Chip } from "@/components/ui/Chip";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  downloadMeasurementJobPdf,
  type PdfSectionOptions,
  type StyleSelectionGroup,
  type StyleItemDetail,
} from "@/lib/job-pdf";
import { generateInvoicePdf, type InvoiceInput } from "@/lib/invoice-pdf";
import { GarmentSelectionSheet } from "@/components/admin/GarmentSelectionSheet";
import { GarmentOrderAssets } from "./GarmentOrderAssets";
import { MeasurementsSheet } from "./MeasurementsSheet";
import {
  DesignFromImage,
  aiResultToGarmentOrderItems,
} from "./DesignFromImage";
import type { AISelection, AIAddon } from "@/lib/admin-api";
import { ReceivePaymentModal } from "./ReceivePaymentModal";
import { VoicePlayer } from "@/components/style-captain/VoicePlayer";

// ─── Constants ────────────────────────────────────────────────────────────────

const FULFILLMENT_STATUSES: FulfillmentStatus[] = [
  "draft",
  "pending",
  "scheduled",
  "in_progress",
  "completed",
  "delivered",
  "cancelled",
];

const PAYMENT_STATUSES: PaymentStatus[] = [
  "pending",
  "paid",
  "partially_paid",
  "partially_refunded",
  "refunded",
  "failed",
];

const GARMENT_ORDER_STATUSES: GarmentOrderStatus[] = [
  "pending",
  "confirmed",
  "in_production",
  "ready",
  "delivered",
];

const JOB_STATUSES: JobStatus[] = [
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

const STATUS_STYLE: Record<string, string> = {
  // held visit time on an unconfirmed order — confirm it or wait for payment
  draft: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
  paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
  refunded: "bg-purple-100 text-purple-800",
  partial_refunded: "bg-orange-100 text-orange-800",
  partially_paid: "bg-teal-100 text-teal-800",
  partially_refunded: "bg-orange-100 text-orange-800",
  confirmed: "bg-teal-100 text-teal-800",
  in_production: "bg-indigo-100 text-indigo-800",
  ready: "bg-blue-100 text-blue-800",
  delivered: "bg-green-100 text-green-800",
};

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const cls = STATUS_STYLE[value] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block rounded-pill px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

/** Live balance due — mirrors backend _compute_balance_due:
 *  total_price − Σ captured payments + Σ refunds. */
function computeBalanceDue(
  txns: TransactionRow[],
  totalPrice: number | null | undefined,
): number {
  const captured = txns
    .filter((t) => t.type === "payment" && t.status === "captured")
    .reduce((s, t) => s + (t.amount ?? 0), 0);
  const refunded = txns
    .filter((t) => t.type === "refund" && (t.status === "refunded" || t.status === "captured"))
    .reduce((s, t) => s + (t.amount ?? 0), 0);
  return (totalPrice ?? 0) - captured + refunded;
}

/** Refundable amount — captured payments minus already-refunded. */
function computeRefundable(txns: TransactionRow[]): number {
  const captured = txns
    .filter((t) => t.type === "payment" && t.status === "captured")
    .reduce((s, t) => s + (t.amount ?? 0), 0);
  const refunded = txns
    .filter((t) => t.type === "refund" && (t.status === "refunded" || t.status === "captured"))
    .reduce((s, t) => s + (t.amount ?? 0), 0);
  return captured - refunded;
}

/**
 * Parse an OrderAdjustmentRow.label to display text. The column is JSONB, so
 * the generic tables API returns it as an object ({en: "Rush fee"}); tolerate
 * a JSON string or plain text too, and never return a non-string (rendering
 * the raw object crashes the page).
 */
function adjustmentLabel(
  raw: string | Record<string, string> | null | undefined,
): string {
  if (!raw) return "Adjustment";
  if (typeof raw === "object") {
    return raw.en ?? Object.values(raw)[0] ?? "Adjustment";
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.en ?? parsed[Object.keys(parsed)[0] ?? ""] ?? "Adjustment";
  } catch {
    return raw;
  }
}

// ─── Price breakdown construction (client-side) ──────────────────────────────
// Mirrors be/app/core/pricing.py compute_price_for_order: a base_price line,
// one line per priced item (snapshot leaf price), and garment-scoped
// adjustment lines. Subtotals are NOT recomputed here — they read straight
// from go.total_price / order.total_price, which the backend derives and
// resyncs. We only build the display lines.

interface BreakdownLine {
  key: string;
  label: string;
  amount: number; // signed RUPEES (not paise — the stale comment above lied)
  kind: "base" | "item" | "discount" | "fee";
}

// ─── Catalog price index (fallback for rows with no stamped price) ───────────
// Orders placed before price stamping landed (pre-fix MYOD rows) have
// garment_orders_items.price = NULL. The backend prices those live from the
// catalog; this index lets the client resolve the same additive prices
// (variation + sub-type / addon base + variation) so breakdown lines match
// go.total_price instead of silently dropping the row.

interface CatalogPriceEntry {
  /** Additive price contribution (rupees). */
  price: number;
  /** Catalog display label for the line, already composed ("A → B"). */
  label: string | null;
}

interface CatalogPriceIndex {
  variations: Map<string, CatalogPriceEntry>;
  variationTypes: Map<string, CatalogPriceEntry>;
  addons: Map<string, CatalogPriceEntry>;
  addonVariations: Map<string, CatalogPriceEntry>;
}

function buildCatalogPriceIndex(trees: GarmentTree[]): CatalogPriceIndex {
  const variations = new Map<string, CatalogPriceEntry>();
  const variationTypes = new Map<string, CatalogPriceEntry>();
  const addons = new Map<string, CatalogPriceEntry>();
  const addonVariations = new Map<string, CatalogPriceEntry>();
  for (const tree of trees) {
    for (const comp of tree.components ?? []) {
      const compLabel = catalogLabel(comp.labels, "");
      for (const v of comp.variations ?? []) {
        const parts = [compLabel, catalogLabel(v.labels, "")].filter(Boolean);
        variations.set(v.id, {
          price: v.price ?? 0,
          label: parts.length > 0 ? parts.join(" → ") : null,
        });
        for (const vt of v.variation_types ?? []) {
          variationTypes.set(vt.id, {
            price: vt.price ?? 0,
            label: catalogLabel(vt.labels, "") || null,
          });
        }
      }
    }
    for (const ao of tree.addons ?? []) {
      const aoLabel = catalogLabel(ao.labels, "");
      addons.set(ao.id, { price: ao.price ?? 0, label: aoLabel || null });
      for (const av of ao.variations ?? []) {
        const parts = [aoLabel, catalogLabel(av.labels, "")].filter(Boolean);
        addonVariations.set(av.id, {
          price: av.price ?? 0,
          label: parts.length > 0 ? parts.join(" · ") : null,
        });
      }
    }
  }
  return { variations, variationTypes, addons, addonVariations };
}

/** Resolve an item's live-catalog price + label when its stamped price is
 *  NULL. Returns null when the row can't be resolved (no index, catalog row
 *  gone) — the caller then keeps hiding it, matching the backend. */
function resolveLiveCatalogPrice(
  it: GarmentOrderItemRow,
  index: CatalogPriceIndex,
): { amount: number; label: string | null } | null {
  if (it.type === "variation") {
    const v = it.variation_id
      ? index.variations.get(it.variation_id)
      : undefined;
    const vt = it.variation_type_id
      ? index.variationTypes.get(it.variation_type_id)
      : undefined;
    if (!v && !vt) return null;
    const parts = [v?.label, vt?.label].filter(
      (x): x is string => Boolean(x),
    );
    return { amount: (v?.price ?? 0) + (vt?.price ?? 0), label: parts.join(" → ") || null };
  }
  if (it.type === "add_on") {
    const ao = it.addon_id ? index.addons.get(it.addon_id) : undefined;
    const av = it.addon_variation_id
      ? index.addonVariations.get(it.addon_variation_id)
      : undefined;
    if (!ao && !av) return null;
    const parts = [ao?.label, av?.label].filter(
      (x): x is string => Boolean(x),
    );
    return { amount: (ao?.price ?? 0) + (av?.price ?? 0), label: parts.join(" · ") || null };
  }
  return null;
}

/** Effective garment total, derived ADDITIVELY from the visible lines so the
 *  card's sub-lines always sum exactly to the displayed total:
 *    Σ (base + item lines) + Σ garment-scoped adjustments.
 *  This matches what the card renders and what the backend's
 *  adjustment-inclusive go.total_price resolves to once resynced — so we
 *  never mix the backend-inclusive number with a partial client sum (the old
 *  bug where listed lines didn't add up to the shown total). */
function effectiveGarmentTotal(
  go: GarmentOrderRow,
  items: GarmentOrderItemRow[] | undefined,
  basePrice: number | null,
  adjustments: OrderAdjustmentRow[],
  priceIndex?: CatalogPriceIndex | null,
): number {
  const lineSum = buildGarmentBreakdown(
    go,
    items,
    basePrice,
    priceIndex,
  ).reduce((s, ln) => s + ln.amount, 0);
  const adjSum = adjustments
    .filter((a) => a.garment_order_id === go.id)
    .reduce((s, a) => s + (a.amount ?? 0), 0);
  return lineSum + adjSum;
}

/** Build the per-garment-order breakdown lines from loaded data.
 *  Only base price + priced items — adjustments are rendered as their own
 *  block (with delete affordances) so the order is always:
 *  items → adjustments → total. */
function buildGarmentBreakdown(
  go: GarmentOrderRow,
  items: GarmentOrderItemRow[] | undefined,
  basePrice: number | null,
  priceIndex?: CatalogPriceIndex | null,
): BreakdownLine[] {
  const lines: BreakdownLine[] = [];

  // Base price line (only if the garment has one).
  if (basePrice != null && basePrice !== 0) {
    lines.push({
      key: `${go.id}-base`,
      label: "Base price",
      amount: basePrice,
      kind: "base",
    });
  }

  // One line per priced item. Matches backend `if amount:` gate — items
  // whose snapshot price is null/0 are hidden (unpriced or free selection),
  // except that a NULL price is first resolved from the catalog index (same
  // live fallback the backend uses for pre-stamping rows).
  for (const it of items ?? []) {
    let amount = it.price;
    let fallbackLabel: string | null = null;
    if (amount == null && priceIndex) {
      const resolved = resolveLiveCatalogPrice(it, priceIndex);
      if (resolved) {
        amount = resolved.amount;
        fallbackLabel = resolved.label;
      }
    }
    if (amount == null || amount === 0) continue;
    lines.push({
      key: it.id,
      label: fallbackLabel ?? itemDisplayLabel(it),
      amount,
      kind: "item",
    });
  }

  return lines;
}

/** Human label for a garment_orders_items row — prefers label_snapshot.
 *  The column is JSONB, so the API returns an object ({en: "…"}); a JSON
 *  string is also accepted. Never return a non-string — rendering the raw
 *  object crashes the page. */
function itemDisplayLabel(it: GarmentOrderItemRow): string {
  const snap = it.label_snapshot;
  if (snap) {
    if (typeof snap === "object") {
      const text = snap.en ?? Object.values(snap)[0];
      if (text) return String(text);
    } else {
      try {
        const parsed = JSON.parse(snap) as Record<string, string>;
        const text = parsed.en ?? parsed[Object.keys(parsed)[0] ?? ""];
        if (text) return text;
      } catch {
        return snap;
      }
    }
  }
  if (it.type === "add_on") return "Add-on";
  return "Selection";
}

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateId(id: string): string {
  return id.slice(0, 8);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Non-secure context or permission denied — execCommand fallback.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

// ─── Quote image — shareable PNG of the full price breakdown ─────────────────

const QUOTE_NAVY = "#083068";
const QUOTE_MUTED = "rgba(8, 48, 104, 0.55)";
const QUOTE_HAIRLINE = "rgba(8, 48, 104, 0.15)";
const QUOTE_TAPE = "#F89010";
const QUOTE_TAPE_DARK = "#A85010";

interface QuoteLine {
  label: string;
  amount: number; // signed rupees (discounts negative)
}
interface QuoteGarment {
  label: string;
  total: number;
  lines: QuoteLine[];
}

/** Draw a simple customer-shareable quote: one block per garment with its
 *  priced lines, order-level adjustments, and the grand total. Rendered at
 *  2× scale for crisp text. Returns a PNG blob for clipboard copy/download. */
async function renderQuoteImage(input: {
  orderNumber: string;
  dateText: string;
  garments: QuoteGarment[];
  orderAdjustments: QuoteLine[];
  total: number;
  paid: number;
  balanceDue: number;
}): Promise<Blob> {
  const W = 760;
  const PAD = 44;
  const SANS = '"Poppins","Inter",system-ui,sans-serif';
  const MONO = '"IBM Plex Mono",ui-monospace,Menlo,monospace';
  const money = (v: number) => (v < 0 ? "−" : "") + formatPrice(Math.abs(v));

  // Wait for next/font webfonts so the canvas uses the brand faces (canvas
  // silently falls back to system fonts if they aren't ready).
  try {
    await document.fonts.ready;
  } catch {
    // older engines — system fonts are fine
  }

  const measure = document.createElement("canvas").getContext("2d")!;
  function fit(text: string, font: string, max: number): string {
    measure.font = font;
    if (measure.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && measure.measureText(t + "…").width > max) {
      t = t.slice(0, -1);
    }
    return t + "…";
  }

  type Row =
    | { k: "garment"; label: string; price: string }
    | { k: "line"; label: string; price: string }
    | { k: "sect"; label: string }
    | { k: "divider" }
    | { k: "total"; label: string; price: string }
    | { k: "sub"; label: string; price: string; strong?: boolean };

  const rows: Row[] = [];
  input.garments.forEach((g, i) => {
    if (i > 0) rows.push({ k: "divider" });
    rows.push({ k: "garment", label: g.label, price: money(g.total) });
    for (const ln of g.lines) {
      rows.push({ k: "line", label: ln.label, price: money(ln.amount) });
    }
  });
  if (input.orderAdjustments.length > 0) {
    rows.push({ k: "divider" });
    rows.push({ k: "sect", label: "Order adjustments" });
    for (const ln of input.orderAdjustments) {
      rows.push({ k: "line", label: ln.label, price: money(ln.amount) });
    }
  }
  rows.push({ k: "total", label: "Total", price: money(input.total) });
  if (input.paid > 0) {
    rows.push({ k: "sub", label: "Paid", price: "− " + money(input.paid) });
    rows.push({
      k: "sub",
      label: "Balance due",
      price: money(input.balanceDue),
      strong: true,
    });
  }

  const ROW_H: Record<Row["k"], number> = {
    garment: 36,
    line: 26,
    sect: 34,
    divider: 30,
    total: 64,
    sub: 30,
  };
  const HEADER_H = 118;
  const FOOTER_H = 48;
  const H =
    HEADER_H + rows.reduce((s, r) => s + ROW_H[r.k], 0) + FOOTER_H;

  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);

  // Card background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header — wordmark left, order number + date right
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = QUOTE_NAVY;
  ctx.font = `700 30px ${SANS}`;
  ctx.fillText("DRAEP", PAD, 56);
  ctx.fillStyle = QUOTE_MUTED;
  ctx.font = `400 13px ${SANS}`;
  ctx.fillText("Price quote", PAD, 76);

  ctx.textAlign = "right";
  ctx.fillStyle = QUOTE_NAVY;
  ctx.font = `600 13px ${MONO}`;
  ctx.fillText(input.orderNumber, W - PAD, 52);
  ctx.fillStyle = QUOTE_MUTED;
  ctx.font = `400 12px ${SANS}`;
  ctx.fillText(input.dateText, W - PAD, 70);
  ctx.textAlign = "left";

  ctx.strokeStyle = QUOTE_HAIRLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER_H - 22);
  ctx.lineTo(W - PAD, HEADER_H - 22);
  ctx.stroke();

  const PRICE_X = W - PAD;
  const LABEL_MAX = W - PAD * 2 - 150;
  let y = HEADER_H;
  for (const r of rows) {
    if (r.k === "divider") {
      y += 8;
      ctx.strokeStyle = QUOTE_HAIRLINE;
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
      y += ROW_H.divider - 8;
      continue;
    }
    if (r.k === "total") {
      // Tape-gradient accent rule above the grand total (Brand Book: the
      // tape gradient is reserved for the grand-total accent only).
      const grad = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
      grad.addColorStop(0, QUOTE_TAPE);
      grad.addColorStop(1, QUOTE_TAPE_DARK);
      ctx.fillStyle = grad;
      ctx.fillRect(PAD, y + 8, W - PAD * 2, 3);
      ctx.fillStyle = QUOTE_NAVY;
      ctx.font = `700 18px ${SANS}`;
      ctx.textAlign = "left";
      ctx.fillText(r.label, PAD, y + 40);
      ctx.font = `700 22px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillText(r.price, PRICE_X, y + 41);
      ctx.textAlign = "left";
      y += ROW_H.total;
      continue;
    }
    if (r.k === "garment") {
      ctx.fillStyle = QUOTE_NAVY;
      ctx.font = `600 17px ${SANS}`;
      ctx.fillText(fit(r.label, `600 17px ${SANS}`, LABEL_MAX), PAD, y - 8);
      ctx.font = `600 17px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillText(r.price, PRICE_X, y - 8);
      ctx.textAlign = "left";
      y += ROW_H.garment;
      continue;
    }
    if (r.k === "sect") {
      ctx.fillStyle = QUOTE_MUTED;
      ctx.font = `600 11px ${SANS}`;
      ctx.fillText(r.label.toUpperCase(), PAD, y - 8);
      y += ROW_H.sect;
      continue;
    }
    // "line" | "sub"
    const sub = r.k === "sub" ? r : null;
    ctx.fillStyle = sub?.strong ? QUOTE_NAVY : QUOTE_MUTED;
    const font = sub
      ? `${sub.strong ? "600 15px" : "400 14px"} ${SANS}`
      : `400 13.5px ${SANS}`;
    ctx.font = font;
    ctx.fillText(fit(r.label, font, LABEL_MAX), PAD + 14, y - 8);
    ctx.fillStyle = QUOTE_NAVY;
    ctx.font = sub
      ? `${sub.strong ? "600 15px" : "400 14px"} ${MONO}`
      : `400 13.5px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(r.price, PRICE_X, y - 8);
    ctx.textAlign = "left";
    y += sub ? ROW_H.sub : ROW_H.line;
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode PNG"))),
      "image/png",
    );
  });
}

/** Copy a PNG blob to the clipboard; resolves false when the browser
 *  doesn't support image clipboard writes (caller should download instead). */
async function copyPngToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      return false;
    }
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a captain's display name from the loaded captains list by id. */
function captainNameById(
  captains: UserRow[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const c = captains.find((x) => x.id === id);
  return c?.name ?? c?.phone ?? truncateId(c!.id) ?? null;
}

/** Parse an address's jsonb `coordinates` ({"lat": number, "lng": number}). */
function parseCoords(
  raw: unknown,
): { lat: number; lng: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng } = raw as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

// ─── Small inline-editable field ──────────────────────────────────────────────

function EditableNumber({
  value,
  onSave,
  label,
}: {
  value: number | null | undefined;
  onSave: (v: number | null) => Promise<void>;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  async function save() {
    setSaving(true);
    try {
      const n = draft.trim() === "" ? null : Number(draft);
      if (n !== null && isNaN(n)) throw new Error("Invalid number");
      await onSave(n);
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-28 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-sm focus:border-ink-navy focus:outline-none"
          autoFocus
          disabled={saving}
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-ink-navy px-2 py-1 text-xs font-medium text-chalk-white hover:bg-ink-navy/90 disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
        <button
          onClick={() => {
            setDraft(String(value ?? ""));
            setEditing(false);
          }}
          className="rounded-md border border-hairline-strong px-2 py-1 text-xs text-muted hover:bg-mist-navy"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="font-mono text-sm text-ink hover:text-tape hover:underline"
      title={label}
    >
      {formatPrice(value ?? null)}
    </button>
  );
}

// ─── Inline-editable text field (auto-saves on blur) ─────────────────────────

function EditableTextField({
  label,
  value,
  onSave,
  placeholder,
  chips,
}: {
  label: string;
  value: string | null | undefined;
  onSave: (v: string | null) => Promise<boolean | void>;
  placeholder?: string;
  /** Optional suggestion chips. Tap sets+saves; tap active clears. */
  chips?: readonly string[];
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit(next: string) {
    const v = next.trim() === "" ? null : next.trim();
    if (v === (value ?? null)) return;
    setSaving(true);
    try {
      await onSave(v);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
      setDraft(value ?? "");
    } finally {
      setSaving(false);
    }
  }

  async function handleBlur() {
    if (draft.trim() === (value ?? "")) return;
    await commit(draft);
  }

  function tapChip(opt: string) {
    const next = draft === opt ? "" : opt;
    setDraft(next);
    void commit(next);
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        {label} {saving && <span className="text-[10px]">(saving…)</span>}
      </label>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder ?? `Enter ${label.toLowerCase()}…`}
        disabled={saving}
        className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] text-ink focus:border-ink-navy focus:outline-none disabled:opacity-50"
      />
      {chips && chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((opt) => (
            <Chip
              key={opt}
              selected={draft === opt}
              ariaLabel={`${label}: ${opt}`}
              onClick={() => tapChip(opt)}
              className="min-h-[26px] px-2 py-0.5 text-[10px]"
            >
              {opt}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Save button with inline saving / saved / failed states ──────────────────

function SaveButton({
  onSave,
  label,
  className = "",
}: {
  /** Perform the save; resolve false (or throw) to signal failure. */
  onSave: () => Promise<boolean | void>;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );

  async function handleClick() {
    if (state === "saving") return;
    setState("saving");
    let ok = true;
    try {
      ok = (await onSave()) !== false;
    } catch {
      ok = false;
    }
    setState(ok ? "saved" : "failed");
    setTimeout(() => setState("idle"), ok ? 1500 : 2500);
  }

  const styles =
    state === "saved"
      ? "bg-green-700 text-white"
      : state === "failed"
        ? "border border-red-200 bg-red-50 text-red-700"
        : "bg-ink-navy text-chalk-white hover:bg-ink-navy/90 disabled:cursor-wait disabled:opacity-70";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "saving"}
      className={`inline-flex min-w-[5rem] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${styles} ${className}`}
    >
      {state === "saving" && (
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none">
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-25"
          />
          <path
            d="M14 8A6 6 0 0 0 8 2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
      {state === "saved" && (
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 8.5 6.5 12 13 4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "failed"
            ? "Failed"
            : label}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = params.id;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [customer, setCustomer] = useState<UserRow | null>(null);
  const [address, setAddress] = useState<AddressRow | null>(null);
  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [garmentOrders, setGarmentOrders] = useState<GarmentOrderRow[]>([]);
  const [jobs, setJobs] = useState<MeasurementJobRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [itemsByGO, setItemsByGO] = useState<Map<string, GarmentOrderItemRow[]>>(
    new Map(),
  );
  // Admin discounts/fees. garment_order_id === null => whole-order scope.
  const [adjustments, setAdjustments] = useState<OrderAdjustmentRow[]>([]);
  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [garmentMap, setGarmentMap] = useState<Map<string, GarmentRow>>(
    new Map(),
  );
  // Catalog prices for item rows whose stamped price is NULL (pre-stamping
  // MYOD orders) — lets the breakdown sum every item like the backend does.
  const [priceIndex, setPriceIndex] = useState<CatalogPriceIndex | null>(
    null,
  );
  const [showNewGOForm, setShowNewGOForm] = useState(false);
  const [newGOGarmentId, setNewGOGarmentId] = useState("");
  const [newGONote, setNewGONote] = useState("");
  const [creatingGO, setCreatingGO] = useState(false);
  const [deletingGOId, setDeletingGOId] = useState<string | null>(null);
  const [editingGOId, setEditingGOId] = useState<string | null>(null);

  // ── AI "Upload Reference" design flow per garment order ───────────────────
  // The flow itself lives inside the GarmentSelectionSheet ("Upload reference"
  // tab). This state only tracks what the AI applied, so the sheet seeds from
  // the AI picks instead of the saved rows.
  const [goAIPrefill, setGoAIPrefill] = useState<
    Record<string, { items: GarmentOrderItemRow[]; imageUrl: string }>
  >({});
  // Bumps per AI turn so the selections sheet reseeds with fresh items.
  const [goAIIterations, setGoAIIterations] = useState<Record<string, number>>({});
  // Stable AI thread id per GO (shared upload-zone → composer handoff).
  const [goThreadIds] = useState<Record<string, string>>({});

  // ── New measurement job form state ────────────────────────────────────────
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [newJobStatus, setNewJobStatus] = useState<JobStatus>("scheduled");
  const [newJobCaptainId, setNewJobCaptainId] = useState("");
  const [newJobSlotDate, setNewJobSlotDate] = useState<string | null>(null);
  const [newJobSlot, setNewJobSlot] = useState<AdminSlotOption | null>(null);
  const [newJobNotes, setNewJobNotes] = useState("");
  const [creatingJob, setCreatingJob] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ── PDF download state ─────────────────────────────────────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  // ── Invoice generation state (single client-side PDF, tax-inclusive total) ─
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  // Copy-quote image builder (canvas render + clipboard write).
  const [quoteBusy, setQuoteBusy] = useState(false);
  // Customization sheet (section toggles). Defaults to all-on so the first
  // download matches the pre-customization report; the user turns OFF what
  // they don't want. `pdfSheetOpen` gates the bottom sheet itself.
  const [pdfSheetOpen, setPdfSheetOpen] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<PdfSectionOptions>({
    customerDetails: true,
    measurementDetails: true,
    designDetails: true,
    fabricDetails: true,
    invoice: true,
  });
  // Garment orders the user DESELECTED in the PDF sheet. Empty = include
  // every garment order (the default). Kept as an exclusion set so newly
  // added garment orders are included without any sync logic.
  const [pdfExcludedGoIds, setPdfExcludedGoIds] = useState<Set<string>>(
    () => new Set(),
  );

  // ── Manage-Measurements sheets ─────────────────────────────────────────────
  // One sheet component serves both entry points: the per-job "Manage
  // Measurements" button (body + every garment) and the per-garment
  // "Measurements" button on a garment order card (that garment only).
  const [measurementsJobId, setMeasurementsJobId] = useState<string | null>(null);
  // garment-scoped sheet target — reads/writes go to the order's latest job.
  const [goMeasurements, setGoMeasurements] = useState<string | null>(null);

  // ── Inline reschedule state (per-job collapsible slot picker) ───────────────
  const [rescheduleJobId, setRescheduleJobId] = useState<string | null>(null);
  // Per-job slot drafts: jobId → { date, slot }
  const [rescheduleDrafts, setRescheduleDrafts] = useState<
    Record<string, { date: string | null; slot: AdminSlotOption | null }>
  >({});

  // ── Adjustment add-row drafts. One shared shape, keyed by a scope id:
  // "order" for the whole-order block, or the garment_order_id per-GO block.
  const [adjDrafts, setAdjDrafts] = useState<
    Record<
      string,
      { type: "discount" | "fee"; label: string; rupees: string }
    >
  >({});
  // Per-scope add loading + per-row delete loading. scopeKey === "creating:<scopeKey>"
  // means that block's Add button is submitting; an id means that row is deleting.
  const [adjBusy, setAdjBusy] = useState<string | null>(null);

  // Receive-payment / refund modal.
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentModalTab, setPaymentModalTab] = useState<"receive" | "refund">("receive");

  // Copy-login-link busy flag (mirrors the admin user page CTA).
  const [loginLinkBusy, setLoginLinkBusy] = useState(false);

  function flash(msg: string) {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 2000);
  }

  // ── Copy user URL (open this order in the customer's logged-in app) ───────
  async function handleCopyUserLoginLink() {
    if (!order || !customer || loginLinkBusy) return;
    setLoginLinkBusy(true);
    try {
      const out = await createUserLoginLink(customer.id);
      const url = `${window.location.origin}/app/orders/${order.id}?token=${encodeURIComponent(out.token)}`;
      const copied = await copyToClipboard(url);
      if (copied) {
        flash("User URL copied — opens this order, valid for 30 days");
      } else {
        // Last resort: let the admin copy manually.
        window.prompt("Copy this user URL (valid 30 days):", url);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not create user URL");
    } finally {
      setLoginLinkBusy(false);
    }
  }

  // ── Emit sidebar items ────────────────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "← Back to Orders",
              active: false,
              onClick: () => router.push("/admin/orders"),
            },
          ],
        },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("admin-sidebar-update", { detail: null }),
      );
    };
  }, [router]);

  // ── Load order ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Load order
      const { rows: orderRows } = await fetchTableRows<OrderRow>("orders", {
        filters: { id: orderId },
        perPage: 1,
      });
      if (orderRows.length === 0) {
        setError("Order not found");
        return;
      }
      const ord = orderRows[0];
      setOrder(ord);

      // 2. Load customer + captain + captains list + garments (in parallel)
      const [captainsList, garmentList] = await Promise.all([
        fetchStyleCaptains(),
        fetchGarments(),
      ]);
      setCaptains(captainsList);
      setGarments(garmentList);
      setGarmentMap(new Map(garmentList.map((g) => [g.id, g])));

      if (ord.user_id) {
        fetchUserById(ord.user_id)
          .then(setCustomer)
          .catch(() => {});
      }
      if (ord.address_id) {
        fetchTableRows<AddressRow>("addresses", {
          filters: { id: ord.address_id },
          perPage: 1,
        })
          .then(({ rows }) => setAddress(rows[0] ?? null))
          .catch(() => {});
      }

      // 3. Load garment orders, jobs, transactions, adjustments in parallel
      const [gos, mj, tx, adj] = await Promise.all([
        fetchGarmentOrdersForOrder(orderId),
        fetchJobsForOrder(orderId),
        fetchTransactionsForOrder(orderId),
        fetchOrderAdjustments(orderId),
      ]);
      // Items must land in the SAME render as their garment orders: the
      // selections sheet seeds once from them on open, so a card that
      // renders before its items exist seeds catalog defaults — and a
      // "Save changes" would overwrite the real rows. Per-GO catch keeps
      // one failed fetch from blocking the rest (that GO just reads empty).
      const itemEntries = await Promise.all(
        gos.map(async (go) => {
          try {
            return [go.id, await fetchGarmentOrderItems(go.id)] as const;
          } catch {
            return [go.id, [] as GarmentOrderItemRow[]] as const;
          }
        }),
      );
      setGarmentOrders(gos);
      setItemsByGO(new Map(itemEntries)); // batched with the line above
      setJobs(mj);
      setTransactions(tx);
      setAdjustments(adj);

      // Catalog price index for the breakdown — one tree per unique garment
      // (public endpoint). Rows without a stamped price (pre-fix MYOD
      // orders) resolve their price/label from here, mirroring the
      // backend's live-catalog fallback. Per-garment catch: a failed tree
      // just leaves that garment's unpriced rows hidden.
      const trees = await Promise.all(
        [
          ...new Set(
            gos
              .map((g) => g.garment_id)
              .filter((id): id is string => Boolean(id)),
          ),
        ].map(async (gid) => {
          try {
            return await fetchGarmentTree(gid);
          } catch {
            return null;
          }
        }),
      );
      setPriceIndex(
        buildCatalogPriceIndex(
          trees.filter((t): t is GarmentTree => t !== null),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Load items for garment orders ──────────────────────────────────────────
  // Backstop only: loadAll() now fetches every GO's items in the same render
  // batch as the GOs themselves, and handleCreateGarmentOrder seeds new GOs
  // with []. This fills in any GO that still reaches state without items
  // (e.g. a future path adding rows directly), so the breakdown and the
  // selections sheet never sit on missing data.
  useEffect(() => {
    for (const go of garmentOrders) {
      if (!itemsByGO.has(go.id)) {
        fetchGarmentOrderItems(go.id)
          .then((items) => {
            setItemsByGO((prev) => {
              const next = new Map(prev);
              next.set(go.id, items);
              return next;
            });
          })
          .catch(() => {
            // Record an empty array so we don't retry forever on failure —
            // the breakdown shows "No priced items yet." instead of spinning.
            setItemsByGO((prev) => {
              if (prev.has(go.id)) return prev;
              const next = new Map(prev);
              next.set(go.id, []);
              return next;
            });
          });
      }
    }
    // itemsByGO is read here only to seed the initial pass; the
    // setItemsByGO updaters are idempotent so re-runs are harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garmentOrders]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleUpdateOrderField(
    patch: Partial<OrderRow>,
  ): Promise<boolean> {
    if (!order) return false;
    try {
      await updateOrder(order.id, patch);
      setOrder({ ...order, ...patch });
      flash("Order updated");
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
      return false;
    }
  }

  async function handleUpdateGarmentOrder(
    goId: string,
    patch: Partial<GarmentOrderRow>,
  ): Promise<boolean> {
    try {
      await updateGarmentOrder(goId, patch);
      setGarmentOrders((prev) =>
        prev.map((g) => (g.id === goId ? { ...g, ...patch } : g)),
      );
      flash("Garment order updated");
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
      return false;
    }
  }

  async function handleUpdateJob(
    jobId: string,
    patch: Partial<MeasurementJobRow>,
  ) {
    try {
      await updateMeasurementJob(jobId, patch);
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
      );
      flash("Measurement job updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  }

  /** Promote the order's held visit time(s) to real captain bookings. */
  async function handleConfirmSlot() {
    try {
      await confirmOrderSlot(orderId);
      flash("Held slot confirmed — captain assigned");
      loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not confirm slot");
    }
  }

  // ── AI design prefill (apply mode) ─────────────────────────────────────────
  /** Apply an AI design result to a garment order (opens the selections
   *  sheet prefilled with the AI picks). */
  function applyGODesign(
    goId: string,
    selections: AISelection[],
    addons: AIAddon[],
    imageUrl: string,
  ) {
    const items = aiResultToGarmentOrderItems(selections, addons, goId);
    setGoAIPrefill((prev) => ({ ...prev, [goId]: { items, imageUrl } }));
    setGoAIIterations((prev) => ({
      ...prev,
      [goId]: (prev[goId] ?? 0) + 1,
    }));
    // Open the selections sheet on the AI picks so the admin can review,
    // adjust and save them.
    setEditingGOId(goId);
  }

  /**
   * Append image URLs to garment_orders.assets_shared (deduped) and persist
   * right away, so uploads from the assets gallery and reference images
   * picked during AI selection both land on the order page + PDF without a
   * separate save step.
   */
  async function attachGOImageUrls(goId: string, urls: string[]) {
    const add = urls.filter(Boolean);
    if (add.length === 0) return;
    const go = garmentOrders.find((g) => g.id === goId);
    const existing = Array.isArray(go?.assets_shared) ? go!.assets_shared : [];
    const next = Array.from(new Set([...existing, ...add].filter(Boolean)));
    if (next.length === existing.length) return; // nothing new
    // Optimistically update UI.
    setGarmentOrders((prev) =>
      prev.map((g) => (g.id === goId ? { ...g, assets_shared: next } : g)),
    );
    try {
      await updateTableRow("garment_orders", goId, {
        assets_shared: next.length > 0 ? next : null,
      });
    } catch (e) {
      // Roll back on failure so the UI doesn't lie about persistence.
      setGarmentOrders((prev) =>
        prev.map((g) => (g.id === goId ? { ...g, assets_shared: existing } : g)),
      );
      flash(e instanceof Error ? e.message : "Failed to save reference image");
    }
  }

  /** A reference image was uploaded at selection time for an existing garment
   * order (apply mode) — see attachGOImageUrls. */
  async function applyGOImageUrl(goId: string, imageUrl: string) {
    await attachGOImageUrls(goId, [imageUrl]);
  }

  /** Remove one image URL from garment_orders.assets_shared (persist immediately). */
  async function detachGOImageUrl(goId: string, url: string) {
    const go = garmentOrders.find((g) => g.id === goId);
    const existing = Array.isArray(go?.assets_shared) ? go!.assets_shared : [];
    if (!existing.includes(url)) return;
    const next = existing.filter((u) => u !== url);
    setGarmentOrders((prev) =>
      prev.map((g) => (g.id === goId ? { ...g, assets_shared: next } : g)),
    );
    try {
      await updateTableRow("garment_orders", goId, {
        assets_shared: next.length > 0 ? next : null,
      });
    } catch (e) {
      setGarmentOrders((prev) =>
        prev.map((g) => (g.id === goId ? { ...g, assets_shared: existing } : g)),
      );
      flash(e instanceof Error ? e.message : "Failed to remove image");
    }
  }

  /** Lazily create + return a stable AI thread id for a garment order. */
  function ensureGOThreadId(goId: string): string {
    if (!goThreadIds[goId]) {
      goThreadIds[goId] = `gothread-${goId.slice(0, 8)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    }
    return goThreadIds[goId];
  }

  // ── Create a new garment order ─────────────────────────────────────────────
  async function handleCreateGarmentOrder() {
    if (!order) return;
    if (!newGOGarmentId) {
      alert("Please select a garment");
      return;
    }
    setCreatingGO(true);
    try {
      // total_price is derived on the backend — never set it directly.
      const created = await createGarmentOrder({
        order_id: orderId,
        garment_id: newGOGarmentId,
        user_note: newGONote.trim() || null,
        status: "pending",
      });
      setGarmentOrders((prev) => [created, ...prev]);
      // A brand-new GO has no saved items — seed the empty list so the
      // auto-opened sheet reads as "loaded" (defaults are the correct seed
      // here) rather than triggering the still-loading gate below.
      setItemsByGO((prev) => {
        const next = new Map(prev);
        next.set(created.id, []);
        return next;
      });
      // Auto-open the selections sheet so the admin can style the garment
      setEditingGOId(created.id);
      // reset form
      setShowNewGOForm(false);
      setNewGOGarmentId("");
      setNewGONote("");
      flash("Garment order created — pick its style in the sheet");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create garment order");
    } finally {
      setCreatingGO(false);
    }
  }

  // ── Create a new measurement job for this order ───────────────────────────
  async function handleCreateJob() {
    if (!order) return;
    setCreatingJob(true);
    try {
      const created = await createMeasurementJob({
        order_id: orderId,
        user_id: order.user_id,
        status: newJobStatus,
        style_captain_id: newJobCaptainId || null,
        scheduled_at: newJobSlot?.start_at ?? null,
        notes: newJobNotes.trim() || null,
      });
      setJobs((prev) => [created, ...prev]);
      // reset form
      setShowNewJobForm(false);
      setNewJobStatus("scheduled");
      setNewJobCaptainId("");
      setNewJobSlotDate(null);
      setNewJobSlot(null);
      setNewJobNotes("");
      flash("Measurement job created");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create job");
    } finally {
      setCreatingJob(false);
    }
  }

  // ── Delete a garment order ─────────────────────────────────────────────────
  async function handleDeleteGarmentOrder(goId: string) {
    if (!confirm("Delete this garment order and all its items? This cannot be undone.")) {
      return;
    }
    setDeletingGOId(goId);
    try {
      await deleteGarmentOrder(goId);
      setGarmentOrders((prev) => prev.filter((g) => g.id !== goId));
      setItemsByGO((prev) => {
        const next = new Map(prev);
        next.delete(goId);
        return next;
      });
      flash("Garment order deleted");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete garment order");
    } finally {
      setDeletingGOId(null);
    }
  }

  // ── Adjustment (discount / fee) handlers ───────────────────────────────────
  // Adjustments are signed paise rows in `order_adjustments`. A write goes
  // through the generic table API; the backend resync hook recomputes the
  // derived order.total_price after every create/update/delete. We also
  // re-fetch the order row so the Total Price card reflects the new total.
  async function refreshOrderTotal() {
    if (!order) return;
    const { rows } = await fetchTableRows<OrderRow>("orders", {
      filters: { id: order.id },
      perPage: 1,
    });
    if (rows[0]) setOrder(rows[0]);
    // go.total_price is garment-adjustment-inclusive on the backend; refresh
    // garment orders too so per-GO headers stay correct.
    setGarmentOrders(await fetchGarmentOrdersForOrder(order.id));
    // Payments/refunds change the ledger → re-fetch transactions so the table
    // and the derived balance/payment-status stay current.
    setTransactions(await fetchTransactionsForOrder(order.id));
  }

  async function handleCreateAdjustment(
    input: {
      garment_order_id: string | null;
      type: "discount" | "fee";
      label: string;
      amountRupees: number;
    },
    scopeKey: string,
  ) {
    if (!order) return;
    // Prices across this stack are stored in RUPEES (not paise) — the FE
    // formatPrice() treats its input as rupees and BASE_STITCHING=600 shows
    // as ₹600. The backend amount column is the same unit. So we store the
    // rupee value directly; no ×100. Signed: discounts negative, fees positive.
    const signed =
      input.type === "discount" ? -Math.abs(input.amountRupees) : Math.abs(input.amountRupees);
    setAdjBusy(`creating:${scopeKey}`);
    try {
      await createOrderAdjustment({
        order_id: order.id,
        garment_order_id: input.garment_order_id,
        type: input.type,
        amount: signed,
        // Object, not JSON.stringify: the generic table API serializes JSON
        // columns itself, so a pre-stringified value lands double-encoded
        // (a JSON string) and the label readers can't unwrap it.
        label: { en: input.label || "Adjustment" },
        target_type: input.garment_order_id ? "garment_order" : "order",
        source: "manual",
      });
      setAdjustments(await fetchOrderAdjustments(order.id));
      await refreshOrderTotal();
      flash(
        `${input.type === "discount" ? "Discount" : "Fee"} of ₹${Math.abs(input.amountRupees)} added`,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Add adjustment failed");
    } finally {
      setAdjBusy(null);
    }
  }

  async function handleDeleteAdjustment(id: string) {
    if (!order) return;
    const ok = window.confirm("Remove this adjustment? This cannot be undone.");
    if (!ok) return;
    setAdjBusy(id);
    try {
      await deleteOrderAdjustment(id);
      setAdjustments((prev) => prev.filter((a) => a.id !== id));
      await refreshOrderTotal();
      flash("Adjustment removed");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete adjustment failed");
    } finally {
      setAdjBusy(null);
    }
  }

  /** Reusable adjustments list + add-row. garmentOrderId=null => order scope. */
  function renderAdjustmentBlock(
    scopeKey: string,
    garmentOrderId: string | null,
  ) {
    const rows = adjustments.filter((a) =>
      garmentOrderId === null
        ? a.garment_order_id === null
        : a.garment_order_id === garmentOrderId,
    );
    const draft = adjDrafts[scopeKey] ?? {
      type: "discount" as const,
      label: "",
      rupees: "",
    };
    const setDraft = (patch: Partial<typeof draft>) =>
      setAdjDrafts((prev) => ({
        ...prev,
        [scopeKey]: { ...draft, ...patch },
      }));

    const creating = adjBusy === `creating:${scopeKey}`;
    const canSubmit =
      !creating &&
      !adjBusy &&
      draft.rupees !== "" &&
      !Number.isNaN(Number(draft.rupees)) &&
      Number(draft.rupees) > 0;

    return (
      <div className="mt-2">
        {rows.length > 0 ? (
          <div className="space-y-1">
            {rows.map((a) => {
              const amt = a.amount ?? 0;
              const isDiscount = amt < 0 || a.type === "discount";
              const rowBusy = adjBusy === a.id;
              return (
                <div
                  key={a.id}
                  className={`flex items-center justify-between rounded-md border border-hairline bg-mist-navy/20 px-2.5 py-1.5 transition ${
                    rowBusy ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                        isDiscount
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {isDiscount ? "Discount" : "Fee"}
                    </span>
                    <span className="truncate text-xs text-ink">
                      {adjustmentLabel(a.label)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`font-mono text-xs ${
                        isDiscount ? "text-green-700" : "text-amber-700"
                      }`}
                    >
                      {formatPrice(amt)}
                    </span>
                    <button
                      onClick={() => handleDeleteAdjustment(a.id)}
                      disabled={rowBusy || !!adjBusy}
                      title="Remove adjustment"
                      aria-label="Remove adjustment"
                      className="flex h-5 w-5 items-center justify-center rounded text-red-500 transition hover:bg-red-50 disabled:opacity-40"
                    >
                      {rowBusy ? (
                        <svg
                          className="h-3 w-3 animate-spin text-muted"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                          <path d="M3 5h10M6 5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V5M5 5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-1 text-[11px] text-muted">No adjustments.</div>
        )}

        {/* Add-row */}
        <div
          className={`mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-hairline-strong px-2.5 py-2 transition ${
            creating ? "pointer-events-none bg-mist-navy/30" : ""
          }`}
        >
          <select
            value={draft.type}
            onChange={(e) =>
              setDraft({ type: e.target.value as "discount" | "fee" })
            }
            disabled={creating}
            className="rounded-md border border-hairline bg-white px-2 py-1 text-xs text-ink disabled:opacity-60"
          >
            <option value="discount">Discount</option>
            <option value="fee">Fee</option>
          </select>
          <input
            type="text"
            value={draft.label}
            onChange={(e) => setDraft({ label: e.target.value })}
            disabled={creating}
            placeholder="Label (e.g. Festive discount)"
            className="min-w-[10rem] flex-1 rounded-md border border-hairline bg-white px-2 py-1 text-xs text-ink disabled:opacity-60"
          />
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted">₹</span>
            <input
              type="number"
              min="0"
              step="1"
              value={draft.rupees}
              onChange={(e) => setDraft({ rupees: e.target.value })}
              disabled={creating}
              placeholder="Amount"
              className="w-20 rounded-md border border-hairline bg-white px-2 py-1 text-xs text-ink disabled:opacity-60"
            />
          </div>
          <button
            onClick={async () => {
              const rupees = Number(draft.rupees);
              if (!draft.rupees || Number.isNaN(rupees) || rupees <= 0) {
                alert("Enter a positive amount in ₹.");
                return;
              }
              try {
                await handleCreateAdjustment(
                  {
                    garment_order_id: garmentOrderId,
                    type: draft.type,
                    label: draft.label.trim(),
                    amountRupees: Math.round(rupees),
                  },
                  scopeKey,
                );
                // Only clear the draft on success — keep it on failure so the
                // user can retry/edit instead of retyping.
                setAdjDrafts((prev) => {
                  const next = { ...prev };
                  delete next[scopeKey];
                  return next;
                });
              } catch {
                /* handleCreateAdjustment already alerts */
              }
            }}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-md bg-ink-navy px-2.5 py-1 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? (
              <>
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                  <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Adding…
              </>
            ) : (
              "+ Add"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Resolve garment display label ──────────────────────────────────────────
  function garmentDisplayLabel(garmentId: string | null | undefined): string {
    if (!garmentId) return "Unknown garment";
    const g = garmentMap.get(garmentId);
    if (g) return garmentLabel(g);
    return `Garment ${truncateId(garmentId)}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PDF DOWNLOAD — assembles cover + (optional) body + garment + style pages
  // + the embedded tax-invoice page, gated by the user's section toggles and
  // garment-order deselection.
  // ──────────────────────────────────────────────────────────────────────────

  /** Build the tax-invoice input from loaded order data — the same
   *  InvoiceInput the standalone "Download Invoice PDF" button uses, so the
   *  report's embedded invoice page and the standalone invoice always
   *  reconcile. `garmentRows` are the (already deselection-filtered) garment
   *  orders to bill; `getItems` resolves each one's item rows. */
  function buildInvoiceInput(
    garmentRows: GarmentOrderRow[],
    getItems: (goId: string) => GarmentOrderItemRow[] | undefined,
  ): InvoiceInput {
    // One line per garment order — effective (adjustment-inclusive) total,
    // the same number the "Order total" card shows for each garment.
    const garmentLines = garmentRows.map((go) => ({
      label: garmentDisplayLabel(go.garment_id),
      total: effectiveGarmentTotal(
        go,
        getItems(go.id),
        garmentMap.get(go.garment_id)?.base_price ?? null,
        adjustments,
        priceIndex,
      ),
    }));

    // Order-level adjustments (garment_order_id IS NULL) so the subtotal
    // reconciles to the grand total. Discounts are already negative.
    const adjustmentLines = adjustments
      .filter((a) => a.garment_order_id === null)
      .map((a) => ({
        label: `${a.type === "discount" ? "Discount" : "Fee"}: ${adjustmentLabel(a.label)}`,
        total: a.amount ?? 0,
      }));

    // One "Payment Made" row per captured payment, carrying the note that
    // was recorded with it (transactions.metadata.note).
    const payments = transactions
      .filter((t) => t.type === "payment" && t.status === "captured")
      .map((t) => ({
        amount: t.amount ?? 0,
        note:
          t.metadata &&
          typeof t.metadata === "object" &&
          "note" in t.metadata &&
          t.metadata.note != null
            ? String(t.metadata.note)
            : null,
      }));

    return {
      invoiceNumber: order?.order_number
        ? `INV-${order.order_number}`
        : `INV-${truncateId(order?.id ?? "")}`,
      orderNumber: order?.order_number ?? (order ? truncateId(order.id) : null),
      customer,
      address,
      garmentLines,
      adjustmentLines,
      payments,
    };
  }

  /** Generate the PDF with the user's selected sections. Called from the
   *  customization bottom sheet's "Generate PDF" footer button. */
  async function handleGeneratePdf(opts: PdfSectionOptions) {
    if (!order) return;
    setPdfLoading(true);
    setPdfProgress("Preparing…");
    try {
      // The measurement_jobs table has a unique constraint on order_id, so
      // there's at most one job for this order. If none exists, we synthesize
      // a minimal "no-job" job so the cover page renders and the style pages
      // still come through.
      const jobForPdf: MeasurementJobRow =
        jobs[0] ?? {
          id: `order-${order.id}`,
          user_id: order.user_id,
          order_id: order.id,
          style_captain_id: null,
          status: null,
          scheduled_at: null,
          performed_at: null,
          notes: "(No measurement job created yet)",
        };

      setPdfProgress("Loading measurement catalog…");
      let metricsList: MeasurementMetricRow[] = [];
      try {
        metricsList = await fetchMeasurementMetrics();
      } catch { /* proceed with empty */ }

      setPdfProgress("Loading measurements…");
      let readingsList: MeasurementReadingRow[] = [];
      try {
        readingsList = await fetchJobReadings(jobForPdf.id);
      } catch { /* proceed with empty */ }

      setPdfProgress("Loading garment details…");
      let goList: Awaited<ReturnType<typeof fetchOrderGarmentOrders>> = [];
      let materialsList: Awaited<ReturnType<typeof fetchOrderGarmentMaterials>> = [];
      try {
        [goList, materialsList] = await Promise.all([
          fetchOrderGarmentOrders(order.id).catch(() => [] as typeof goList),
          fetchOrderGarmentMaterials(order.id).catch(() => [] as typeof materialsList),
        ]);
      } catch { /* proceed with empty */ }

      // Apply the user's garment deselection (PDF sheet). Everything below —
      // garment pages, style pages, and the invoice lines — reflects only the
      // selected garment orders.
      const selectedGoList = goList.filter((go) => !pdfExcludedGoIds.has(go.id));

      // Items per garment order (for style pages + invoice lines) — wrapped
      // per-GO so one failure doesn't block others
      setPdfProgress("Loading style selections…");
      const itemsByGOId = new Map<string, GarmentOrderItemRow[]>();
      await Promise.all(
        selectedGoList.map(async (go) => {
          const cached = itemsByGO.get(go.id);
          if (cached) {
            itemsByGOId.set(go.id, cached);
          } else {
            try {
              const items = await fetchGarmentOrderItems(go.id);
              itemsByGOId.set(go.id, items);
            } catch {
              itemsByGOId.set(go.id, []);
            }
          }
        }),
      );

      // Body measurements paired with readings — BASE rows only (NULL
      // garment_order_id). Garment-scoped readings belong to their garment's
      // per-garment measurements table (2.3), not the order-level guide.
      const metricById = new Map(metricsList.map((m) => [m.id, m]));
      const body: BodyMeasurementWithMetric[] = (() => {
        const byMetricId = new Map(
          readingsList
            .filter((r) => !r.garment_order_id)
            .map((r) => [r.measurement_metric_id, r]),
        );
        return metricsList.map((metric) => ({
          metric,
          reading: byMetricId.get(metric.id) ?? null,
        }));
      })();

      // Map the fetched instances to the GarmentOrderRow shape the PDF
      // builders expect (garment_id / assets from the live page state, which
      // stays fresher than the fetched instance rows). One mapping reused by
      // the garment pages, style pages, and the invoice lines below.
      const pdfGoRows: GarmentOrderRow[] = selectedGoList.map((go) => {
        const liveGO = garmentOrders.find((g) => g.id === go.id);
        return {
          id: go.id,
          order_id: go.order_id ?? order.id,
          garment_id: liveGO?.garment_id ?? go.garment_id ?? "",
          total_price: liveGO?.total_price ?? null,
          status: (go.status as GarmentOrderStatus | null) ?? null,
          user_note: go.user_note,
          assets_shared: liveGO?.assets_shared ?? null,
        };
      });

      // Garment measurement groups (materials + garment-scoped readings) —
      // match the PDF shape. The resolved display label feeds the section's
      // "GARMENT n: …" header (garmentLabels.en is that builder's preferred
      // name source). Readings with this row's garment_order_id feed the
      // per-garment measurements table (2.3).
      const garments: GarmentMeasurementGroup[] = pdfGoRows.map((row) => ({
        garmentOrderId: row.id,
        garmentId: row.garment_id,
        garmentSlug: null,
        garmentLabels: { en: garmentDisplayLabel(row.garment_id) },
        status: row.status,
        userNote: row.user_note,
        materials: materialsList.filter((m) => m.garment_order_id === row.id),
        readings: readingsList
          .filter((r) => r.garment_order_id === row.id)
          .map((r) => ({
            metric:
              metricById.get(r.measurement_metric_id ?? "") ?? {
                // Unresolvable metric (deleted since capture): minimal stub
                // so the row still renders its recorded value.
                id: r.measurement_metric_id ?? "",
                code: null,
                slug: null,
                labels: null,
                descriptions: null,
                asset_urls: null,
                unit: null,
                priority_order: null,
              },
            reading: r,
          })),
      }));

      // Multilingual catalogue details for the design-selection cards — one
      // garment tree per unique garment (public endpoint), then a per-item
      // component/choice lookup. Failures degrade gracefully: cards fall
      // back to the label snapshots stamped at checkout.
      setPdfProgress("Loading design catalogue…");
      const treeByGarmentId = new Map<string, GarmentTree>();
      await Promise.all(
        [...new Set(pdfGoRows.map((r) => r.garment_id).filter((id): id is string => Boolean(id)))].map(
          async (gid) => {
            try {
              treeByGarmentId.set(gid, await fetchGarmentTree(gid));
            } catch { /* cards fall back to label snapshots */ }
          },
        ),
      );

      const styleItemDetails = (row: GarmentOrderRow): StyleItemDetail[] =>
        (itemsByGOId.get(row.id) ?? []).map((it) => {
          const tree = row.garment_id ? treeByGarmentId.get(row.garment_id) : null;
          if (it.type === "add_on") {
            const addon = tree?.addons.find((a) => a.id === it.addon_id) ?? null;
            const addonVariation =
              addon?.variations.find((v) => v.id === it.addon_variation_id) ?? null;
            return {
              componentLabels: addon?.labels ?? null,
              componentDescriptions: addon?.descriptions ?? null,
              choiceLabels: addonVariation?.labels ?? null,
              choiceDescriptions: addonVariation?.descriptions ?? null,
            };
          }
          const components = tree?.components ?? [];
          const component =
            components.find((c) => c.id === it.garment_style_component_id) ?? null;
          const variation =
            component?.variations.find((v) => v.id === it.variation_id) ??
            components.flatMap((c) => c.variations).find((v) => v.id === it.variation_id) ??
            null;
          const variationType =
            variation?.variation_types.find((t) => t.id === it.variation_type_id) ?? null;
          // The choice is the most specific entity picked: variation_type
          // when present, else the variation itself.
          const choice = variationType ?? variation;
          return {
            componentLabels: component?.labels ?? null,
            componentDescriptions: component?.descriptions ?? null,
            choiceLabels: choice?.labels ?? null,
            choiceDescriptions: choice?.descriptions ?? null,
          };
        });

      // Style selections per garment order
      const styleGroups: StyleSelectionGroup[] = pdfGoRows.map((row) => ({
        garmentOrder: row,
        garmentLabel: garmentDisplayLabel(row.garment_id),
        basePrice:
          (row.garment_id ? garmentMap.get(row.garment_id)?.base_price : null) ??
          null,
        items: itemsByGOId.get(row.id) ?? [],
        itemDetails: styleItemDetails(row),
        assetsShared: row.assets_shared,
      }));

      // Invoice input for the embedded invoice page — always built (cheap;
      // reuses already-loaded adjustments + transactions). The page itself is
      // gated by the toggle.
      const invoice = buildInvoiceInput(pdfGoRows, (id) => itemsByGOId.get(id));

      await downloadMeasurementJobPdf(
        {
          job: jobForPdf,
          customer,
          order,
          address,
          bodyMeasurements: body,
          garmentMeasurements: garments,
          styleSelections: styleGroups,
          sections: opts,
          invoice,
        },
        (current, total, label) => {
          if (total > 1) {
            setPdfProgress(`${label} (${current + 1}/${total})`);
          } else {
            setPdfProgress(label);
          }
        },
      );
      flash("PDF downloaded");
      setPdfSheetOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF generation failed");
    } finally {
      setPdfLoading(false);
      setPdfProgress(null);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INVOICE — one-click GST tax invoice. Treats order.total_price as
  // tax-inclusive and back-calculates IGST (5%) inside generateInvoicePdf.
  // No network: consumes the already-loaded order / garment / adjustment /
  // transaction state.
  // ──────────────────────────────────────────────────────────────────────────
  async function handleGenerateInvoice() {
    if (!order) return;
    setInvoiceLoading(true);
    try {
      // Same builder the PDF's embedded invoice page uses, over the full
      // (unfiltered) garment list — the standalone invoice and the report's
      // invoice page can never drift apart.
      await generateInvoicePdf(
        buildInvoiceInput(garmentOrders, (id) => itemsByGO.get(id)),
      );
      flash("Invoice downloaded");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Invoice generation failed");
    } finally {
      setInvoiceLoading(false);
    }
  }

  /** Copy the public invoice link (/invoice/{order id} — the order's random
   *  UUID doubles as the unguessable share token) so it can be sent to the
   *  customer; the page it opens renders the same invoice as the PDF. */
  async function handleCopyInvoiceUrl() {
    if (!order) return;
    const url = `${window.location.origin}/invoice/${order.id}`;
    try {
      await navigator.clipboard.writeText(url);
      flash("Invoice URL copied");
    } catch {
      // Clipboard API blocked (permission/insecure context) — still let the
      // admin copy manually.
      window.prompt("Copy this invoice URL:", url);
    }
  }

  /** Copy the full price breakdown (every garment + adjustments + total) as a
   *  simple PNG image — for pasting straight into WhatsApp/email. Falls back
   *  to downloading the PNG when the browser blocks image clipboard writes. */
  async function handleCopyQuote() {
    if (!order || quoteBusy) return;
    setQuoteBusy(true);
    try {
      const garments: QuoteGarment[] = garmentOrders.map((go) => ({
        label: garmentDisplayLabel(go.garment_id),
        total: effectiveGarmentTotal(
          go,
          itemsByGO.get(go.id),
          garmentMap.get(go.garment_id)?.base_price ?? null,
          adjustments,
          priceIndex,
        ),
        lines: [
          ...buildGarmentBreakdown(
            go,
            itemsByGO.get(go.id),
            garmentMap.get(go.garment_id)?.base_price ?? null,
            priceIndex,
          ).map((ln) => ({ label: ln.label, amount: ln.amount })),
          ...adjustments
            .filter((a) => a.garment_order_id === go.id)
            .map((a) => ({
              label: `${a.type === "discount" ? "Discount" : "Fee"}: ${adjustmentLabel(a.label)}`,
              amount: a.amount ?? 0,
            })),
        ],
      }));
      const orderAdjustments = adjustments
        .filter((a) => a.garment_order_id === null)
        .map((a) => ({
          label: `${a.type === "discount" ? "Discount" : "Fee"}: ${adjustmentLabel(a.label)}`,
          amount: a.amount ?? 0,
        }));
      const paid = transactions
        .filter((t) => t.type === "payment" && t.status === "captured")
        .reduce((s, t) => s + (t.amount ?? 0), 0);

      const blob = await renderQuoteImage({
        orderNumber: order.order_number ?? `#${truncateId(order.id)}`,
        dateText: new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        garments,
        orderAdjustments,
        total: liveTotal,
        paid,
        balanceDue: computeBalanceDue(transactions, liveTotal),
      });

      if (await copyPngToClipboard(blob)) {
        flash("Quote image copied — paste it anywhere");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quote-${order.order_number ?? truncateId(order.id)}.png`;
      a.click();
      URL.revokeObjectURL(url);
      flash("Clipboard blocked — quote image downloaded instead");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to build quote image");
    } finally {
      setQuoteBusy(false);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN MEASUREMENT SHEETS — open handlers
  // ──────────────────────────────────────────────────────────────────────────

  function openMeasurements(jobId: string) {
    setMeasurementsJobId(jobId);
  }

  function closeMeasurements() {
    setMeasurementsJobId(null);
  }

  /** Latest job for the order — the write target for the garment-scoped
   *  "Measurements" button (readings always belong to a job). */
  const latestJobId =
    jobs.length > 0
      ? [...jobs].sort((a, b) =>
          (b.created_at ?? "").localeCompare(a.created_at ?? ""),
        )[0].id
      : null;

  // ── Inline reschedule helpers ──────────────────────────────────────────────
  function openReschedule(jobId: string, scheduledAt: string | null) {
    // Seed the draft from the job's current scheduled_at (if any).
    let seed: { date: string | null; slot: AdminSlotOption | null } = {
      date: null,
      slot: null,
    };
    if (scheduledAt) {
      try {
        const d = new Date(scheduledAt);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        seed = {
          slot: { start_at: scheduledAt, label: `${hh}:${mm}`, captain_ids: [] },
          date: d.toISOString().slice(0, 10),
        };
      } catch {
        /* leave null */
      }
    }
    setRescheduleDrafts((prev) => ({ ...prev, [jobId]: seed }));
    setRescheduleJobId(jobId);
  }

  function closeReschedule() {
    setRescheduleJobId(null);
  }

  function setRescheduleDraft(
    jobId: string,
    patch: Partial<{ date: string | null; slot: AdminSlotOption | null }>,
  ) {
    setRescheduleDrafts((prev) => ({
      ...prev,
      [jobId]: { ...(prev[jobId] ?? { date: null, slot: null }), ...patch },
    }));
  }

  async function handleSaveReschedule(jobId: string) {
    const draft = rescheduleDrafts[jobId];
    const iso = draft?.slot?.start_at ?? null;
    await handleUpdateJob(jobId, { scheduled_at: iso });
    setRescheduleJobId(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12 text-center text-muted">
        Loading order…
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "Order not found"}
        </div>
        <button
          onClick={() => router.push("/admin/orders")}
          className="mt-4 text-sm font-medium text-ink-navy underline"
        >
          ← Back to Orders
        </button>
      </div>
    );
  }

  // ── Live (additive) order grand total ──────────────────────────────────────
  // Computed from the components (Σ garment effective totals + order-level
  // adjustments) rather than read from the stored order.total_price column.
  // The stored column is a backend cache that can drift; deriving the displayed
  // total from the same components the breakdown uses guarantees the header,
  // the Order-total card, and the invoice always agree with the line items.
  const liveTotal =
    garmentOrders.reduce(
      (s, go) =>
        s +
        effectiveGarmentTotal(
          go,
          itemsByGO.get(go.id),
          garmentMap.get(go.garment_id)?.base_price ?? null,
          adjustments,
          priceIndex,
        ),
      0,
    ) +
    adjustments
      .filter((a) => a.garment_order_id === null)
      .reduce((s, a) => s + (a.amount ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <button
          onClick={() => router.push("/admin/orders")}
          className="hover:text-ink-navy hover:underline"
        >
          Orders
        </button>
        <span>/</span>
        <span className="font-mono text-ink-navy">
          {order.order_number ?? `#${truncateId(order.id)}`}
        </span>
      </div>

      {/* Save message */}
      {saveMsg && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {saveMsg}
        </div>
      )}

      {/* ─── Header card ─────────────────────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-hairline bg-chalk-white p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-navy">
              {order.order_number ?? `Order #${truncateId(order.id)}`}
            </h1>
            <div className="mt-1 text-sm text-muted">
              Created {formatDate(order.created_at)} • ID: {order.id}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={order.fulfillment_status} />
            <StatusBadge value={order.payment_status} />
            <button
              onClick={handleCopyUserLoginLink}
              disabled={!customer || loginLinkBusy}
              className="rounded-lg border border-tape bg-tape/10 px-3 py-1.5 text-xs font-medium text-tape transition hover:bg-tape/20 disabled:opacity-50"
              title={
                customer
                  ? "Copy a link that opens this order in the user's logged-in app (valid 30 days)"
                  : "Customer not loaded yet"
              }
            >
              {loginLinkBusy ? "Generating…" : "🔗 Copy User URL"}
            </button>
            <button
              onClick={() => {
                setPaymentModalTab("receive");
                setPaymentModalOpen(true);
              }}
              className="rounded-lg border border-tape bg-tape/10 px-3 py-1.5 text-xs font-medium text-tape transition hover:bg-tape/20"
              title="Record a payment or send a payment link"
            >
              ₹ Receive payment
            </button>
            <button
              onClick={() => setPdfSheetOpen(true)}
              disabled={pdfLoading}
              className="rounded-lg border border-ink-navy bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
              title="Choose sections and download a PDF"
            >
              {pdfLoading ? (pdfProgress ?? "Generating…") : "⤓ Download PDF"}
            </button>
          </div>
        </div>

        {/* Customer */}
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Customer
              </div>
              {customer ? (
                <div>
                  <div className="text-sm font-medium text-ink">
                    {customer.name ?? "Unnamed"}
                  </div>
                  <div className="text-xs text-muted">
                    {customer.phone ?? "—"}
                  </div>
                  <div className="text-xs text-muted">
                    {customer.email ?? "—"}
                  </div>
                </div>
              ) : order.user_id ? (
                <div className="text-sm text-muted">
                  User ID: {truncateId(order.user_id)}
                </div>
              ) : (
                <div className="text-sm text-muted">No customer linked</div>
              )}
            </div>

            {/* Address */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Address
              </div>
              {address ? (
                <div className="text-xs text-ink">
                  {address.address_line_1 && <div>{address.address_line_1}</div>}
                  {address.address_line_2 && <div>{address.address_line_2}</div>}
                  <div className="text-muted">
                    {[
                      address.city,
                      address.state,
                      address.pincode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </div>
                  {(() => {
                    // Pin dropped by the customer at order creation —
                    // clickable through to Google Maps.
                    const coords = parseCoords(address.coordinates);
                    if (!coords) return null;
                    return (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open pin ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)} in Google Maps`}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink-navy underline decoration-hairline-strong underline-offset-2 transition hover:text-tape"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                      </a>
                    );
                  })()}
                </div>
              ) : order.address_id ? (
                <div className="text-xs text-muted">
                  Address ID: {truncateId(order.address_id)}
                </div>
              ) : (
                <div className="text-xs text-muted">No address linked</div>
              )}
            </div>

            {/* Total + Advance */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Total Price
              </div>
              <div className="font-mono text-sm text-ink">
                {/* liveTotal: the additive grand total computed from the
                    components (Σ garment effective totals + order-level
                    adjustments), NOT the stored order.total_price column.
                    Deriving it here keeps the header in lockstep with the
                    Order-total card and the invoice even if the backend
                    cache drifts. */}
                {formatPrice(liveTotal)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted">
                Derived from garment orders + order-level adjustments.
              </div>
              <div className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">
                Advance Amount
              </div>
              <div className="font-mono text-sm text-ink">
                {/* Snapshot captured at checkout; not directly editable. The
                    balance the customer owes is live-derived from this total
                    minus the captured ledger. */}
                {formatPrice(order.advance_amount)}
              </div>
              {/* Balance due — live-derived from the additive total + the
                  transactions ledger: liveTotal − Σ captured + Σ refunded.
                  Mirrors the backend _compute_balance_due. */}
              <div className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">
                Balance Due
              </div>
              <div className="font-mono text-sm font-semibold text-ink-navy">
                {formatPrice(computeBalanceDue(transactions, liveTotal))}
              </div>
            </div>

            {/* Slot */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Slot
              </div>
              <div className="text-sm text-ink">{formatOrderSlot(order.slot)}</div>
            </div>
          </div>

          {/* Acquisition — this order's attribution (editable, auto-saves on blur).
              Distinct from the customer's first-touch (kept on their profile). */}
          <details className="group mt-4">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted hover:text-ink-navy">
              <span className="inline-block transition-transform duration-150 group-open:rotate-90">▸</span>{" "}
              This order&apos;s acquisition source <span className="text-[10px] font-normal normal-case">(optional, auto-saves)</span>
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {ACQUISITION_FIELDS.map((f) => (
                <EditableTextField
                  key={f.key}
                  label={f.label}
                  value={order[f.dbKey]}
                  onSave={(v) => handleUpdateOrderField({ [f.dbKey]: v } as Partial<OrderRow>)}
                  chips={f.options}
                  placeholder={f.options[0] ? `e.g. ${f.options[0]}` : `Enter ${f.label.toLowerCase()}…`}
                />
              ))}
            </div>
            {customer && (customer.acquisition_source || customer.acquisition_campaign || customer.acquisition_medium) && (
              <div className="mt-3 rounded-lg border border-hairline bg-mist-navy/20 px-3 py-2 text-[11px] text-muted">
                Customer&apos;s original first-touch:{" "}
                <span className="font-medium text-ink">
                  {[
                    customer.acquisition_source,
                    customer.acquisition_campaign,
                    customer.acquisition_medium,
                  ].filter(Boolean).join(" / ") || "—"}
                </span>{" "}
                (kept on their profile)
              </div>
            )}
          </details>
        </div>

        {/* Voice note recorded during measurement, if any */}
        {order.voice_note_asset_url ? (
          <div className="mt-4 border-t border-hairline pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Voice note
            </div>
            <p className="mt-0.5 text-[11px] text-muted">
              Recorded by the style captain during measurement.
            </p>
            <VoicePlayer src={resolveAssetUrl(order.voice_note_asset_url) ?? order.voice_note_asset_url} />
          </div>
        ) : null}

        {/* Style captain — lives on the measurement job (orders carry no
            captain column). Editable here; writes through to the job. */}
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Style Captain
          </div>
          {(() => {
            // At most one active job per order (unique constraint); prefer
            // the job that already carries a captain, else the first job.
            const job =
              jobs.find((j) => j.style_captain_id) ?? jobs[0] ?? null;
            if (!job) {
              return (
                <div className="mt-0.5 text-sm text-muted">
                  Unassigned — no measurement job yet
                </div>
              );
            }
            return (
              <select
                value={job.style_captain_id ?? ""}
                onChange={(e) =>
                  handleUpdateJob(job.id, {
                    style_captain_id: e.target.value || null,
                  })
                }
                className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none"
              >
                <option value="">— Unassigned —</option>
                {captains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? "Unnamed"}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            );
          })()}
        </div>

        {/* Status dropdowns */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-hairline pt-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Fulfillment Status
            </div>
            <select
              value={order.fulfillment_status ?? ""}
              onChange={(e) =>
                handleUpdateOrderField({
                  fulfillment_status: (e.target.value || null) as FulfillmentStatus | null,
                })
              }
              className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none"
            >
              <option value="">— None —</option>
              {FULFILLMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Payment Status
            </div>
            <select
              value={order.payment_status ?? ""}
              onChange={(e) =>
                handleUpdateOrderField({
                  payment_status: (e.target.value || null) as PaymentStatus | null,
                })
              }
              className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none"
            >
              <option value="">— None —</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Comments */}
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Comments
          </div>
          <textarea
            value={order.comments ?? ""}
            onChange={(e) =>
              setOrder({ ...order, comments: e.target.value })
            }
            rows={2}
            placeholder="Add internal comments…"
            className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
          />
          <SaveButton
            label="Save comment"
            className="mt-1.5"
            onSave={() =>
              handleUpdateOrderField({ comments: order.comments ?? "" })
            }
          />
        </div>
      </div>

      {/* ─── Garment Orders ───────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold text-ink-navy">
            Garment Orders ({garmentOrders.length})
          </h2>
          <button
            onClick={() => {
              setNewGOGarmentId("");
              setNewGONote("");
              setShowNewGOForm(true);
            }}
            disabled={creatingGO}
            className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
          >
            + New Garment Order
          </button>
        </div>

        {/* ── New Garment Order sheet (garment picker + note) ──────────── */}
        {showNewGOForm && (
          <BottomSheet open={true} title="New garment order" onClose={() => setShowNewGOForm(false)}>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Garment
                </p>
                {garments.map((g) => {
                  const selected = newGOGarmentId === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setNewGOGarmentId(g.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-card border px-3 py-2.5 text-left transition ${
                        selected
                          ? "border-ink-navy bg-mist-navy/30"
                          : "border-hairline bg-chalk-white hover:bg-mist-navy/20"
                      }`}
                    >
                      <span className="min-w-0 text-caption font-medium text-ink-navy">
                        {garmentLabel(g)}
                        {g.gender && (
                          <span className="ml-2 rounded-pill bg-mist-navy px-1.5 py-0.5 text-[10px] font-normal text-muted">
                            {g.gender}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-caption text-ink">
                        {formatPrice(g.base_price)}
                      </span>
                    </button>
                  );
                })}
                {garments.length === 0 && (
                  <p className="py-2 text-center text-caption text-muted">
                    Loading garments…
                  </p>
                )}
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                  Note
                </p>
                <input
                  type="text"
                  value={newGONote}
                  onChange={(e) => setNewGONote(e.target.value)}
                  placeholder="optional note"
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                />
              </div>
              <button
                onClick={handleCreateGarmentOrder}
                disabled={creatingGO || !newGOGarmentId}
                className="tap w-full rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary transition disabled:opacity-50"
              >
                {creatingGO ? "Creating…" : "Create garment order"}
              </button>
            </div>
          </BottomSheet>
        )}

        {garmentOrders.length === 0 && !showNewGOForm ? (
          <div className="rounded-lg border border-hairline bg-chalk-white px-4 py-6 text-center text-sm text-muted">
            No garment orders in this order. Click “+ New Garment Order” to add one.
          </div>
        ) : (
          <div className="space-y-3">
            {garmentOrders.map((go) => {
              const items = itemsByGO.get(go.id);
              const aiPrefill = goAIPrefill[go.id];
              return (
                <div
                  key={go.id}
                  className="overflow-hidden rounded-xl border border-hairline bg-chalk-white"
                >
                  {/* GO header — glance info; everything below stays visible */}
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink-navy">
                        {garmentDisplayLabel(go.garment_id)}
                      </div>
                      <div className="text-[11px] text-muted">
                        GO ID: {truncateId(go.id)}
                        {items && items.length > 0 && ` · ${items.length} selections`}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge value={go.status} />
                      <span className="font-mono text-sm text-ink">
                        {formatPrice(go.total_price)}
                      </span>
                      <button
                        onClick={() => handleDeleteGarmentOrder(go.id)}
                        disabled={deletingGOId === go.id}
                        title="Delete garment order"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-red-500 transition hover:bg-red-50 disabled:opacity-40"
                      >
                        {deletingGOId === go.id ? (
                          <span className="text-[10px]">…</span>
                        ) : (
                          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                            <path d="M3 5h10M6 5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V5M5 5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* GO body — compact, always visible (no expander) */}
                  <div className="space-y-2 border-t border-hairline px-4 py-2.5">
                    {/* Status + user note on one line */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        value={go.status ?? ""}
                        onChange={(e) =>
                          handleUpdateGarmentOrder(go.id, {
                            status: (e.target.value || null) as GarmentOrderStatus | null,
                          })
                        }
                        aria-label="Status"
                        className="w-full shrink-0 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-xs focus:border-ink-navy focus:outline-none sm:w-36"
                      >
                        <option value="">— Status —</option>
                        {GARMENT_ORDER_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <textarea
                        value={go.user_note ?? ""}
                        onChange={(e) => {
                          setGarmentOrders((prev) =>
                            prev.map((g) =>
                              g.id === go.id ? { ...g, user_note: e.target.value } : g,
                            ),
                          );
                        }}
                        rows={1}
                        placeholder="Note for this garment…"
                        aria-label="User note"
                        className="min-w-0 flex-1 resize-y rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-xs focus:border-ink-navy focus:outline-none"
                      />
                      <SaveButton
                        label="Save"
                        className="shrink-0"
                        onSave={() =>
                          handleUpdateGarmentOrder(go.id, {
                            user_note: go.user_note || null,
                          })
                        }
                      />
                    </div>

                    {/* Design inspiration images — upload / remove per GO */}
                    <GarmentOrderAssets
                      go={go}
                      onAttach={attachGOImageUrls}
                      onDetach={detachGOImageUrl}
                    />

                    {/* Manual selections + AI reference both live in this
                        sheet ("Manual select" / "Upload reference" tabs). */}
                    <GarmentSelectionSheet
                        open={editingGOId === go.id}
                        garmentId={go.garment_id}
                        garmentOrderId={go.id}
                        initialItems={goAIPrefill[go.id]?.items ?? items ?? []}
                        sessionId={`${go.id}-${goAIIterations[go.id] ?? 0}-${
                          goAIPrefill[go.id] ? "ai" : "saved"
                        }`}
                        basePrice={
                          garmentMap.get(go.garment_id)?.base_price ?? null
                        }
                        aiPanel={
                          <DesignFromImage
                            garmentId={go.garment_id}
                            garmentOrderId={go.id}
                            threadId={ensureGOThreadId(go.id)}
                            onApplyDraft={(selections, addons, imageUrl) =>
                              applyGODesign(go.id, selections, addons, imageUrl)
                            }
                            onImageUrl={(imageUrl) =>
                              applyGOImageUrl(go.id, imageUrl)
                            }
                          />
                        }
                        onClose={() => setEditingGOId(null)}
                        onSaveComplete={(updated) => {
                          setItemsByGO((prev) => {
                            const next = new Map(prev);
                            next.set(go.id, updated);
                            return next;
                          });
                          // Picks are persisted now — drop any AI prefill so
                          // reopening seeds from the saved rows instead of a
                          // stale AI snapshot.
                          setGoAIPrefill((prev) => {
                            if (!prev[go.id]) return prev;
                            const next = { ...prev };
                            delete next[go.id];
                            return next;
                          });
                          // total_price is derived server-side from the
                          // saved items (+ adjustments); pull the
                          // recomputed garment + order totals.
                          refreshOrderTotal();
                          flash("Design saved");
                        }}
                      />
                  </div>

                  {/* Footer CTAs — always visible */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-hairline bg-mist-navy/20 px-4 py-3">
                    <button
                      onClick={() =>
                        setEditingGOId((cur) => (cur === go.id ? null : go.id))
                      }
                      disabled={items === undefined}
                      title={
                        items === undefined
                          ? "Saved selections are still loading…"
                          : undefined
                      }
                      className={`tap rounded-pill px-3.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        editingGOId === go.id
                          ? "border border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy/40"
                          : "bg-ink-navy text-chalk-white hover:bg-ink-navy/90"
                      }`}
                    >
                      {editingGOId === go.id ? "Close selections" : "Edit selections"}
                    </button>
                    <button
                      onClick={() => setGoMeasurements(go.id)}
                      disabled={!latestJobId}
                      title={
                        latestJobId
                          ? "View / edit this garment's measurements (order's latest measurement job)"
                          : "No measurement job exists for this order yet"
                      }
                      className="tap rounded-pill border border-hairline-strong bg-chalk-white px-3.5 py-2 text-xs font-semibold text-ink-navy transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Measurements
                    </button>
                    {aiPrefill && (
                      <span
                        title="AI reference applied — review the picks in the sheet's Manual select tab"
                        className="rounded-pill border border-hairline-strong bg-chalk-white px-3.5 py-2 text-xs font-medium text-muted"
                      >
                        ✓ Reference applied
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Measurement Jobs ─────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-ink-navy">
            Measurement Jobs ({jobs.length})
          </h2>
          {!showNewJobForm && (
            <button
              onClick={() => setShowNewJobForm(true)}
              className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90"
            >
              + New Job
            </button>
          )}
        </div>

        {/* ── New job form ────────────────────────────────────────────────── */}
        {showNewJobForm && (
          <div className="mb-3 rounded-xl border border-hairline bg-mist-navy/30 px-4 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              {/* Status */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Status
                </span>
                <select
                  value={newJobStatus}
                  onChange={(e) => setNewJobStatus(e.target.value as JobStatus)}
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                >
                  {JOB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>

              {/* Notes */}
              <label className="block sm:col-span-1 md:col-span-3">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Notes
                </span>
                <input
                  type="text"
                  value={newJobNotes}
                  onChange={(e) => setNewJobNotes(e.target.value)}
                  placeholder="optional"
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                />
              </label>
            </div>

            {/* Slot + captain picker (shared with create-order flow) */}
            <div className="mt-3">
              <SlotPicker
                selectedDate={newJobSlotDate}
                selectedSlot={newJobSlot}
                selectedCaptainId={newJobCaptainId}
                onDateChange={setNewJobSlotDate}
                onSlotChange={setNewJobSlot}
                onCaptainChange={setNewJobCaptainId}
                captains={captains}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleCreateJob}
                disabled={creatingJob}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-800 disabled:opacity-50"
              >
                {creatingJob ? "Creating…" : "Create Job"}
              </button>
              <button
                onClick={() => {
                  setShowNewJobForm(false);
                  setNewJobStatus("scheduled");
                  setNewJobCaptainId("");
                  setNewJobSlotDate(null);
                  setNewJobSlot(null);
                  setNewJobNotes("");
                }}
                className="rounded-lg border border-hairline-strong px-4 py-2 text-sm text-muted hover:bg-mist-navy"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {jobs.length === 0 && !showNewJobForm ? (
          <div className="rounded-lg border border-hairline bg-chalk-white px-4 py-6 text-center text-sm text-muted">
            No measurement jobs for this order.
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="overflow-hidden rounded-lg border border-hairline bg-chalk-white px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div
                    onClick={() =>
                      router.push(
                        `/admin/orders/measurement-jobs/${job.id}`,
                      )
                    }
                    className="cursor-pointer transition hover:opacity-70"
                    title="View measurement job detail"
                  >
                    <div className="text-sm font-medium text-ink-navy underline decoration-hairline-strong underline-offset-2">
                      Job {truncateId(job.id)}
                    </div>
                    <div className="text-[11px] text-muted">
                      Scheduled: {formatDate(job.scheduled_at)}
                    </div>
                    <div className="text-[11px] text-muted">
                      Captain:{" "}
                      {captainNameById(captains, job.style_captain_id) ??
                        "Unassigned"}
                    </div>
                    {job.started_at && (
                      <div className="text-[11px] text-muted">
                        Started: {formatDate(job.started_at)}
                      </div>
                    )}
                    {job.completed_at && (
                      <div className="text-[11px] text-muted">
                        Completed: {formatDate(job.completed_at)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={job.status} />
                    {job.status === "draft" && (
                      <button
                        onClick={() => void handleConfirmSlot()}
                        className="rounded-md bg-amber-600 px-2 py-1 text-xs font-semibold text-chalk-white transition hover:bg-amber-700"
                      >
                        Confirm slot
                      </button>
                    )}
                    <select
                      value={job.status ?? ""}
                      onChange={(e) =>
                        handleUpdateJob(job.id, {
                          status: (e.target.value || null) as JobStatus | null,
                        })
                      }
                      className="rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs focus:border-ink-navy focus:outline-none"
                    >
                      <option value="">— None —</option>
                      {JOB_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        measurementsJobId === job.id
                          ? closeMeasurements()
                          : openMeasurements(job.id)
                      }
                      className="rounded-md border border-ink-navy px-2 py-1 text-xs font-medium text-ink-navy transition hover:bg-mist-navy"
                    >
                      {measurementsJobId === job.id
                        ? "Close"
                        : "Manage Measurements"}
                    </button>
                    <button
                      onClick={() =>
                        rescheduleJobId === job.id
                          ? closeReschedule()
                          : openReschedule(job.id, job.scheduled_at)
                      }
                      className="rounded-md border border-hairline-strong px-2 py-1 text-xs font-medium text-ink-navy transition hover:bg-mist-navy"
                    >
                      {rescheduleJobId === job.id ? "Close" : "Reschedule"}
                    </button>
                  </div>
                </div>
                {job.notes && (
                  <div className="mt-2 text-xs text-ink">
                    <span className="font-medium">Notes:</span> {job.notes}
                  </div>
                )}

                {/* ── Inline reschedule panel ─────────────────────────────── */}
                {rescheduleJobId === job.id && (
                  <div className="mt-3 rounded-lg border border-tape/40 bg-tape/5 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                        Reschedule visit
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveReschedule(job.id)}
                          disabled={
                            (rescheduleDrafts[job.id]?.slot?.start_at ?? null) ===
                            (job.scheduled_at ?? null)
                          }
                          className="rounded-md bg-ink-navy px-3 py-1 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={closeReschedule}
                          className="rounded-md border border-hairline-strong px-3 py-1 text-xs text-muted hover:bg-mist-navy"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    <SlotPicker
                      selectedDate={rescheduleDrafts[job.id]?.date ?? null}
                      selectedSlot={rescheduleDrafts[job.id]?.slot ?? null}
                      selectedCaptainId={job.style_captain_id ?? ""}
                      onDateChange={(d) =>
                        setRescheduleDraft(job.id, { date: d })
                      }
                      onSlotChange={(s) =>
                        setRescheduleDraft(job.id, { slot: s })
                      }
                      onCaptainChange={(c) =>
                        handleUpdateJob(job.id, {
                          style_captain_id: c || null,
                        })
                      }
                      captains={captains}
                      hideCaptainSelect
                      excludeJobId={job.id}
                    />
                  </div>
                )}

                {/* Admin measurement editor lives at the end of the
                    page tree (fixed overlay) — MeasurementsSheet instance. */}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Measurement editor sheets (fixed overlays) ─────────────────────
          One per entry point: the job's "Manage Measurements" button (body
          + every garment) and the garment card's "Measurements" button
          (that garment only, reading/writing the order's latest job). */}
      <MeasurementsSheet
        open={!!measurementsJobId}
        jobId={measurementsJobId ?? ""}
        onClose={closeMeasurements}
        onSaved={(msg) => flash(msg)}
      />
      <MeasurementsSheet
        open={!!goMeasurements && !!latestJobId}
        jobId={latestJobId ?? ""}
        garmentOrderId={goMeasurements}
        onClose={() => setGoMeasurements(null)}
        onSaved={(msg) => flash(msg)}
      />

      {/* ─── Price Breakdown ──────────────────────────────────────────────
          Both cards derive their totals ADDITIVELY from the visible lines so
          the sub-lines always sum exactly to the displayed total:
            garment total  = Σ (base + item lines) + Σ garment adjustments
            order total    = Σ garment totals + Σ order-level adjustments
          We never mix the backend's adjustment-inclusive go.total_price /
          order.total_price with a partial client sum (the old bug where the
          listed lines didn't add up to the shown total). */}

      {/* PRIMARY: Order total card — sits first so the eye lands on the
          grand total. Brand Book: navy header bar, navy@8% single-elevation
          shadow, 12px radius, IBM Plex Mono prices, tick dividers, tape
          gradient reserved for the grand-total accent only. */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold text-ink-navy">
            Order total
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyQuote}
              disabled={quoteBusy}
              title="Copy the full price breakdown as an image (paste into WhatsApp / email)"
              className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {quoteBusy ? "Building…" : "▣ Copy Quote"}
            </button>
            <button
              onClick={handleCopyInvoiceUrl}
              title="Copy a public link that opens this invoice as a web page"
              className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist-navy/40"
            >
              🔗 Copy Invoice URL
            </button>
            <button
              onClick={handleGenerateInvoice}
              disabled={invoiceLoading || pdfLoading}
              title="Generate a GST tax invoice from the order grand total (tax-inclusive)"
              className="rounded-lg border border-tape bg-tape/10 px-3 py-1.5 text-xs font-medium text-tape transition hover:bg-tape/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {invoiceLoading ? "Preparing…" : "⬇ Download Invoice PDF"}
            </button>
          </div>
        </div>

        {(() => {
          // One source of truth for every number in this card.
          const garmentTotals = garmentOrders.map((go) => ({
            go,
            effective: effectiveGarmentTotal(
              go,
              itemsByGO.get(go.id),
              garmentMap.get(go.garment_id)?.base_price ?? null,
              adjustments,
              priceIndex,
            ),
          }));
          const garmentsSum = garmentTotals.reduce(
            (s, x) => s + x.effective,
            0,
          );
          const orderAdj = adjustments.filter(
            (a) => a.garment_order_id === null,
          );
          const orderAdjSum = orderAdj.reduce(
            (s, a) => s + (a.amount ?? 0),
            0,
          );
          const grandTotal = garmentsSum + orderAdjSum;
          return (
            <div className="overflow-hidden rounded-xl border border-ink-navy/20 bg-chalk-white shadow-[0_4px_20px_-4px_rgba(8,48,104,0.08)] ring-1 ring-ink-navy/5">
              {/* Navy header bar */}
              <div className="flex items-center justify-between bg-ink-navy px-5 py-3">
                <span className="font-heading text-sm font-semibold uppercase tracking-[0.1em] text-chalk-white">
                  Grand total
                </span>
                {/* Tape-gradient accent reserved for the primary total only */}
                <span className="bg-gradient-to-br from-[#F89010] via-[#E87810] to-[#D06010] bg-clip-text font-mono text-xl font-bold tracking-tight text-transparent">
                  {formatPrice(grandTotal)}
                </span>
              </div>

              <div className="px-5 py-4">
                {/* Garment rollup — one line per garment. */}
                {garmentTotals.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-navy/50">
                      Garments
                    </div>
                    <div className="space-y-1.5">
                      {garmentTotals.map(({ go, effective }) => (
                        <div
                          key={go.id}
                          className="flex items-baseline justify-between gap-3 text-sm"
                        >
                          <span className="truncate font-sans text-ink/90">
                            {garmentDisplayLabel(go.garment_id)}
                          </span>
                          <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink">
                            {formatPrice(effective)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Tick divider + subtotal */}
                    <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-dashed border-hairline pt-2">
                      <span className="font-sans text-xs font-medium uppercase tracking-wide text-ink-navy/60">
                        Subtotal
                      </span>
                      <span className="font-mono text-[13px] tabular-nums text-ink-navy">
                        {formatPrice(garmentsSum)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Order-level adjustments — render before the grand total so
                    the column reads: garments → order adjustments → total. */}
                <div className="mb-4">
                  <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-navy/50">
                    Order adjustments
                  </div>
                  {renderAdjustmentBlock("order", null)}
                </div>

                {/* Reconciliation strip — shows the additive path so the math
                    is auditable: subtotal + adjustments = grand total. */}
                <div className="space-y-1 border-t border-hairline pt-3 font-mono text-[11px] tabular-nums text-ink-navy/60">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>Subtotal (garments)</span>
                    <span>{formatPrice(garmentsSum)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span>Order adjustments</span>
                    <span>{formatPrice(orderAdjSum)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 pt-1 font-semibold text-ink-navy">
                    <span>Total</span>
                    <span>{formatPrice(grandTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* SECONDARY: Per-garment ledger cards — demoted, Warm Sand tinted. */}
      <section className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-ink-navy">
          Garment breakdown
        </h2>

        {garmentOrders.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-chalk-white px-4 py-6 text-center text-sm text-muted">
            No garment orders to break down.
          </div>
        ) : (
          <div className="space-y-3">
            {garmentOrders.map((go) => {
              const items = itemsByGO.get(go.id);
              const basePrice =
                garmentMap.get(go.garment_id)?.base_price ?? null;
              const goAdj = adjustments.filter(
                (a) => a.garment_order_id === go.id,
              );
              const lines = buildGarmentBreakdown(
                go,
                items,
                basePrice,
                priceIndex,
              );
              const itemsSubtotal = lines.reduce(
                (s, ln) => s + ln.amount,
                0,
              );
              const adjSum = goAdj.reduce(
                (s, a) => s + (a.amount ?? 0),
                0,
              );
              const garmentTotal = itemsSubtotal + adjSum;
              return (
                <div
                  key={go.id}
                  className="overflow-hidden rounded-xl border border-hairline bg-warm-sand/40 shadow-[0_2px_10px_-4px_rgba(8,48,104,0.06)]"
                >
                  {/* Garment header — Warm Sand tint, quiet */}
                  <div className="flex items-center justify-between gap-3 border-b border-hairline/60 bg-warm-sand/60 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-heading text-[13px] font-semibold text-ink-navy">
                        {garmentDisplayLabel(go.garment_id)}
                      </div>
                      <div className="font-mono text-[10px] tracking-wide text-ink-navy/40">
                        GO {truncateId(go.id)}
                      </div>
                    </div>
                    {go.status && <StatusBadge value={go.status} />}
                  </div>

                  <div className="px-4 py-3">
                    {/* Itemized lines — base + variations/addons */}
                    {items === undefined ? (
                      <div className="py-2 text-xs text-muted">
                        Loading items…
                      </div>
                    ) : lines.length === 0 ? (
                      <div className="py-1.5 text-xs text-muted">
                        No priced items yet.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {lines.map((ln) => (
                          <div
                            key={ln.key}
                            className="flex items-baseline justify-between gap-3 text-[13px]"
                          >
                            <span className="truncate font-sans text-ink/80">
                              {ln.label}
                            </span>
                            <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink/80">
                              {formatPrice(ln.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Garment-level adjustments (list + add-row) */}
                    {goAdj.length > 0 || items !== undefined ? (
                      <div className="mt-3">
                        <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-navy/40">
                          Adjustments
                        </div>
                        {renderAdjustmentBlock(go.id, go.id)}
                      </div>
                    ) : null}

                    {/* Garment total — additive: items subtotal + adjustments.
                        Shows both so the math is transparent. */}
                    <div className="mt-3 border-t border-dashed border-hairline pt-2.5">
                      <div className="space-y-0.5 font-mono text-[11px] tabular-nums text-ink-navy/50">
                        <div className="flex items-baseline justify-between gap-3">
                          <span>Items subtotal</span>
                          <span>{formatPrice(itemsSubtotal)}</span>
                        </div>
                        {adjSum !== 0 && (
                          <div className="flex items-baseline justify-between gap-3">
                            <span>Adjustments</span>
                            <span>{formatPrice(adjSum)}</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-baseline justify-between gap-3">
                        <span className="font-sans text-[11px] font-semibold uppercase tracking-wide text-ink-navy/70">
                          Garment total
                        </span>
                        <span className="font-mono text-[15px] font-bold tabular-nums text-ink-navy">
                          {formatPrice(garmentTotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Transactions ─────────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold text-ink-navy">
            Transactions ({transactions.length})
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setPaymentModalTab("refund");
                setPaymentModalOpen(true);
              }}
              disabled={computeRefundable(transactions) <= 0}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Refund
            </button>
            <button
              onClick={() => {
                setPaymentModalTab("receive");
                setPaymentModalOpen(true);
              }}
              className="rounded-md bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90"
            >
              Receive payment
            </button>
          </div>
        </div>
        {transactions.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-chalk-white px-4 py-6 text-center text-sm text-muted">
            No transactions for this order.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Method</th>
                  <th className="px-4 py-2 font-medium">Reference</th>
                  <th className="px-4 py-2 font-medium">Note</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isRefund = tx.type === "refund";
                  const ref =
                    tx.method_detail &&
                    typeof tx.method_detail === "object" &&
                    "reference" in tx.method_detail
                      ? String((tx.method_detail as Record<string, unknown>).reference)
                      : tx.provider_payment_id ?? tx.provider_order_id;
                  // Payment note (recorded in the Receive Payment modal →
                  // metadata.note); refunds keep their reason in failure_reason.
                  const note =
                    tx.metadata &&
                    typeof tx.metadata === "object" &&
                    "note" in tx.metadata &&
                    tx.metadata.note != null
                      ? String(tx.metadata.note)
                      : isRefund
                        ? tx.failure_reason
                        : null;
                  return (
                    <tr key={tx.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2 text-[13px]">
                        <span
                          className={`inline-block rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                            isRefund
                              ? "bg-purple-50 text-purple-700"
                              : "bg-green-50 text-green-700"
                          }`}
                        >
                          {tx.type ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[13px]">{tx.provider ?? "—"}</td>
                      <td className="px-4 py-2" title={tx.failure_reason ?? undefined}>
                        <StatusBadge value={tx.status} />
                      </td>
                      <td className="px-4 py-2 text-[13px] capitalize">
                        {tx.method ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-[12px] text-muted">
                        {ref ? <span className="font-mono">{ref}</span> : "—"}
                      </td>
                      <td className="px-4 py-2 text-[12px] text-muted">
                        {note ? (
                          <div className="max-w-[220px] truncate" title={note}>
                            {note}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-[13px] ${
                          isRefund ? "text-purple-700" : "text-ink"
                        }`}
                      >
                        {isRefund ? "−" : ""}
                        {formatPrice(tx.amount)}
                      </td>
                      <td className="px-4 py-2 text-[12px] text-muted">
                        {formatDate(tx.captured_at ?? tx.refunded_at ?? tx.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Receive payment / refund modal ───────────────────────────────── */}
      {order && (
        <ReceivePaymentModal
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          orderId={order.id}
          initialTab={paymentModalTab}
          onSuccess={refreshOrderTotal}
          totalPrice={liveTotal}
          customerPhone={customer?.phone}
        />
      )}

      {/* ─── PDF customization sheet ─────────────────────────────────────────
          Opens when "Download PDF" is clicked. The user toggles which sections
          to include, then clicks "Generate PDF" to build & download. The cover
          page always renders; these toggles gate the content sections and the
          cover's customer-details enrichment. */}
      <BottomSheet
        open={pdfSheetOpen}
        onClose={() => {
          if (!pdfLoading) setPdfSheetOpen(false);
        }}
        title="Download PDF"
        className="max-w-2xl"
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setPdfSheetOpen(false)}
              disabled={pdfLoading}
              className="rounded-lg border border-hairline bg-chalk-white px-4 py-2 text-sm font-medium text-ink-navy transition hover:bg-mist-navy/40 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => handleGeneratePdf(pdfOptions)}
              disabled={pdfLoading}
              className="rounded-lg border border-ink-navy bg-ink-navy px-4 py-2 text-sm font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
            >
              {pdfLoading ? (pdfProgress ?? "Generating…") : "⤓ Generate PDF"}
            </button>
          </div>
        }
      >
        <div className="space-y-1 pb-2">
          <p className="mb-3 text-xs text-muted">
            Choose which sections to include. The cover page always renders.
          </p>
          {(
            [
              {
                key: "customerDetails" as const,
                title: "Customer details",
                desc: "Phone, email, and address on the cover page",
              },
              {
                key: "measurementDetails" as const,
                title: "Measurement details",
                desc: "Body measurement guide pages",
              },
              {
                key: "designDetails" as const,
                title: "Design details",
                desc: "Style selections per garment",
              },
              {
                key: "fabricDetails" as const,
                title: "Fabric details",
                desc: "Cloth/material details, colors, and photos",
              },
              {
                key: "invoice" as const,
                title: "Invoice",
                desc: "Tax invoice with line items, totals, and UPI payment QR",
              },
            ]
          ).map(({ key, title, desc }) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline bg-chalk-white px-3 py-2.5 transition hover:bg-mist-navy/30"
            >
              <input
                type="checkbox"
                checked={pdfOptions[key]}
                onChange={(e) =>
                  setPdfOptions((prev) => ({ ...prev, [key]: e.target.checked }))
                }
                disabled={pdfLoading}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-ink-navy"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-navy">
                  {title}
                </span>
                <span className="block text-xs text-muted">{desc}</span>
              </span>
            </label>
          ))}

          {/* Garment-order deselection: every garment order is included by
              default; unchecking one drops its fabric/design pages and its
              line from the invoice. Effective totals are shown next to each
              garment because an order can hold several of the same garment
              type, and the price is what tells them apart. */}
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              Garment orders
            </p>
            <p className="mb-2 text-xs text-muted">
              Uncheck any garment to leave it out of the PDF (price = its
              effective total).
            </p>
            <div className="space-y-1">
              {garmentOrders.map((go) => {
                const included = !pdfExcludedGoIds.has(go.id);
                const price = effectiveGarmentTotal(
                  go,
                  itemsByGO.get(go.id),
                  garmentMap.get(go.garment_id)?.base_price ?? null,
                  adjustments,
                  priceIndex,
                );
                return (
                  <label
                    key={go.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border border-hairline bg-chalk-white px-3 py-2.5 transition hover:bg-mist-navy/30 ${
                      included ? "" : "opacity-60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) =>
                        setPdfExcludedGoIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(go.id);
                          else next.add(go.id);
                          return next;
                        })
                      }
                      disabled={pdfLoading}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-ink-navy"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-navy">
                        {garmentDisplayLabel(go.garment_id)}
                      </span>
                      <span className="block text-xs text-muted">
                        #{truncateId(go.id)}
                        {go.status ? ` · ${go.status.replace(/_/g, " ")}` : ""}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-sm font-semibold text-ink-navy">
                      {formatPrice(price)}
                    </span>
                  </label>
                );
              })}
              {garmentOrders.length === 0 && (
                <p className="rounded-lg border border-dashed border-hairline px-3 py-2.5 text-xs text-muted">
                  No garment orders on this order yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
