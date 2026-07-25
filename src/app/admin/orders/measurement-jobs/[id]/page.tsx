"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchTableRows,
  fetchUserById,
  fetchStyleCaptains,
  updateMeasurementJob,
  deleteMeasurementJob,
  formatOrderSlot,
  type MeasurementJobRow,
  type OrderRow,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateId(id: string): string {
  return id.slice(0, 8);
}

function formatDateTime(v: string | null | undefined): string {
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

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  } catch {
    return "";
  }
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

export default function MeasurementJobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;

  const [job, setJob] = useState<MeasurementJobRow | null>(null);
  const [customer, setCustomer] = useState<UserRow | null>(null);
  const [captain, setCaptain] = useState<UserRow | null>(null);
  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [order, setOrder] = useState<OrderRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Local edit buffers (only for fields that need draft-then-save)
  const [scheduledDraft, setScheduledDraft] = useState<string>("");
  const [performedDraft, setPerformedDraft] = useState<string>("");
  const [notesDraft, setNotesDraft] = useState<string>("");

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
              label: "← Back to Measurement Jobs",
              active: false,
              onClick: () =>
                router.push("/admin/orders/measurement-jobs"),
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

  // ── Load job ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Load job by id
      const { rows: jobRows } = await fetchTableRows<MeasurementJobRow>(
        "measurement_jobs",
        { filters: { id: jobId }, perPage: 1 },
      );
      if (jobRows.length === 0) {
        setError("Measurement job not found");
        return;
      }
      const j = jobRows[0];
      setJob(j);
      setScheduledDraft(isoToLocalInput(j.scheduled_at));
      setPerformedDraft(isoToLocalInput(j.performed_at));
      setNotesDraft(j.notes ?? "");

      // 2. Load captains list
      const captainsList = await fetchStyleCaptains();
      setCaptains(captainsList);

      // 3. Resolve related entities in parallel
      const tasks: Promise<void>[] = [];

      if (j.user_id) {
        tasks.push(
          fetchUserById(j.user_id)
            .then((u) => {
              if (u) setCustomer(u);
            })
            .catch(() => {}),
        );
      }
      if (j.style_captain_id) {
        tasks.push(
          fetchUserById(j.style_captain_id)
            .then((u) => {
              if (u) setCaptain(u);
            })
            .catch(() => {}),
        );
      }
      if (j.order_id) {
        tasks.push(
          fetchTableRows<OrderRow>("orders", {
            filters: { id: j.order_id },
            perPage: 1,
          })
            .then(({ rows }) => {
              if (rows.length > 0) setOrder(rows[0]);
            })
            .catch(() => {}),
        );
      }

      await Promise.all(tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleUpdateField(
    field: string,
    patch: Partial<MeasurementJobRow>,
  ) {
    if (!job) return;
    setSavingField(field);
    try {
      await updateMeasurementJob(job.id, patch);
      setJob({ ...job, ...patch });
      // If we updated captain, refresh the captain display
      if (patch.style_captain_id !== undefined) {
        if (patch.style_captain_id) {
          fetchUserById(patch.style_captain_id)
            .then((u) => setCaptain(u))
            .catch(() => {});
        } else {
          setCaptain(null);
        }
      }
      flash("Job updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingField(null);
    }
  }

  async function handleSaveScheduled() {
    if (!job) return;
    const iso = scheduledDraft
      ? new Date(scheduledDraft).toISOString()
      : null;
    await handleUpdateField("scheduled_at", { scheduled_at: iso });
  }

  async function handleSavePerformed() {
    if (!job) return;
    const iso = performedDraft
      ? new Date(performedDraft).toISOString()
      : null;
    await handleUpdateField("performed_at", { performed_at: iso });
  }

  async function handleSaveNotes() {
    if (!job) return;
    if (notesDraft === (job.notes ?? "")) return;
    await handleUpdateField("notes", {
      notes: notesDraft.trim() || null,
    });
  }

  async function handleDelete() {
    if (!job) return;
    if (!confirm("Delete this measurement job? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await deleteMeasurementJob(job.id);
      router.push("/admin/orders/measurement-jobs");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete job");
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12 text-center text-muted">
        Loading job…
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? "Job not found"}
        </div>
        <button
          onClick={() => router.push("/admin/orders/measurement-jobs")}
          className="mt-4 text-sm font-medium text-ink-navy underline"
        >
          ← Back to Measurement Jobs
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <button
          onClick={() => router.push("/admin/orders/measurement-jobs")}
          className="hover:text-ink-navy hover:underline"
        >
          Measurement Jobs
        </button>
        <span>/</span>
        <span className="font-mono text-ink-navy">
          Job {truncateId(job.id)}
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
              Measurement Job
            </h1>
            <div className="mt-1 text-sm text-muted">
              Created {formatDateTime(job.created_at)} • ID: {job.id}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge value={job.status} />
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>

        {/* Status + Captain grid */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-hairline pt-4 sm:grid-cols-2">
          {/* Status editor */}
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Status
            </div>
            <select
              value={job.status ?? ""}
              onChange={(e) =>
                handleUpdateField("status", {
                  status: (e.target.value || null) as JobStatus | null,
                })
              }
              disabled={savingField === "status"}
              className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none disabled:opacity-50"
            >
              <option value="">— None —</option>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Captain editor */}
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Style Captain
            </div>
            {captain ? (
              <div className="mt-0.5 text-xs text-muted">
                {captain.name ?? "Unnamed"}
                {captain.phone ? ` • ${captain.phone}` : ""}
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-muted">Unassigned</div>
            )}
            <select
              value={job.style_captain_id ?? ""}
              onChange={(e) =>
                handleUpdateField("style_captain_id", {
                  style_captain_id: e.target.value || null,
                })
              }
              disabled={savingField === "style_captain_id"}
              className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none disabled:opacity-50"
            >
              <option value="">— Unassigned —</option>
              {captains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.phone ?? truncateId(c.id)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scheduled at + Performed at */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-hairline pt-4 sm:grid-cols-2">
          {/* Scheduled at */}
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Scheduled At
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="datetime-local"
                value={scheduledDraft}
                onChange={(e) => setScheduledDraft(e.target.value)}
                disabled={savingField === "scheduled_at"}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSaveScheduled}
                disabled={
                  savingField === "scheduled_at" ||
                  scheduledDraft === isoToLocalInput(job.scheduled_at)
                }
                className="shrink-0 rounded-md bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-40"
              >
                {savingField === "scheduled_at" ? "…" : "Save"}
              </button>
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              Current: {formatDateTime(job.scheduled_at)}
            </div>
          </div>

          {/* Performed at */}
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Performed At
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="datetime-local"
                value={performedDraft}
                onChange={(e) => setPerformedDraft(e.target.value)}
                disabled={savingField === "performed_at"}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-sm focus:border-ink-navy focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSavePerformed}
                disabled={
                  savingField === "performed_at" ||
                  performedDraft === isoToLocalInput(job.performed_at)
                }
                className="shrink-0 rounded-md bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-40"
              >
                {savingField === "performed_at" ? "…" : "Save"}
              </button>
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              Current: {formatDateTime(job.performed_at)}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            Notes
          </div>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={handleSaveNotes}
            rows={3}
            placeholder="Add internal notes about this measurement job…"
            className="mt-1 w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
          />
          <div className="mt-1 text-[11px] text-muted">
            Saved automatically on blur.
          </div>
        </div>
      </div>

      {/* ─── Related: Order & Customer ───────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-ink-navy">
          Related
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Order card */}
          <div className="rounded-xl border border-hairline bg-chalk-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Order
            </div>
            {order ? (
              <button
                onClick={() =>
                  order.id &&
                  router.push(`/admin/orders/${order.id}`)
                }
                className="mt-1 block text-left"
              >
                <div className="font-mono text-sm font-medium text-ink-navy hover:text-tape hover:underline">
                  {order.order_number ?? `#${truncateId(order.id)}`}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  Created {formatDateTime(order.created_at)}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  Slot: {formatOrderSlot(order.slot)}
                </div>
                <div className="mt-1 text-[11px] font-medium text-ink-navy underline">
                  View order detail →
                </div>
              </button>
            ) : job.order_id ? (
              <button
                onClick={() =>
                  router.push(`/admin/orders/${job.order_id}`)
                }
                className="mt-1 text-sm font-medium text-ink-navy hover:text-tape hover:underline"
              >
                Order {truncateId(job.order_id)} →
              </button>
            ) : (
              <div className="mt-1 text-sm text-muted">
                No order linked
              </div>
            )}
          </div>

          {/* Customer card */}
          <div className="rounded-xl border border-hairline bg-chalk-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Customer
            </div>
            {customer ? (
              <div className="mt-1">
                <div className="text-sm font-medium text-ink">
                  {customer.name ?? "Unnamed"}
                </div>
                {customer.phone && (
                  <div className="text-xs text-muted">
                    {customer.phone}
                  </div>
                )}
                {customer.email && (
                  <div className="text-xs text-muted">
                    {customer.email}
                  </div>
                )}
              </div>
            ) : job.user_id ? (
              <div className="mt-1 text-sm text-muted">
                User ID: {truncateId(job.user_id)}
              </div>
            ) : (
              <div className="mt-1 text-sm text-muted">
                No customer linked
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
