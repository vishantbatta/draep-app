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
} from "@/lib/admin-api";
import { downloadMeasurementJobPdf, type StyleSelectionGroup } from "@/lib/job-pdf";
import { GarmentOrderEditor } from "./GarmentOrderEditor";

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
  "failed",
  "refunded",
  "partial_refunded",
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = params.id;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [customer, setCustomer] = useState<UserRow | null>(null);
  const [address, setAddress] = useState<AddressRow | null>(null);
  const [captain, setCaptain] = useState<UserRow | null>(null);
  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [garmentOrders, setGarmentOrders] = useState<GarmentOrderRow[]>([]);
  const [jobs, setJobs] = useState<MeasurementJobRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [itemsByGO, setItemsByGO] = useState<Map<string, GarmentOrderItemRow[]>>(
    new Map(),
  );
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

  // ── New measurement job form state ────────────────────────────────────────
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [newJobStatus, setNewJobStatus] = useState<JobStatus>("scheduled");
  const [newJobCaptainId, setNewJobCaptainId] = useState("");
  const [newJobScheduledAt, setNewJobScheduledAt] = useState("");
  const [newJobNotes, setNewJobNotes] = useState("");
  const [creatingJob, setCreatingJob] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCaptain, setSavingCaptain] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ── PDF download state ─────────────────────────────────────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);

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
  // For admin total_price override toggle
  const [priceOverrideGOId, setPriceOverrideGOId] = useState<string | null>(null);

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
      if (ord.style_captain_id) {
        fetchUserById(ord.style_captain_id)
          .then(setCaptain)
          .catch(() => {});
      }

      // 3. Load garment orders, jobs, transactions in parallel
      const [gos, mj, tx] = await Promise.all([
        fetchGarmentOrdersForOrder(orderId),
        fetchJobsForOrder(orderId),
        fetchTransactionsForOrder(orderId),
      ]);
      setGarmentOrders(gos);
      setJobs(mj);
      setTransactions(tx);

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

  // ── Load items for expanded garment orders ─────────────────────────────────
  useEffect(() => {
    for (const go of garmentOrders) {
      if (expandedGOs.has(go.id) && !itemsByGO.has(go.id)) {
        fetchGarmentOrderItems(go.id)
          .then((items) => {
            setItemsByGO((prev) => {
              const next = new Map(prev);
              next.set(go.id, items);
              return next;
            });
          })
          .catch(() => {});
      }
    }
  }, [expandedGOs, garmentOrders, itemsByGO]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleAssignCaptain(captainId: string | null) {
    if (!order) return;
    setSavingCaptain(true);
    try {
      await updateOrder(order.id, {
        style_captain_id: captainId as string | null,
      });
      setOrder({ ...order, style_captain_id: captainId });
      if (captainId) {
        const u = await fetchUserById(captainId);
        setCaptain(u);
        flash("Style captain assigned");
      } else {
        setCaptain(null);
        flash("Style captain unassigned");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to assign captain");
    } finally {
      setSavingCaptain(false);
    }
  }

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

  // ── Create a new garment order ─────────────────────────────────────────────
  async function handleCreateGarmentOrder() {
    if (!order) return;
    if (!newGOGarmentId) {
      alert("Please select a garment");
      return;
    }
    setCreatingGO(true);
    try {
      // Price will be auto-calculated from the design editor (via onComputedTotalChange)
      const created = await createGarmentOrder({
        order_id: orderId,
        garment_id: newGOGarmentId,
        total_price: null,
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
        scheduled_at: newJobScheduledAt
          ? new Date(newJobScheduledAt).toISOString()
          : null,
        notes: newJobNotes.trim() || null,
      });
      setJobs((prev) => [created, ...prev]);
      // reset form
      setShowNewJobForm(false);
      setNewJobStatus("scheduled");
      setNewJobCaptainId("");
      setNewJobScheduledAt("");
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
      flash("Item updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  }

  // ── Resolve garment display label ──────────────────────────────────────────
  function garmentDisplayLabel(garmentId: string | null | undefined): string {
    if (!garmentId) return "Unknown garment";
    const g = garmentMap.get(garmentId);
    if (g) return garmentLabel(g);
    return `Garment ${truncateId(garmentId)}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PDF DOWNLOAD — assembles cover + body + garment + style-selections pages
  // ──────────────────────────────────────────────────────────────────────────
  async function handleDownloadPdf() {
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
      const metricsList = await fetchMeasurementMetrics();
      setPdfProgress("Loading measurements…");
      const readingsList = await fetchJobReadings(jobForPdf.id);

      setPdfProgress("Loading garment details…");
      // Fetch fresh GO list + materials (use the order-id-scoped helpers so we
      // also pick up GOs whose items haven't been expanded on the page yet).
      const [goList, materialsList] = await Promise.all([
        fetchOrderGarmentOrders(order.id),
        fetchOrderGarmentMaterials(order.id),
      ]);

      // Items per garment order (for style pages)
      setPdfProgress("Loading style selections…");
      const itemsByGOId = new Map<string, GarmentOrderItemRow[]>();
      // Use cached items if present, otherwise fetch.
      await Promise.all(
        goList.map(async (go) => {
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

      // Garment measurement groups (materials) — match the PDF shape
      const garments: GarmentMeasurementGroup[] = goList.map((go) => ({
        garmentOrderId: go.id,
        garmentId: go.garment_id,
        garmentSlug: null,
        garmentLabels: null,
        status: go.status,
        userNote: go.user_note,
        materials: materialsList.filter((m) => m.garment_order_id === go.id),
      }));

      // Style selections per garment order
      const styleGroups: StyleSelectionGroup[] = goList.map((go) => {
        const liveGO = garmentOrders.find((g) => g.id === go.id);
        return {
          garmentOrder: {
            // Map GarmentOrderInstanceRow → GarmentOrderRow shape expected by PDF
            id: go.id,
            order_id: go.order_id ?? order.id,
            garment_id: liveGO?.garment_id ?? "",
            total_price: liveGO?.total_price ?? null,
            status: (go.status as GarmentOrderStatus | null) ?? null,
            user_note: go.user_note,
            assets_shared: null,
          },
          garmentLabel: garmentDisplayLabel(liveGO?.garment_id ?? go.garment_id),
          basePrice: (liveGO?.garment_id
            ? garmentMap.get(liveGO.garment_id)?.base_price
            : null) ?? null,
          items: itemsByGOId.get(go.id) ?? [],
        };
      });

      await downloadMeasurementJobPdf(
        {
          job: jobForPdf,
          customer,
          order,
          address,
          bodyMeasurements: body,
          garmentMeasurements: garments,
          styleSelections: styleGroups,
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
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF generation failed");
    } finally {
      setPdfLoading(false);
      setPdfProgress(null);
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
      const go = garmentOrders.find((g) => g.id === goId);
      const garment = go?.garment_id ? garmentMap.get(go.garment_id) : null;
      const basePrice = garment?.base_price ?? null;
      if (go && basePrice !== null) {
        await updateGarmentOrder(goId, { total_price: basePrice });
      }
      setItemsByGO((prev) => {
        const next = new Map(prev);
        next.set(goId, []);
        return next;
      });
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
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              className="rounded-lg border border-ink-navy bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
              title="Download a PDF with measurements, garment details, and style selections"
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
                {formatPrice(
                  garmentOrders.reduce(
                    (sum, go) => sum + (go.total_price ?? 0),
                    0,
                  ),
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-muted">
                Auto-calculated from garment orders.
              </div>
              <div className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">
                Advance Amount
              </div>
              <EditableNumber
                value={order.advance_amount}
                label="Advance amount"
                onSave={(v) => handleUpdateOrderField({ advance_amount: v })}
              />
            </div>

            {/* Slot */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Slot
              </div>
              <div className="text-sm text-ink">{formatOrderSlot(order.slot)}</div>
            </div>
          </div>
        </div>

        {/* Style captain assignment */}
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Style Captain
              </div>
              {captain ? (
                <div className="mt-0.5">
                  <div className="text-sm font-medium text-ink">
                    {captain.name ?? "Unnamed"}
                  </div>
                  <div className="text-xs text-muted">
                    {captain.phone ?? captain.email ?? "—"}
                  </div>
                </div>
              ) : (
                <div className="mt-0.5 text-sm text-muted">Unassigned</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={order.style_captain_id ?? ""}
                onChange={(e) =>
                  handleAssignCaptain(e.target.value || null)
                }
                disabled={savingCaptain}
                className="rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none disabled:opacity-50"
              >
                <option value="">— Unassigned —</option>
                {captains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.phone ?? truncateId(c.id)}
                  </option>
                ))}
              </select>
              {order.style_captain_id && (
                <button
                  onClick={() => handleAssignCaptain(null)}
                  disabled={savingCaptain}
                  className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Unassign
                </button>
              )}
            </div>
          </div>
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
                            {priceOverrideGOId === go.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="any"
                                  defaultValue={go.total_price ?? ""}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const v = (e.target as HTMLInputElement).value;
                                      handleUpdateGarmentOrder(go.id, {
                                        total_price: v === "" ? null : Number(v),
                                      });
                                      setPriceOverrideGOId(null);
                                    } else if (e.key === "Escape") {
                                      setPriceOverrideGOId(null);
                                    }
                                  }}
                                  className="w-28 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-sm focus:border-ink-navy focus:outline-none"
                                />
                                <button
                                  onClick={() => {
                                    const el = document.querySelector<HTMLInputElement>(
                                      `input[type="number"][autofocus]`,
                                    );
                                    const v = el?.value ?? "";
                                    handleUpdateGarmentOrder(go.id, {
                                      total_price: v === "" ? null : Number(v),
                                    });
                                    setPriceOverrideGOId(null);
                                  }}
                                  className="rounded-md bg-ink-navy px-2 py-1 text-xs font-medium text-chalk-white"
                                >
                                  Set
                                </button>
                                <button
                                  onClick={() => setPriceOverrideGOId(null)}
                                  className="rounded-md border border-hairline-strong px-2 py-1 text-xs text-muted"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPriceOverrideGOId(go.id)}
                                title="Click to override (default is auto-calculated)"
                                className="font-mono hover:text-tape hover:underline"
                              >
                                {formatPrice(go.total_price)}
                              </button>
                            )}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted">
                            Click price to override.{" "}
                            <button
                              onClick={() => handleResetDesign(go.id)}
                              disabled={resettingGOId === go.id}
                              className="font-medium text-red-600 underline hover:text-red-700 disabled:opacity-50"
                              title="Delete all style selections and reset total to base price"
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

                      {/* Design editor (catalog-driven, same flow as /style) */}
                      {editingGOId === go.id && (
                        <div className="mb-4">
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
                              flash("Design saved");
                            }}
                            onCancel={() => setEditingGOId(null)}
                            onComputedTotalChange={(total) => {
                              // Only update if the computed total differs from the GO's current total_price
                              if (go.total_price !== total) {
                                handleUpdateGarmentOrder(go.id, {
                                  total_price: total,
                                });
                              }
                            }}
                          />
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
                                    {it.placement ?? "—"}
                                  </td>
                                  <td className="py-2 pr-3 text-right">
                                    <EditableNumber
                                      value={it.price}
                                      label="Item price"
                                      onSave={(v) =>
                                        handleUpdateGarmentOrderItem(go.id, it.id, { price: v })
                                      }
                                    />
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

              {/* Style captain */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Style Captain
                </span>
                <select
                  value={newJobCaptainId}
                  onChange={(e) => setNewJobCaptainId(e.target.value)}
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                >
                  <option value="">— Unassigned —</option>
                  {captains.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.phone ?? truncateId(c.id)}
                    </option>
                  ))}
                </select>
              </label>

              {/* Scheduled at */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Scheduled at
                </span>
                <input
                  type="datetime-local"
                  value={newJobScheduledAt}
                  onChange={(e) => setNewJobScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                />
              </label>

              {/* Notes */}
              <label className="block">
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
                  setNewJobScheduledAt("");
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
                    {job.performed_at && (
                      <div className="text-[11px] text-muted">
                        Performed: {formatDate(job.performed_at)}
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
                  </div>
                </div>
                {job.notes && (
                  <div className="mt-2 text-xs text-ink">
                    <span className="font-medium">Notes:</span> {job.notes}
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

      {/* ─── Transactions ─────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-ink-navy">
          Transactions ({transactions.length})
        </h2>
        {transactions.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-chalk-white px-4 py-6 text-center text-sm text-muted">
            No transactions for this order.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Method</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-2 text-[13px]">{tx.type ?? "—"}</td>
                    <td className="px-4 py-2 text-[13px]">{tx.provider ?? "—"}</td>
                    <td className="px-4 py-2">
                      <StatusBadge value={tx.status} />
                    </td>
                    <td className="px-4 py-2 text-[13px]">{tx.method ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-[13px]">
                      {formatPrice(tx.amount)}
                    </td>
                    <td className="px-4 py-2 text-[12px] text-muted">
                      {formatDate(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
