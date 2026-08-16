"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchTableRows,
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
  deleteGarmentOrder,
  deleteGarmentOrderItem,
  deleteTableRow,
  fetchOrderAdjustments,
  createOrderAdjustment,
  updateOrderAdjustment,
  deleteOrderAdjustment,
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
} from "@/lib/job-pdf";
import { generateInvoicePdf, type InvoiceInput } from "@/lib/invoice-pdf";
import { buildUpiPayUrl, UPI_VPA } from "@/lib/upi";
import { GarmentOrderEditor } from "./GarmentOrderEditor";
import { GarmentOrderAssets } from "./GarmentOrderAssets";
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
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
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

/** Parse an OrderAdjustmentRow.label (JSON string like '{"en":"Rush fee"}') to text. */
function adjustmentLabel(raw: string | null | undefined): string {
  if (!raw) return "Adjustment";
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
): number {
  const lineSum = buildGarmentBreakdown(go, items, basePrice).reduce(
    (s, ln) => s + ln.amount,
    0,
  );
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
  // whose snapshot price is null/0 are hidden (unpriced or free selection).
  for (const it of items ?? []) {
    if (it.price == null || it.price === 0) continue;
    lines.push({
      key: it.id,
      label: itemDisplayLabel(it),
      amount: it.price,
      kind: "item",
    });
  }

  return lines;
}

