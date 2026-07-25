"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchTableRows,
  fetchStyleCaptains,
  fetchUserById,
  type MeasurementJobRow,
  type UserRow,
  type JobStatus,
} from "@/lib/admin-api";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_STATUSES: JobStatus[] = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

const PER_PAGE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ value }: { value: JobStatus | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const cls = STATUS_STYLE[value] ?? "bg-gray-100 text-gray-600";
  return (
    <span
      className={`inline-block rounded-pill px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MeasurementJobsPage() {
  const router = useRouter();

  // ── State ───────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<MeasurementJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Filters
  const [filterStatus, setFilterStatus] = useState<"all" | JobStatus>("all");
  const [filterCaptain, setFilterCaptain] = useState<"all" | string>("all");

  // Lookups
  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [userCache, setUserCache] = useState<Map<string, UserRow>>(new Map());
  const [orderMap, setOrderMap] = useState<Record<string, string>>({});

  // ── Emit sidebar items ──────────────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "All Orders",
              active: false,
              onClick: () => router.push("/admin/orders"),
            },
            {
              label: "Measurement Jobs",
              active: true,
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

  // ── Fetch captains once ─────────────────────────────────────────────────
  useEffect(() => {
    fetchStyleCaptains()
      .then(setCaptains)
      .catch(() => {});
  }, []);

  // ── Load jobs ───────────────────────────────────────────────────────────
  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: Record<string, string> = {};
      if (filterStatus !== "all") filters.status = filterStatus;
      if (filterCaptain !== "all") filters.style_captain_id = filterCaptain;

      const { rows, total: t } = await fetchTableRows<MeasurementJobRow>(
        "measurement_jobs",
        {
          page,
          perPage: PER_PAGE,
          sortColumn: "created_at",
          sortDirection: "desc",
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        },
      );
      setJobs(rows);
      setTotal(t);

      // Resolve relations
      const userIds = new Set<string>();
      const orderIds = new Set<string>();
      rows.forEach((j) => {
        if (j.user_id) userIds.add(j.user_id);
        if (j.style_captain_id) userIds.add(j.style_captain_id);
        if (j.order_id) orderIds.add(j.order_id);
      });

      if (userIds.size > 0) {
        const newCache = new Map(userCache);
        await Promise.all(
          Array.from(userIds).map(async (id) => {
            if (!newCache.has(id)) {
              try {
                const u = await fetchUserById(id);
                if (u) newCache.set(id, u);
              } catch {
                /* skip */
              }
            }
          }),
        );
        setUserCache(newCache);
      }

      if (orderIds.size > 0) {
        const { rows: orderRows } = await fetchTableRows<{
          id: string;
          order_number: string | null;
        }>("orders", {
          page: 1,
          perPage: 100,
          sortColumn: "created_at",
          sortDirection: "desc",
        });
        const om: Record<string, string> = {};
        orderRows.forEach((o) => {
          om[o.id] = o.order_number ?? truncateId(o.id);
        });
        setOrderMap((prev) => ({ ...prev, ...om }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterStatus, filterCaptain]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  function userDetail(id: string | null): { name: string; sub: string } | null {
    if (!id) return null;
    const u = userCache.get(id);
    if (!u) return null;
    return {
      name: u.name ?? "Unnamed",
      sub: [u.phone, u.email].filter(Boolean).join(" • "),
    };
  }

  function orderLabel(id: string | null): string {
    if (!id) return "—";
    return orderMap[id] ?? truncateId(id);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-ink-navy md:text-3xl">
            Measurement Jobs
          </h1>
          <p className="mt-1 text-sm text-muted">
            {total} job{total !== 1 ? "s" : ""} across all orders • click a row
            to view detail
          </p>
        </div>
        <button
          onClick={() => loadJobs()}
          className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-semibold text-ink transition hover:bg-mist-navy/30"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Status filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => {
              setPage(1);
              setFilterStatus(e.target.value as "all" | JobStatus);
            }}
            className="rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1 text-xs text-ink focus:border-ink-navy focus:outline-none"
          >
            <option value="all">All</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        {/* Captain filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Captain:</span>
          <select
            value={filterCaptain}
            onChange={(e) => {
              setPage(1);
              setFilterCaptain(e.target.value);
            }}
            className="rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1 text-xs text-ink focus:border-ink-navy focus:outline-none"
          >
            <option value="all">All</option>
            {captains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.phone ?? truncateId(c.id)}
              </option>
            ))}
          </select>
        </div>

        {(filterStatus !== "all" || filterCaptain !== "all") && (
          <button
            onClick={() => {
              setFilterStatus("all");
              setFilterCaptain("all");
              setPage(1);
            }}
            className="text-xs font-medium text-ink-navy underline hover:text-tape"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center text-muted">Loading jobs…</div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          {jobs.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-sm text-muted">
                No measurement jobs found.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Captain</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Scheduled</th>
                    <th className="px-4 py-3 font-medium">Performed</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const customer = userDetail(job.user_id);
                    const captain = userDetail(job.style_captain_id);
                    return (
                      <tr
                        key={job.id}
                        onClick={() =>
                          router.push(
                            `/admin/orders/measurement-jobs/${job.id}`,
                          )
                        }
                        className="cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-[13px] font-medium text-ink-navy">
                            {orderLabel(job.order_id)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {customer ? (
                            <div>
                              <div className="text-[13px] text-ink">
                                {customer.name}
                              </div>
                              {customer.sub && (
                                <div className="text-[11px] text-muted">
                                  {customer.sub}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-ink">
                          {captain ? captain.name : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge value={job.status} />
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted">
                          {formatDateTime(job.scheduled_at)}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted">
                          {formatDateTime(job.performed_at)}
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
