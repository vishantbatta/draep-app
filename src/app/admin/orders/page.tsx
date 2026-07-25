"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createOrder,
  createTableRow,
  fetchTableRows,
  fetchUserById,
  fetchGarments,
  garmentLabel,
  type OrderRow,
  type UserRow,
  type GarmentRow,
  type GarmentOrderItemRow,
  type FulfillmentStatus,
  type PaymentStatus,
} from "@/lib/admin-api";
import { GarmentOrderEditor } from "./[id]/GarmentOrderEditor";

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

const STATUS_STYLE: Record<string, string> = {
  // Fulfillment
  draft: "bg-gray-100 text-gray-600",
  pending: "bg-amber-100 text-amber-800",
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
  // Payment
  paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
  refunded: "bg-purple-100 text-purple-800",
  partial_refunded: "bg-orange-100 text-orange-800",
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
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function truncateId(id: string): string {
  return id.slice(0, 8);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersListPage() {
  const router = useRouter();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [filterFulfillment, setFilterFulfillment] = useState<FulfillmentStatus | "all">("all");
  const [filterPayment, setFilterPayment] = useState<PaymentStatus | "all">("all");

  // Cache of customer users (id -> UserRow) for display
  const [userCache, setUserCache] = useState<Map<string, UserRow>>(new Map());

  // ── New Order form state ──────────────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Customer search
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<UserRow[]>([]);
  const [custOpen, setCustOpen] = useState(false);
  const [selectedCust, setSelectedCust] = useState<UserRow | null>(null);
  const custSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form fields
  const [fAdvance, setFAdvance] = useState("");
  const [fFulfillment, setFFulfillment] = useState<FulfillmentStatus>("draft");
  const [fPayment, setFPayment] = useState<PaymentStatus>("pending");
  const [fSlot, setFSlot] = useState("");
  const [fComments, setFComments] = useState("");
  const [fOrderNumber, setFOrderNumber] = useState("");

  // Garment + style selection for new order
  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [garmentsLoading, setGarmentsLoading] = useState(false);
  const [selectedGarmentId, setSelectedGarmentId] = useState<string>("");
  const [draftItems, setDraftItems] = useState<
    import("./[id]/GarmentOrderEditor").DraftItem[]
  >([]);
  const [computedTotal, setComputedTotal] = useState(0);

  // Eagerly load garments when the create form opens
  useEffect(() => {
    if (!showCreateForm || garments.length > 0) return;
    let cancelled = false;
    setGarmentsLoading(true);
    fetchGarments()
      .then((g) => {
        if (!cancelled) setGarments(g);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setGarmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCreateForm, garments.length]);

  // ── Customer search (debounced) ───────────────────────────────────────────
  useEffect(() => {
    if (custSearchTimer.current) clearTimeout(custSearchTimer.current);
    if (!custSearch.trim() || selectedCust) {
      setCustResults([]);
      return;
    }
    custSearchTimer.current = setTimeout(async () => {
      try {
        // Try phone match first, then name
        const q = custSearch.trim();
        const { rows } = await fetchTableRows<UserRow>("users", {
          perPage: 10,
          filters: { phone: q },
        });
        // If nothing from phone, try name
        if (rows.length === 0) {
          const { rows: nameRows } = await fetchTableRows<UserRow>("users", {
            perPage: 10,
            filters: { name: q },
          });
          setCustResults(nameRows);
        } else {
          setCustResults(rows);
        }
        setCustOpen(true);
      } catch {
        setCustResults([]);
      }
    }, 300);
    return () => {
      if (custSearchTimer.current) clearTimeout(custSearchTimer.current);
    };
  }, [custSearch, selectedCust]);

  // ── Emit sidebar items ────────────────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "All Orders",
              active: true,
              onClick: () => router.push("/admin/orders"),
            },
            {
              label: "Measurement Jobs",
              active: false,
              onClick: () => router.push("/admin/orders/measurement-jobs"),
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

  // ── Fetch orders ──────────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: Record<string, string> = {};
      if (filterFulfillment !== "all") filters.fulfillment_status = filterFulfillment;
      if (filterPayment !== "all") filters.payment_status = filterPayment;

      const { rows, total: t } = await fetchTableRows<OrderRow>("orders", {
        page,
        perPage,
        sortColumn: "created_at",
        sortDirection: "desc",
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      setOrders(rows);
      setTotal(t);

      // Resolve customer users for the rows
      const userIds = Array.from(
        new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]),
      );
      if (userIds.length > 0) {
        const newCache = new Map(userCache);
        await Promise.all(
          userIds.map(async (id) => {
            if (!newCache.has(id)) {
              try {
                const u = await fetchUserById(id);
                if (u) newCache.set(id, u);
              } catch {
                /* ignore */
              }
            }
          }),
        );
        setUserCache(newCache);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, filterFulfillment, filterPayment]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Auto-dismiss flash after 4s
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  // ── Reset form ────────────────────────────────────────────────────────────
  function resetForm() {
    setCustSearch("");
    setSelectedCust(null);
    setCustResults([]);
    setCustOpen(false);
    setFAdvance("");
    setFFulfillment("draft");
    setFPayment("pending");
    setFSlot("");
    setFComments("");
    setFOrderNumber("");
    setSelectedGarmentId("");
    setDraftItems([]);
    setComputedTotal(0);
  }

  // ── Handle create ─────────────────────────────────────────────────────────
  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      // The total price is auto-calculated from style selections
      const data: Partial<OrderRow> = {
        user_id: selectedCust?.id ?? null,
        fulfillment_status: fFulfillment,
        payment_status: fPayment,
      };
      // Use computed total (base + variations + addons) if a garment was selected
      if (selectedGarmentId && computedTotal > 0) {
        data.total_price = computedTotal;
      }
      const ap = parseInt(fAdvance, 10);
      if (!isNaN(ap)) data.advance_amount = ap;
      if (fSlot.trim()) data.slot = fSlot.trim();
      if (fComments.trim()) data.comments = fComments.trim();
      if (fOrderNumber.trim()) data.order_number = fOrderNumber.trim();

      const created = await createOrder(data);

      // If a garment was selected, create a garment_order + items
      if (selectedGarmentId) {
        const go = await createTableRow<{ id: string }>("garment_orders", {
          order_id: created.id,
          garment_id: selectedGarmentId,
          price: computedTotal > 0 ? computedTotal : null,
          status: "draft",
        });

        // Persist draft items for this garment order
        for (const item of draftItems) {
          await createTableRow<GarmentOrderItemRow>("garment_orders_items", {
            garment_order_id: go.id,
            type: item.type,
            garment_style_component_id: item.garment_style_component_id,
            variation_id: item.variation_id,
            variation_type_id: item.variation_type_id,
            addon_id: item.addon_id,
            addon_variation_id: item.addon_variation_id,
            placement: item.placement,
            price: item.price,
            label_snapshot: item.label_snapshot,
          });
        }
      }

      setShowCreateForm(false);
      resetForm();
      setFlash(`Order created (${truncateId(created.id)}) — redirecting…`);
      // Navigate to the detail page
      router.push(`/admin/orders/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create order");
    } finally {
      setCreating(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-ink-navy md:text-3xl">
            Orders
          </h1>
          <p className="mt-1 text-sm text-muted">
            {total} order{total !== 1 ? "s" : ""} • click a row to view detail
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreateForm((v) => !v);
            if (!showCreateForm) {
              setError(null);
              setFlash(null);
            }
          }}
          className="rounded-lg bg-ink-navy px-4 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-40"
        >
          {showCreateForm ? "✕ Cancel" : "+ New Order"}
        </button>
      </div>

      {/* Flash message */}
      {flash && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          {flash}
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <div className="mb-6 rounded-xl border border-hairline bg-chalk-white p-5">
          <h2 className="mb-4 text-sm font-bold text-ink-navy">Create new order</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Customer search */}
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted">
                Customer (search by phone or name)
              </label>
              {selectedCust ? (
                <div className="flex items-center justify-between rounded-lg border border-hairline-strong bg-mist-navy/20 px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-ink">
                      {selectedCust.name ?? "Unnamed"}
                    </span>
                    {selectedCust.phone && (
                      <span className="ml-2 text-xs text-muted">
                        {selectedCust.phone}
                      </span>
                    )}
                    {selectedCust.email && (
                      <span className="ml-2 text-xs text-muted">
                        {selectedCust.email}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setSelectedCust(null);
                      setCustSearch("");
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    ✕ Remove
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={custSearch}
                    onChange={(e) => setCustSearch(e.target.value)}
                    onFocus={() => custResults.length > 0 && setCustOpen(true)}
                    onBlur={() => setTimeout(() => setCustOpen(false), 200)}
                    placeholder="Type phone number or name…"
                    className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm text-ink focus:border-ink-navy focus:outline-none"
                  />
                  {custOpen && custResults.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-hairline-strong bg-chalk-white shadow-lg">
                      {custResults.map((u) => (
                        <button
                          key={u.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedCust(u);
                            setCustOpen(false);
                            setCustResults([]);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm transition hover:bg-mist-navy/30"
                        >
                          <div className="font-medium text-ink">
                            {u.name ?? "Unnamed"}
                          </div>
                          <div className="text-xs text-muted">
                            {u.phone ?? ""} {u.email ? `• ${u.email}` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Order number */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Order # (optional)
              </label>
              <input
                type="text"
                value={fOrderNumber}
                onChange={(e) => setFOrderNumber(e.target.value)}
                placeholder="auto-generated if blank"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              />
            </div>

            {/* Slot */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Slot (optional)
              </label>
              <input
                type="text"
                value={fSlot}
                onChange={(e) => setFSlot(e.target.value)}
                placeholder="e.g. morning, evening…"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              />
            </div>

            {/* Total price (auto-calculated from style selections) */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Total price (auto-calculated)
              </label>
              <div className="flex h-[38px] items-center rounded-lg border border-hairline-strong bg-mist-navy/20 px-3 text-sm font-mono text-ink">
                {selectedGarmentId && computedTotal > 0
                  ? formatPrice(computedTotal)
                  : "—"}
              </div>
              <div className="mt-0.5 text-[10px] text-muted">
                Calculated from garment base price + selected styles.
              </div>
            </div>

            {/* Advance */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Advance amount (₹, paise)
              </label>
              <input
                type="number"
                value={fAdvance}
                onChange={(e) => setFAdvance(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              />
            </div>

            {/* Fulfillment */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Fulfillment status
              </label>
              <select
                value={fFulfillment}
                onChange={(e) => setFFulfillment(e.target.value as FulfillmentStatus)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              >
                {FULFILLMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Payment status
              </label>
              <select
                value={fPayment}
                onChange={(e) => setFPayment(e.target.value as PaymentStatus)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              >
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Comments */}
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted">
                Comments (optional)
              </label>
              <textarea
                value={fComments}
                onChange={(e) => setFComments(e.target.value)}
                placeholder="Internal notes about this order…"
                rows={2}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              />
            </div>

            {/* Garment / Style selection */}
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted">
                Garment &amp; Style (optional)
              </label>
              <select
                value={selectedGarmentId}
                onChange={(e) => {
                  setSelectedGarmentId(e.target.value);
                  setDraftItems([]);
                }}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              >
                <option value="">
                  {garmentsLoading ? "Loading…" : "— No garment —"}
                </option>
                {garments.map((g) => (
                  <option key={g.id} value={g.id}>
                    {garmentLabel(g)}
                  </option>
                ))}
              </select>
            </div>

            {/* Inline style editor */}
            {selectedGarmentId && (
              <div className="md:col-span-2">
                <GarmentOrderEditor
                  key={selectedGarmentId}
                  garmentId={selectedGarmentId}
                  garmentOrderId="draft"
                  initialItems={[]}
                  basePrice={
                    garments.find((g) => g.id === selectedGarmentId)
                      ?.base_price ?? null
                  }
                  draftMode
                  draftSaving={creating}
                  onDraftChange={(items) => setDraftItems(items)}
                  onComputedTotalChange={(total) => setComputedTotal(total)}
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="rounded-lg bg-ink-navy px-5 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create order"}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                resetForm();
              }}
              className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink transition hover:bg-mist-navy/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Fulfillment filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Fulfillment:</span>
          <select
            value={filterFulfillment}
            onChange={(e) => {
              setPage(1);
              setFilterFulfillment(e.target.value as FulfillmentStatus | "all");
            }}
            className="rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1 text-xs text-ink focus:border-ink-navy focus:outline-none"
          >
            <option value="all">All</option>
            {FULFILLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        {/* Payment filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Payment:</span>
          <select
            value={filterPayment}
            onChange={(e) => {
              setPage(1);
              setFilterPayment(e.target.value as PaymentStatus | "all");
            }}
            className="rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1 text-xs text-ink focus:border-ink-navy focus:outline-none"
          >
            <option value="all">All</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        {(filterFulfillment !== "all" || filterPayment !== "all") && (
          <button
            onClick={() => {
              setFilterFulfillment("all");
              setFilterPayment("all");
              setPage(1);
            }}
            className="text-xs font-medium text-ink-navy underline hover:text-tape"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="py-12 text-center text-muted">Loading orders…</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          {orders.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-sm text-muted">
                No orders found.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Order #</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Fulfillment</th>
                    <th className="px-4 py-3 font-medium">Payment</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-right font-medium">Advance</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const customer = order.user_id
                      ? userCache.get(order.user_id)
                      : null;
                    return (
                      <tr
                        key={order.id}
                        onClick={() => router.push(`/admin/orders/${order.id}`)}
                        className="cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-[13px] font-medium text-ink-navy">
                            {order.order_number ?? `#${truncateId(order.id)}`}
                          </div>
                          <div className="text-[11px] text-muted">
                            id: {truncateId(order.id)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {customer ? (
                            <div>
                              <div className="text-[13px] text-ink">
                                {customer.name ?? "Unnamed"}
                              </div>
                              <div className="text-[11px] text-muted">
                                {customer.phone ?? customer.email ?? ""}
                              </div>
                            </div>
                          ) : order.user_id ? (
                            <span className="text-[11px] text-muted">
                              {truncateId(order.user_id)}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={order.fulfillment_status} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={order.payment_status} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[13px]">
                          {formatPrice(order.total_price)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[13px]">
                          {formatPrice(order.advance_amount)}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted">
                          {formatDate(order.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-muted">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition enabled:hover:bg-mist-navy disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition enabled:hover:bg-mist-navy disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