/** Human label for a garment_orders_items row — prefers label_snapshot. */
function itemDisplayLabel(it: GarmentOrderItemRow): string {
  if (it.label_snapshot) {
    try {
      const parsed = JSON.parse(it.label_snapshot) as Record<string, string>;
      const text = parsed.en ?? parsed[Object.keys(parsed)[0] ?? ""];
      if (text) return text;
    } catch {
      return it.label_snapshot;
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

/** Resolve a captain's display name from the loaded captains list by id. */
function captainNameById(
  captains: UserRow[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const c = captains.find((x) => x.id === id);
  return c?.name ?? c?.phone ?? truncateId(c!.id) ?? null;
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
  onSave: (v: string | null) => Promise<void>;
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
  const [expandedGOs, setExpandedGOs] = useState<Set<string>>(new Set());
  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [garmentMap, setGarmentMap] = useState<Map<string, GarmentRow>>(
    new Map(),
  );
  const [showNewGOForm, setShowNewGOForm] = useState(false);
  const [newGOGarmentId, setNewGOGarmentId] = useState("");
  const [newGONote, setNewGONote] = useState("");
  const [creatingGO, setCreatingGO] = useState(false);
  const [deletingGOId, setDeletingGOId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [editingGOId, setEditingGOId] = useState<string | null>(null);

  // ── AI "Upload Reference" design flow per garment order ───────────────────
  // Per-GO tab: "upload" (AI reference) vs "manual" (catalog editor).
  const [goDesignTabs, setGoDesignTabs] = useState<
    Record<string, "upload" | "manual">
  >({});
  // AI-prefilled editor items + reference image per GO. When set, the editor
  // opens with these selections (apply mode) and a composer beneath it.
  const [goAIPrefill, setGoAIPrefill] = useState<
    Record<string, { items: GarmentOrderItemRow[]; imageUrl: string }>
  >({});
  // Bumps per AI turn so the editor remounts with fresh initialItems.
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
  // UPI payment QR sheet (same link the invoice QR carries).
  const [upiQrOpen, setUpiQrOpen] = useState(false);
  const [upiQrBusy, setUpiQrBusy] = useState(false);
  const [upiQrImg, setUpiQrImg] = useState<string | null>(null);
  const [upiQrUrl, setUpiQrUrl] = useState<string | null>(null);
  const [upiQrAmount, setUpiQrAmount] = useState<number>(0);
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

  // ── Manage-Measurements override state ─────────────────────────────────────
  // Per-job editable measurement map: keyed by jobId → metricId → draft value
  const [measurementsJobId, setMeasurementsJobId] = useState<string | null>(null);
  const [metricCatalog, setMetricCatalog] = useState<MeasurementMetricRow[]>([]);
  const [jobReadings, setJobReadings] = useState<MeasurementReadingRow[]>([]);
  // Draft readings: metricId → draft (we edit a local copy and Save commits)
  const [draftReadings, setDraftReadings] = useState<
    Map<string, { value_numeric: string; value_text: string; unit: string; rowId?: string }>
  >(new Map());
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [savingMeasurements, setSavingMeasurements] = useState(false);
  const [newMetricId, setNewMetricId] = useState("");
  // For "Reset design" pending state
  const [resettingGOId, setResettingGOId] = useState<string | null>(null);

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

  function flash(msg: string) {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 2000);
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
      setGarmentOrders(gos);
      setJobs(mj);
      setTransactions(tx);
      setAdjustments(adj);

      // 4. Auto-expand the first garment order
      if (gos.length > 0) {
        setExpandedGOs(new Set([gos[0].id]));
      }
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
  // Items are needed both when a GO is expanded (its item table) AND in the
  // Price Breakdown section, which renders every GO's items. So fetch eagerly
  // for ALL garment orders once they're loaded — not only expanded ones — so
  // the breakdown never sits on "Loading items…".
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
    // expandedGOs intentionally excluded — expansion is a UI affordance, not a
    // fetch trigger anymore. itemsByGO is read here only to seed the initial
    // pass; the setItemsByGO updaters are idempotent so re-runs are harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garmentOrders]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleUpdateOrderField(patch: Partial<OrderRow>) {
    if (!order) return;
    try {
      await updateOrder(order.id, patch);
      setOrder({ ...order, ...patch });
      flash("Order updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleUpdateGarmentOrder(
    goId: string,
    patch: Partial<GarmentOrderRow>,
  ) {
    try {
      await updateGarmentOrder(goId, patch);
      setGarmentOrders((prev) =>
        prev.map((g) => (g.id === goId ? { ...g, ...patch } : g)),
      );
      flash("Garment order updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
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

  function toggleGO(id: string) {
    setExpandedGOs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── AI design prefill (apply mode) ─────────────────────────────────────────
  /** Apply an AI design result to a garment order's editor (apply mode). */
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
      setExpandedGOs((prev) => new Set(prev).add(created.id));
      // Auto-open the design editor so the admin can configure the garment
      setEditingGOId(created.id);
      // reset form
      setShowNewGOForm(false);
      setNewGOGarmentId("");
      setNewGONote("");
      flash("Garment order created — configure the design below");
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
      setExpandedGOs((prev) => {
        const next = new Set(prev);
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

  // ── Delete a single garment order item ─────────────────────────────────────
  async function handleDeleteGarmentOrderItem(goId: string, itemId: string) {
    if (!confirm("Delete this item?")) return;
    setDeletingItemId(itemId);
    try {
      await deleteGarmentOrderItem(itemId);
      setItemsByGO((prev) => {
        const next = new Map(prev);
        const items = next.get(goId);
        if (items) {
          next.set(
            goId,
            items.filter((it) => it.id !== itemId),
          );
        }
        return next;
      });
      flash("Item deleted");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete item");
    } finally {
      setDeletingItemId(null);
    }
  }

  // ── Update a garment order item field ──────────────────────────────────────
  async function handleUpdateGarmentOrderItem(
    goId: string,
    itemId: string,
    patch: Partial<GarmentOrderItemRow>,
  ) {
    try {
      await updateTableRow("garment_orders_items", itemId, patch as Record<string, unknown>);
      setItemsByGO((prev) => {
        const next = new Map(prev);
        const items = next.get(goId);
        if (items) {
          next.set(
            goId,
            items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
          );
        }
        return next;
      });
      // Any item write re-derives the garment + order totals server-side.
      await refreshOrderTotal();
      flash("Item updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
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
        label: JSON.stringify({ en: input.label || "Adjustment" }),
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
          style_captain_id: order.style_captain_id,
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

      // Body measurements paired with readings
      const body: BodyMeasurementWithMetric[] = (() => {
        const byMetricId = new Map(
          readingsList.map((r) => [r.measurement_metric_id, r]),
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

      // Garment measurement groups (materials) — match the PDF shape. The
      // resolved display label feeds the material page's "GARMENT: …" header
      // (garmentLabels.en is that builder's preferred name source).
      const garments: GarmentMeasurementGroup[] = pdfGoRows.map((row) => ({
        garmentOrderId: row.id,
        garmentId: row.garment_id,
        garmentSlug: null,
        garmentLabels: { en: garmentDisplayLabel(row.garment_id) },
        status: row.status,
        userNote: row.user_note,
        materials: materialsList.filter((m) => m.garment_order_id === row.id),
      }));

      // Style selections per garment order
      const styleGroups: StyleSelectionGroup[] = pdfGoRows.map((row) => ({
        garmentOrder: row,
        garmentLabel: garmentDisplayLabel(row.garment_id),
        basePrice:
          (row.garment_id ? garmentMap.get(row.garment_id)?.base_price : null) ??
          null,
        items: itemsByGOId.get(row.id) ?? [],
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

  /** Show a UPI payment QR for the outstanding balance (falls back to the
   *  grand total when already paid) — the same link embedded in the invoice
   *  PDF's QR, so a customer can scan and pay from either. */
  async function handleShowUpiQr() {
    if (!order) return;
    setUpiQrOpen(true);
    setUpiQrBusy(true);
    try {
      const due = computeBalanceDue(transactions, liveTotal);
      const amount = due > 0.5 ? due : liveTotal;
      const url = buildUpiPayUrl(amount, order.order_number ?? truncateId(order.id));
      setUpiQrUrl(url);
      setUpiQrAmount(amount);
      const { toDataURL } = await import("qrcode");
      setUpiQrImg(
        await toDataURL(url, {
          margin: 1,
          width: 480,
          errorCorrectionLevel: "M",
        }),
      );
    } catch (e) {
      setUpiQrOpen(false);
      alert(e instanceof Error ? e.message : "Failed to build UPI QR");
    } finally {
      setUpiQrBusy(false);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN MEASUREMENT OVERRIDE — open / save inline-editable grid
  // ──────────────────────────────────────────────────────────────────────────

  /** Open the measurements override panel for a specific job. Loads the
   *  metric catalog and the job's existing readings, then seeds the draft. */
  async function openMeasurements(jobId: string) {
    setMeasurementsJobId(jobId);
    setMetricsLoading(true);
    setDraftReadings(new Map());
    try {
      const [metricsList, readingsList] = await Promise.all([
        metricCatalog.length > 0
          ? Promise.resolve(metricCatalog)
          : fetchMeasurementMetrics(),
        fetchJobReadings(jobId),
      ]);
      if (metricCatalog.length === 0) setMetricCatalog(metricsList);
      setJobReadings(readingsList);

      // Seed draft from existing readings
      const draft = new Map<
        string,
        { value_numeric: string; value_text: string; unit: string; rowId?: string }
      >();
      for (const r of readingsList) {
        if (!r.measurement_metric_id) continue;
        draft.set(r.measurement_metric_id, {
          value_numeric: r.value_numeric !== null ? String(r.value_numeric) : "",
          value_text: r.value_text ?? "",
          unit: r.unit ?? "",
          rowId: r.id,
        });
      }
      setDraftReadings(draft);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load measurements");
    } finally {
      setMetricsLoading(false);
    }
  }

  function closeMeasurements() {
    setMeasurementsJobId(null);
    setDraftReadings(new Map());
    setNewMetricId("");
  }

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

  function setDraftField(
    metricId: string,
    field: "value_numeric" | "value_text" | "unit",
    value: string,
  ) {
    setDraftReadings((prev) => {
      const next = new Map(prev);
      const cur =
        next.get(metricId) ??
        { value_numeric: "", value_text: "", unit: "" };
      next.set(metricId, { ...cur, [field]: value });
      return next;
    });
  }

  function addMetricToDraft(metricId: string) {
    if (!metricId) return;
    setDraftReadings((prev) => {
      const next = new Map(prev);
      if (!next.has(metricId)) {
        next.set(metricId, { value_numeric: "", value_text: "", unit: "" });
      }
      return next;
    });
    setNewMetricId("");
  }

  function removeMetricFromDraft(metricId: string) {
    setDraftReadings((prev) => {
      const next = new Map(prev);
      next.delete(metricId);
      return next;
    });
  }

  /** Persist all draft readings to the `measurements` table via the generic
   *  CRUD API. Creates new rows, updates existing ones, and deletes rows
   *  that were removed from the draft. */
  async function saveMeasurements() {
    if (!measurementsJobId) return;
    setSavingMeasurements(true);
    try {
      const jobId = measurementsJobId;
      // Index existing readings by metric id for diff
      const existingByMetric = new Map(
        jobReadings
          .filter((r) => r.measurement_metric_id)
          .map((r) => [r.measurement_metric_id as string, r]),
      );

      // 1. Upsert all draft rows
      type UpsertResult = {
        metricId: string;
        created?: boolean;
        updated?: boolean;
        deleted?: boolean;
      };
      const upserts: Promise<UpsertResult | null>[] = Array.from(
        draftReadings.entries(),
      ).map(async ([metricId, draft]) => {
        const trimmedNum = draft.value_numeric.trim();
        const trimmedText = draft.value_text.trim();
        // Enforce exactly-one-value rule (BE CHECK constraint)
        const valueNumeric = trimmedNum === "" ? null : Number(trimmedNum);
        const valueText = trimmedText === "" ? null : trimmedText;
        // Skip if both empty and no existing row — nothing to write
        if (valueNumeric === null && valueText === null && !draft.rowId) {
          return null;
        }
        // If both are now null but there IS an existing row → delete it
        if (valueNumeric === null && valueText === null && draft.rowId) {
          await deleteTableRow("measurements", draft.rowId);
          return { metricId, deleted: true as const };
        }
        if (valueNumeric === null && valueText === null) return null;

        const payload: Record<string, unknown> = {
          measurement_job_id: jobId,
          measurement_metric_id: metricId,
          value_numeric: valueNumeric,
          value_text: valueText,
          unit: draft.unit.trim() || null,
          captured_at: new Date().toISOString(),
        };

        if (draft.rowId) {
          await updateTableRow("measurements", draft.rowId, payload);
          return { metricId, updated: true as const };
        } else {
          await createTableRow("measurements", payload);
          return { metricId, created: true as const };
        }
      });
      const results = (await Promise.all(upserts)).filter(
        (r): r is UpsertResult => r !== null,
      );

      // 2. Delete rows for metrics that were in jobReadings but no longer
      //    in draftReadings (i.e. the admin removed them)
      const removedMetrics = Array.from(existingByMetric.entries()).filter(
        ([mId]) => !draftReadings.has(mId),
      );
      await Promise.all(
        removedMetrics.map(async ([, r]) => {
          await deleteTableRow("measurements", r.id);
        }),
      );

      // 3. Reload job readings + refresh draft
      const fresh = await fetchJobReadings(jobId);
      setJobReadings(fresh);
      const redrafted = new Map<
        string,
        { value_numeric: string; value_text: string; unit: string; rowId?: string }
      >();
      for (const r of fresh) {
        if (!r.measurement_metric_id) continue;
        redrafted.set(r.measurement_metric_id, {
          value_numeric: r.value_numeric !== null ? String(r.value_numeric) : "",
          value_text: r.value_text ?? "",
          unit: r.unit ?? "",
          rowId: r.id,
        });
      }
      setDraftReadings(redrafted);

      const createdCount = results.filter((r) => r.created).length;
      const updatedCount = results.filter((r) => r.updated).length;
      const deletedCount =
        results.filter((r) => r.deleted).length + removedMetrics.length;
      const summary = [
        createdCount > 0 && `${createdCount} created`,
        updatedCount > 0 && `${updatedCount} updated`,
        deletedCount > 0 && `${deletedCount} deleted`,
      ]
        .filter(Boolean)
        .join(", ");
      flash(summary ? `Measurements saved (${summary})` : "No changes");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save measurements");
    } finally {
      setSavingMeasurements(false);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESET DESIGN — delete all garment_orders_items for a garment order
  // ──────────────────────────────────────────────────────────────────────────
  async function handleResetDesign(goId: string) {
    const items = itemsByGO.get(goId) ?? [];
    if (items.length === 0) {
      flash("No design items to reset");
      return;
    }
    if (
      !confirm(
        `Reset design? This will delete all ${items.length} style selections for this garment order and set the total to the base price.`,
      )
    ) {
      return;
    }
    setResettingGOId(goId);
    try {
      await Promise.all(items.map((it) => deleteTableRow("garment_orders_items", it.id)));
      // total_price is derived on the backend — don't set it directly. Just
      // refresh so the breakdown + grand total reflect the reset design.
      setItemsByGO((prev) => {
        const next = new Map(prev);
        next.set(goId, []);
        return next;
      });
      await refreshOrderTotal();
      flash("Design reset to base");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reset design");
    } finally {
      setResettingGOId(null);
    }
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

        {/* Style captain — resolved from the measurement job(s).
            Captains are assigned per job, not per order, so this is read-only. */}
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Style Captain
          </div>
          {(() => {
            const resolvedId =
              order.style_captain_id ??
              jobs.find((j) => j.style_captain_id)?.style_captain_id ??
              null;
            const resolved = resolvedId
              ? captains.find((c) => c.id === resolvedId) ?? null
              : null;
            if (!resolved) {
              return (
                <div className="mt-0.5 text-sm text-muted">Unassigned</div>
              );
            }
            return (
              <div className="mt-0.5">
                <div className="text-sm font-medium text-ink">
                  {resolved.name ?? "Unnamed"}
                </div>
                <div className="text-xs text-muted">
                  {resolved.phone ?? resolved.email ?? "—"}
                </div>
              </div>
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
            onBlur={(e) => {
              if (e.target.value !== (order.comments ?? "")) {
                handleUpdateOrderField({ comments: e.target.value });
              }
            }}
            rows={2}
            placeholder="Add internal comments…"
            className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
          />
          <div className="mt-1 text-[11px] text-muted">
            Edits saved automatically on blur.
          </div>
        </div>
      </div>

      {/* ─── Garment Orders ───────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold text-ink-navy">
            Garment Orders ({garmentOrders.length})
          </h2>
          <button
            onClick={() => setShowNewGOForm((v) => !v)}
            disabled={creatingGO}
            className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
          >
            {showNewGOForm ? "Cancel" : "+ New Garment Order"}
          </button>
        </div>

        {/* ── New Garment Order form ─────────────────────────────────────── */}
        {showNewGOForm && (
          <div className="mb-3 rounded-xl border border-tape/40 bg-tape/5 p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
              Create new garment order
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-[11px] font-medium text-muted">
                  Garment
                </label>
                <select
                  value={newGOGarmentId}
                  onChange={(e) => setNewGOGarmentId(e.target.value)}
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                >
                  <option value="">— Select garment —</option>
                  {garments.map((g) => (
                    <option key={g.id} value={g.id}>
                      {garmentLabel(g)} {g.gender ? `(${g.gender})` : ""} •{" "}
                      {formatPrice(g.base_price)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-[11px] font-medium text-muted">
                  Note
                </label>
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
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-800 disabled:opacity-50"
              >
                {creatingGO ? "Creating…" : "Create"}
              </button>
            </div>
            {newGOGarmentId && (
              <div className="mt-2 text-[11px] text-muted">
                {(() => {
                  const g = garmentMap.get(newGOGarmentId);
                  return g
                    ? `Base price: ${formatPrice(g.base_price)}`
                    : null;
                })()}
              </div>
            )}
          </div>
        )}

        {garmentOrders.length === 0 && !showNewGOForm ? (
          <div className="rounded-lg border border-hairline bg-chalk-white px-4 py-6 text-center text-sm text-muted">
            No garment orders in this order. Click “+ New Garment Order” to add one.
          </div>
        ) : (
          <div className="space-y-3">
            {garmentOrders.map((go) => {
              const expanded = expandedGOs.has(go.id);
              const items = itemsByGO.get(go.id);
              return (
                <div
                  key={go.id}
                  className="overflow-hidden rounded-xl border border-hairline bg-chalk-white"
                >
                  {/* GO header */}
                  <div className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-mist-navy/30">
                    <div
                      className="flex flex-1 items-center gap-3"
                      onClick={() => toggleGO(go.id)}
                    >
                      <svg
                        className={`h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div>
                        <div className="text-sm font-medium text-ink-navy">
                          {garmentDisplayLabel(go.garment_id)}
                        </div>
                        <div className="text-[11px] text-muted">
                          GO ID: {truncateId(go.id)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge value={go.status} />
                      <span className="font-mono text-sm text-ink">
                        {formatPrice(go.total_price)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGOId((cur) => (cur === go.id ? null : go.id));
                        }}
                        title="Edit design"
                        className="rounded-md border border-hairline-strong px-2 py-1 text-xs font-medium text-ink-navy transition hover:bg-mist-navy"
                      >
                        {editingGOId === go.id ? "Close editor" : "Edit design"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGarmentOrder(go.id);
                        }}
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

                  {/* GO expanded content */}
                  {expanded && (
                    <div className="border-t border-hairline px-4 py-3">
                      {/* Status editor */}
                      <div className="mb-3 flex flex-wrap items-end gap-3">
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                            Garment Order Status
                          </div>
                          <select
                            value={go.status ?? ""}
                            onChange={(e) =>
                              handleUpdateGarmentOrder(go.id, {
                                status: (e.target.value || null) as GarmentOrderStatus | null,
                              })
                            }
                            className="mt-0.5 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs focus:border-ink-navy focus:outline-none"
                          >
                            <option value="">— None —</option>
                            {GARMENT_ORDER_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                            Total Price
                          </div>
                          <div className="mt-0.5 font-mono text-sm text-ink">
                            {formatPrice(go.total_price)}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted">
                            Auto-derived from design + adjustments.{" "}
                            <button
                              onClick={() => handleResetDesign(go.id)}
                              disabled={resettingGOId === go.id}
                              className="font-medium text-red-600 underline hover:text-red-700 disabled:opacity-50"
                              title="Delete all style selections; total re-derives from base"
                            >
                              {resettingGOId === go.id
                                ? "Resetting…"
                                : "Reset design"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Inline-editable user_note */}
                      <div className="mb-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                          User Note
                        </div>
                        <textarea
                          value={go.user_note ?? ""}
                          onChange={(e) => {
                            setGarmentOrders((prev) =>
                              prev.map((g) =>
                                g.id === go.id ? { ...g, user_note: e.target.value } : g,
                              ),
                            );
                          }}
                          onBlur={(e) => {
                            if (e.target.value !== (go.user_note ?? "")) {
                              handleUpdateGarmentOrder(go.id, {
                                user_note: e.target.value || null,
                              });
                            }
                          }}
                          rows={2}
                          placeholder="Add a note for this garment order…"
                          className="mt-0.5 w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-xs focus:border-ink-navy focus:outline-none"
                        />
                        <div className="mt-0.5 text-[10px] text-muted">
                          Saved on blur.
                        </div>
                      </div>

                      {/* Design inspiration images — upload / remove per GO */}
                      <GarmentOrderAssets
                        go={go}
                        onAttach={attachGOImageUrls}
                        onDetach={detachGOImageUrl}
                      />

                      {/* Design editor: "Upload Reference" (AI) vs "Manual Select" */}
                      {editingGOId === go.id && (
                        <div className="mb-4">
                          {goAIPrefill[go.id] ? (
                            /* ── AI prefilled: reference image + editor + composer ── */
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={goAIPrefill[go.id].imageUrl}
                                  alt="Reference design"
                                  className="max-h-[280px] rounded-lg border border-hairline object-contain"
                                />
                                <button
                                  onClick={() => {
                                    setGoAIPrefill((prev) => {
                                      const next = { ...prev };
                                      delete next[go.id];
                                      return next;
                                    });
                                  }}
                                  className="shrink-0 rounded-md border border-hairline-strong px-2 py-1 text-[11px] text-muted hover:bg-mist-navy"
                                >
                                  Reset
                                </button>
                              </div>

                              <GarmentOrderEditor
                                key={`${go.id}-ai-${goAIIterations[go.id] ?? 0}`}
                                garmentId={go.garment_id}
                                garmentOrderId={go.id}
                                initialItems={goAIPrefill[go.id].items}
                                basePrice={
                                  garmentMap.get(go.garment_id)?.base_price ?? null
                                }
                                onSaveComplete={(updated) => {
                                  setItemsByGO((prev) => {
                                    const next = new Map(prev);
                                    next.set(go.id, updated);
                                    return next;
                                  });
                                  // total_price is derived server-side from the
                                  // saved items (+ adjustments); pull the
                                  // recomputed garment + order totals.
                                  refreshOrderTotal();
                                  flash("Design saved");
                                }}
                                onCancel={() => setEditingGOId(null)}
                              />

                              {/* Composer for further AI refinement */}
                              <DesignFromImage
                                garmentId={go.garment_id}
                                garmentOrderId={go.id}
                                composerOnly
                                threadId={ensureGOThreadId(go.id)}
                                onApplyDraft={(selections, addons, imageUrl) =>
                                  applyGODesign(go.id, selections, addons, imageUrl)
                                }
                                onImageUrl={(imageUrl) =>
                                  applyGOImageUrl(go.id, imageUrl)
                                }
                              />
                            </div>
                          ) : (
                            /* ── Tabbed: AI upload vs manual select ── */
                            <>
                              <div className="mb-2 flex gap-1 border-b border-hairline">
                                <button
                                  onClick={() =>
                                    setGoDesignTabs((prev) => ({
                                      ...prev,
                                      [go.id]: "upload",
                                    }))
                                  }
                                  className={`border-b-2 px-3 py-1.5 text-xs font-medium transition ${
                                    (goDesignTabs[go.id] ?? "manual") === "upload"
                                      ? "border-ink-navy text-ink-navy"
                                      : "border-transparent text-muted hover:text-ink"
                                  }`}
                                >
                                  Upload Reference
                                </button>
                                <button
                                  onClick={() =>
                                    setGoDesignTabs((prev) => ({
                                      ...prev,
                                      [go.id]: "manual",
                                    }))
                                  }
                                  className={`border-b-2 px-3 py-1.5 text-xs font-medium transition ${
                                    goDesignTabs[go.id] === "manual"
                                      ? "border-ink-navy text-ink-navy"
                                      : "border-transparent text-muted hover:text-ink"
                                  }`}
                                >
                                  Manual Select
                                </button>
                              </div>

                              {(goDesignTabs[go.id] ?? "manual") === "upload" ? (
                                <DesignFromImage
                                  garmentId={go.garment_id}
                                  garmentOrderId={go.id}
                                  threadId={ensureGOThreadId(go.id)}
                                  onApplyDraft={(selections, addons, imageUrl) =>
                                    applyGODesign(
                                      go.id,
                                      selections,
                                      addons,
                                      imageUrl,
                                    )
                                  }
                                  onImageUrl={(imageUrl) =>
                                    applyGOImageUrl(go.id, imageUrl)
                                  }
                                  onCancel={() => setEditingGOId(null)}
                                />
                              ) : (
                                <GarmentOrderEditor
                                  key={go.id}
                                  garmentId={go.garment_id}
                                  garmentOrderId={go.id}
                                  initialItems={items ?? []}
                                  basePrice={
                                    garmentMap.get(go.garment_id)?.base_price ?? null
                                  }
                                  onSaveComplete={(updated) => {
                                    setItemsByGO((prev) => {
                                      const next = new Map(prev);
                                      next.set(go.id, updated);
                                      return next;
                                    });
                                    // total_price is derived server-side from
                                    // the saved items (+ adjustments); pull the
                                    // recomputed garment + order totals.
                                    refreshOrderTotal();
                                    flash("Design saved");
                                  }}
                                  onCancel={() => setEditingGOId(null)}
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* Items */}
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                        Items {items && items.length > 0 ? `(${items.length})` : ""}
                      </div>
                      {items === undefined ? (
                        <div className="py-3 text-xs text-muted">Loading items…</div>
                      ) : items.length === 0 ? (
                        <div className="py-3 text-xs text-muted">No items.</div>
                      ) : (
                        <div className="mt-1 overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-hairline text-[10px] uppercase tracking-wide text-muted">
                                <th className="py-2 pr-3 font-medium">Type</th>
                                <th className="py-2 pr-3 font-medium">Label</th>
                                <th className="py-2 pr-3 font-medium">Placement</th>
                                <th className="py-2 pr-3 text-right font-medium">Price</th>
                                <th className="py-2 pr-3 font-medium">IDs</th>
                                <th className="py-2 font-medium"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((it) => (
                                <tr key={it.id} className="border-b border-hairline last:border-0">
                                  <td className="py-2 pr-3">
                                    <span className={`rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                                      it.type === "variation"
                                        ? "bg-blue-50 text-blue-700"
                                        : it.type === "add_on"
                                        ? "bg-purple-50 text-purple-700"
                                        : "bg-gray-100 text-gray-600"
                                    }`}>
                                      {it.type ?? "—"}
                                    </span>
                                  </td>
                                  <td className="py-2 pr-3 text-ink">
                                    {it.label_snapshot ?? "—"}
                                  </td>
                                  <td className="py-2 pr-3 text-muted">
                                    {Array.isArray(it.placement)
                                      ? it.placement.join(", ") || "—"
                                      : it.placement ?? "—"}
                                  </td>
                                  <td className="py-2 pr-3 text-right font-mono text-sm text-ink">
                                    {/* Snapshot from catalog at checkout — read-only.
                                        To change a price, add an adjustment. */}
                                    {it.price != null ? formatPrice(it.price) : "—"}
                                  </td>
                                  <td className="py-2 pr-3 text-[10px] text-muted">
                                    {it.variation_id && <div>var: {truncateId(it.variation_id)}</div>}
                                    {it.addon_id && <div>addon: {truncateId(it.addon_id)}</div>}
                                  </td>
                                  <td className="py-2">
                                    <button
                                      onClick={() => handleDeleteGarmentOrderItem(go.id, it.id)}
                                      disabled={deletingItemId === it.id}
                                      title="Delete item"
                                      className="flex h-6 w-6 items-center justify-center rounded text-red-500 transition hover:bg-red-50 disabled:opacity-40"
                                    >
                                      {deletingItemId === it.id ? (
                                        <span className="text-[9px]">…</span>
                                      ) : (
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                                          <path d="M3 5h10M6 5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V5M5 5l.5 8a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      )}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Garment-level adjustments now live in the Price
                          Breakdown section below (single source of truth for
                          all money UI). This block is intentionally omitted
                          here to avoid duplication. */}
                    </div>
                  )}
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

                {/* ── Admin measurement override panel ─────────────────────── */}
                {measurementsJobId === job.id && (
                  <div className="mt-3 rounded-lg border border-tape/40 bg-tape/5 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                        Admin Measurement Override
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveMeasurements}
                          disabled={
                            savingMeasurements || metricsLoading
                          }
                          className="rounded-md bg-green-700 px-3 py-1 text-xs font-medium text-white transition hover:bg-green-800 disabled:opacity-50"
                        >
                          {savingMeasurements ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={closeMeasurements}
                          className="rounded-md border border-hairline-strong px-3 py-1 text-xs text-muted hover:bg-mist-navy"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted">
                      Exactly one of <code>value_numeric</code> or{" "}
                      <code>value_text</code> must be set per row (DB CHECK
                      constraint). Blank both to delete.
                    </div>

                    {metricsLoading ? (
                      <div className="py-3 text-xs text-muted">
                        Loading metrics…
                      </div>
                    ) : metricCatalog.length === 0 ? (
                      <div className="py-3 text-xs text-muted">
                        No measurement metrics found in catalog.
                      </div>
                    ) : (
                      <>
                        {/* Draft grid */}
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full min-w-[600px] text-left text-xs">
                            <thead>
                              <tr className="border-b border-hairline text-[10px] uppercase tracking-wide text-muted">
                                <th className="py-2 pr-2 font-medium">Metric</th>
                                <th className="py-2 pr-2 font-medium">Numeric</th>
                                <th className="py-2 pr-2 font-medium">Text</th>
                                <th className="py-2 pr-2 font-medium">Unit</th>
                                <th className="py-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from(draftReadings.entries()).map(
                                ([metricId, draft]) => {
                                  const metric = metricCatalog.find(
                                    (m) => m.id === metricId,
                                  );
                                  const label =
                                    metric?.labels?.en ??
                                    metric?.code ??
                                    truncateId(metricId);
                                  return (
                                    <tr
                                      key={metricId}
                                      className="border-b border-hairline last:border-0"
                                    >
                                      <td className="py-2 pr-2 text-ink">
                                        {label}
                                      </td>
                                      <td className="py-2 pr-2">
                                        <input
                                          type="number"
                                          step="any"
                                          value={draft.value_numeric}
                                          onChange={(e) =>
                                            setDraftField(
                                              metricId,
                                              "value_numeric",
                                              e.target.value,
                                            )
                                          }
                                          className="w-24 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs focus:border-ink-navy focus:outline-none"
                                        />
                                      </td>
                                      <td className="py-2 pr-2">
                                        <input
                                          type="text"
                                          value={draft.value_text}
                                          onChange={(e) =>
                                            setDraftField(
                                              metricId,
                                              "value_text",
                                              e.target.value,
                                            )
                                          }
                                          className="w-32 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs focus:border-ink-navy focus:outline-none"
                                        />
                                      </td>
                                      <td className="py-2 pr-2">
                                        <input
                                          type="text"
                                          value={draft.unit}
                                          onChange={(e) =>
                                            setDraftField(
                                              metricId,
                                              "unit",
                                              e.target.value,
                                            )
                                          }
                                          className="w-16 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs focus:border-ink-navy focus:outline-none"
                                        />
                                      </td>
                                      <td className="py-2">
                                        <button
                                          onClick={() =>
                                            removeMetricFromDraft(metricId)
                                          }
                                          title="Remove"
                                          className="flex h-6 w-6 items-center justify-center rounded text-red-500 transition hover:bg-red-50"
                                        >
                                          <svg
                                            className="h-3.5 w-3.5"
                                            viewBox="0 0 16 16"
                                            fill="none"
                                          >
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
                                  );
                                },
                              )}
                              {draftReadings.size === 0 && (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="py-3 text-center text-muted"
                                  >
                                    No metrics yet — add one below.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Add metric row */}
                        <div className="mt-2 flex items-center gap-2">
                          <select
                            value={newMetricId}
                            onChange={(e) => setNewMetricId(e.target.value)}
                            className="flex-1 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs focus:border-ink-navy focus:outline-none"
                          >
                            <option value="">— Add metric to override —</option>
                            {metricCatalog
                              .filter(
                                (m) =>
                                  !draftReadings.has(m.id) &&
                                  !jobReadings.some(
                                    (r) => r.measurement_metric_id === m.id,
                                  ),
                              )
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.labels?.en ?? m.code ?? truncateId(m.id)}
                                </option>
                              ))}
                          </select>
                          <button
                            onClick={() => addMetricToDraft(newMetricId)}
                            disabled={!newMetricId}
                            className="rounded-md bg-ink-navy px-3 py-1 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
                          >
                            + Add
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

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
              onClick={handleShowUpiQr}
              disabled={upiQrBusy}
              title="Show a UPI payment QR for the balance due"
              className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ▣ UPI QR
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
              const lines = buildGarmentBreakdown(go, items, basePrice);
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

      {/* ─── UPI payment QR sheet ──────────────────────────────────────────── */}
      <BottomSheet
        open={upiQrOpen}
        onClose={() => setUpiQrOpen(false)}
        title="UPI Payment"
      >
        <div className="flex flex-col items-center gap-4 py-2">
          {upiQrImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={upiQrImg}
              alt="UPI payment QR"
              className="h-56 w-56 rounded-xl border border-hairline bg-white p-2"
            />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-hairline text-xs text-muted">
              {upiQrBusy ? "Building QR…" : "QR unavailable"}
            </div>
          )}
          <div className="text-center">
            <div className="font-mono text-lg font-semibold text-ink">
              {formatPrice(upiQrAmount)}
            </div>
            <div className="text-[11px] text-muted">
              Scan with any UPI app &bull; {UPI_VPA}
            </div>
          </div>
          {upiQrUrl && (
            <div className="w-full">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">
                Payment link
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-mist-navy/40 px-2 py-1 text-[11px] text-ink">
                  {upiQrUrl}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(upiQrUrl).catch(() => {});
                    flash("UPI link copied");
                  }}
                  className="shrink-0 rounded border border-hairline px-2 py-1 text-[11px] text-ink hover:bg-mist-navy"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

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
