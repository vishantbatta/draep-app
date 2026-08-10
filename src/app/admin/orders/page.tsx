"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchTableRows,
  fetchTableData,
  fetchUserById,
  updateOrder,
  deleteOrder,
  searchUsersByNameOrPhone,
  type OrderRow,
  type UserRow,
  type FulfillmentStatus,
  type PaymentStatus,
  type FilterNode,
} from "@/lib/admin-api";
import { NewOrderSheet } from "./NewOrderSheet";

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

  // ── New Order sheet ──────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // ── Multi-select + bulk actions ──────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkFulfillment, setBulkFulfillment] = useState<FulfillmentStatus | "">("");
  const [bulkPayment, setBulkPayment] = useState<PaymentStatus | "">("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // ── Customer search (name / phone) ───────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

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
      // Build the status-filter leaf list (applies in both search and non-search paths)
      const statusFilters: FilterNode[] = [];
      if (filterFulfillment !== "all") {
        statusFilters.push({ type: "filter", column: "fulfillment_status", op: "eq", value: filterFulfillment });
      }
      if (filterPayment !== "all") {
        statusFilters.push({ type: "filter", column: "payment_status", op: "eq", value: filterPayment });
      }

      if (searchTerm.trim()) {
        // Two-step: resolve matching users, then their orders.
        const matchedUsers = await searchUsersByNameOrPhone(searchTerm);
        if (matchedUsers.length === 0) {
          setOrders([]);
          setTotal(0);
          return;
        }
        // Pre-seed the cache with the users we just found (no per-order fetch needed)
        const seeded = new Map(userCache);
        matchedUsers.forEach((u) => seeded.set(u.id, u));

        // Filter orders to the matched user set (OR of eq on user_id) ANDed with status filters.
        const userFilters: FilterNode[] = matchedUsers.map((u) => ({
          type: "filter",
          column: "user_id",
          op: "eq",
          value: u.id,
        }));
        const tree: FilterNode = {
          type: "group",
          logic: "and",
          children: [
            { type: "group", logic: "or", children: userFilters },
            ...statusFilters,
          ],
        };

        const data = await fetchTableData("orders", page, perPage, { column: "created_at", direction: "desc" }, tree);
        const rows = data.rows as unknown as OrderRow[];
        setOrders(rows);
        setTotal(data.total);
        setUserCache(seeded);
        return;
      }

      // Non-search path: simple fetch with optional status filters (eq-only path)
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
  }, [page, perPage, filterFulfillment, filterPayment, searchTerm]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // ── Debounce search input → search term ───────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Clear selection whenever the view changes ─────────────────────────────
  useEffect(() => {
    setSelected(new Set());
  }, [page, filterFulfillment, filterPayment, searchTerm]);

  // Auto-dismiss flash after 4s
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // ── Selection handlers ────────────────────────────────────────────────────
  const toggleOrder = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const currentPageIds = orders.map((o) => o.id);
  const allOnPageSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selected.has(id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (currentPageIds.every((id) => next.has(id))) {
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [currentPageIds]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Bulk action handlers ───────────────────────────────────────────────────
  const handleBulkStatus = useCallback(async () => {
    const patch: Record<string, string> = {};
    if (bulkFulfillment !== "") patch.fulfillment_status = bulkFulfillment;
    if (bulkPayment !== "") patch.payment_status = bulkPayment;
    if (Object.keys(patch).length === 0) return;

    setBulkBusy(true);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) => updateOrder(id, patch)),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - fulfilled;
    setBulkBusy(false);

    setFlash(
      failed === 0
        ? `Updated ${fulfilled} order${fulfilled !== 1 ? "s" : ""}.`
        : `Updated ${fulfilled}, ${failed} failed.`,
    );
    setBulkFulfillment("");
    setBulkPayment("");
    clearSelection();
    loadOrders();
  }, [bulkFulfillment, bulkPayment, selected, clearSelection, loadOrders]);

  const handleBulkDelete = useCallback(async () => {
    const count = selected.size;
    if (count === 0) return;
    if (!window.confirm(`Delete ${count} order(s)? This cannot be undone.`)) return;

    setBulkBusy(true);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) => deleteOrder(id)),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - fulfilled;
    setBulkBusy(false);

    setFlash(
      failed === 0
        ? `Deleted ${fulfilled} order${fulfilled !== 1 ? "s" : ""}.`
        : `Deleted ${fulfilled}, ${failed} failed.`,
    );
    clearSelection();
    loadOrders();
  }, [selected, clearSelection, loadOrders]);

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
            setSheetOpen(true);
            setError(null);
            setFlash(null);
          }}
          className="rounded-lg bg-ink-navy px-4 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape"
        >
          + New Order
        </button>
      </div>

      {/* Flash message */}
      {flash && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          {flash}
        </div>
      )}

      {/* New Order BottomSheet */}
      <NewOrderSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Customer search */}
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search customer name / phone…"
          className="w-64 rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:border-ink-navy focus:outline-none"
        />

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

        {(filterFulfillment !== "all" || filterPayment !== "all" || searchTerm !== "") && (
          <button
            onClick={() => {
              setFilterFulfillment("all");
              setFilterPayment("all");
              setSearchInput("");
              setSearchTerm("");
              setPage(1);
            }}
            className="text-xs font-medium text-ink-navy underline hover:text-tape"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-ink-navy/30 bg-mist-navy/40 px-4 py-2.5">
          <span className="text-xs font-semibold text-ink-navy">
            {selected.size} selected
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Fulfillment:</span>
            <select
              value={bulkFulfillment}
              onChange={(e) => setBulkFulfillment(e.target.value as FulfillmentStatus | "")}
              disabled={bulkBusy}
              className="rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1 text-xs text-ink focus:border-ink-navy focus:outline-none disabled:opacity-50"
            >
              <option value="">— unchanged —</option>
              {FULFILLMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Payment:</span>
            <select
              value={bulkPayment}
              onChange={(e) => setBulkPayment(e.target.value as PaymentStatus | "")}
              disabled={bulkBusy}
              className="rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1 text-xs text-ink focus:border-ink-navy focus:outline-none disabled:opacity-50"
            >
              <option value="">— unchanged —</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleBulkStatus}
            disabled={bulkBusy || (bulkFulfillment === "" && bulkPayment === "")}
            className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-40"
          >
            {bulkBusy ? "Applying…" : "Apply"}
          </button>

          <button
            onClick={handleBulkDelete}
            disabled={bulkBusy}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
          >
            Delete
          </button>

          <button
            onClick={clearSelection}
            disabled={bulkBusy}
            className="text-xs font-medium text-muted underline hover:text-ink-navy disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      )}

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
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all on page"
                        className="h-4 w-4 cursor-pointer rounded border-hairline-strong accent-ink-navy"
                      />
                    </th>
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
                        className={`cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0 ${selected.has(order.id) ? "bg-mist-navy/40" : ""}`}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(order.id)}
                            onChange={() => toggleOrder(order.id)}
                            aria-label={`Select order ${order.order_number ?? order.id.slice(0, 8)}`}
                            className="h-4 w-4 cursor-pointer rounded border-hairline-strong accent-ink-navy"
                          />
                        </td>
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
