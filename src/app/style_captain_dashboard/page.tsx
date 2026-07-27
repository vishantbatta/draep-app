"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  scFetchJobs,
  scFetchMe,
  scFetchScheduleOverview,
  type SCJob,
  type SCUser,
  type SCScheduleOverview,
} from "@/lib/style-captain-api";
import {
  formatAddress,
  formatDateTime,
  formatPhone,
  formatSlot,
  garmentName,
  humanStatus,
  mapsUrl,
  statusBadgeClass,
  telLink,
} from "@/lib/sc-helpers";
import { SchedulePanel } from "@/components/style-captain/SchedulePanel";

export default function StyleCaptainDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SCUser | null>(null);
  const [activeJobs, setActiveJobs] = useState<SCJob[]>([]);
  const [recentJobs, setRecentJobs] = useState<SCJob[]>([]);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleOverview, setScheduleOverview] =
    useState<SCScheduleOverview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [me, active, completed, overview] = await Promise.all([
        scFetchMe().catch(() => null),
        scFetchJobs("scheduled,in_progress"),
        scFetchJobs("completed,cancelled"),
        scFetchScheduleOverview().catch(() => null),
      ]);
      if (me) setUser(me);
      setActiveJobs(active);
      setRecentJobs(completed);
      if (overview) setScheduleOverview(overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleJobs = tab === "active" ? activeJobs : recentJobs;

  return (
    <div className="space-y-4">
      {/* ─── Greeting + summary ──────────────────────────────────────────── */}
      <section className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow uppercase tracking-wider text-muted">
              Welcome back
            </p>
            <h1 className="truncate font-heading text-h4 font-semibold text-ink-navy">
              {user?.name ?? "Style Captain"}
            </h1>
            {user?.phone && (
              <p className="mt-0.5 text-caption text-muted">{user.phone}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-orange-badge-bg text-h4 font-semibold text-accent-text">
              {activeJobs.length}
            </span>
            <span className="text-caption text-muted">open jobs</span>
          </div>
        </div>
      </section>

      {/* ─── Start measurement CTA ──────────────────────────────────────── */}
      <button
        onClick={() => router.push("/style_captain_dashboard/measure/start")}
        className="tap flex w-full items-center justify-between rounded-card bg-tape px-5 py-4 text-chalk-white shadow-primary"
      >
        <span className="text-left">
          <span className="block font-heading text-body font-semibold">
            Start a Measurement
          </span>
          <span className="block text-caption text-chalk-white/80">
            Pick a job &amp; capture step-by-step
          </span>
        </span>
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
          <path
            d="M7 5l5 5-5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* ─── Schedule banner ────────────────────────────────────────────── */}
      <ScheduleBanner
        overview={scheduleOverview}
        loading={loading}
        onOpen={() => setScheduleOpen(true)}
      />

      {/* ─── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-pill border border-hairline bg-chalk-white p-1">
        {(["active", "completed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tap flex-1 rounded-pill px-4 py-2 text-caption font-medium capitalize transition ${
              tab === t
                ? "bg-ink-navy text-chalk-white"
                : "text-muted hover:text-ink-navy"
            }`}
          >
            {t === "active" ? "Active" : "Recent"}
          </button>
        ))}
      </div>

      {/* ─── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {/* ─── Jobs list ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-12 text-center text-caption text-muted">
          Loading jobs…
        </div>
      ) : visibleJobs.length === 0 ? (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-12 text-center">
          <p className="text-body font-medium text-ink-navy">
            No {tab === "active" ? "active" : "recent"} jobs
          </p>
          <p className="mt-1 text-caption text-muted">
            {tab === "active"
              ? "New measurement requests will appear here."
              : "Completed and cancelled jobs will show up here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {/* ─── Schedule panel (modal) ────────────────────────────────────── */}
      {scheduleOpen && (
        <SchedulePanel
          onClose={() => {
            setScheduleOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ─── Schedule banner ────────────────────────────────────────────────────────

function ScheduleBanner({
  overview,
  loading,
  onOpen,
}: {
  overview: SCScheduleOverview | null;
  loading: boolean;
  onOpen: () => void;
}) {
  const nextVisit = overview?.next_visit ?? null;
  const todayCount = overview?.today_bookings_count ?? 0;
  const blockedCount = overview?.upcoming_exceptions.length ?? 0;

  return (
    <button
      onClick={onOpen}
      className="tap flex w-full items-center justify-between rounded-card border border-hairline bg-chalk-white px-4 py-3 text-left shadow-card transition hover:border-hairline-strong"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {/* Calendar icon */}
          <svg
            className="h-5 w-5 shrink-0 text-ink-navy"
            viewBox="0 0 20 20"
            fill="none"
          >
            <rect
              x="3"
              y="4"
              width="14"
              height="13"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M3 8h14M7 2v3M13 2v3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="7" cy="12" r="1" fill="currentColor" />
            <circle cx="10" cy="12" r="1" fill="currentColor" />
          </svg>
          <span className="block font-heading text-body font-semibold text-ink-navy">
            My Schedule
          </span>
        </span>

        <span className="mt-1 block pl-7 text-caption text-muted">
          {loading
            ? "Loading…"
            : nextVisit
              ? `Next: ${formatDateTime(nextVisit.scheduled_at)}${
                  nextVisit.customer_name ? ` · ${nextVisit.customer_name}` : ""
                }`
              : todayCount === 0 && blockedCount === 0
                ? "Set your weekly availability"
                : `${todayCount} visit${todayCount === 1 ? "" : "s"} today${
                    blockedCount > 0 ? ` · ${blockedCount} block${blockedCount === 1 ? "" : "s"}` : ""
                  }`}
        </span>
      </span>

      <svg
        className="h-4 w-4 shrink-0 text-muted"
        viewBox="0 0 20 20"
        fill="none"
      >
        <path
          d="M7 5l5 5-5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

// ─── Job card ────────────────────────────────────────────────────────────────

function JobCard({ job }: { job: SCJob }) {
  const router = useRouter();
  const slotText = formatSlot(job.slot);
  const garmentsText =
    job.garments.length > 0
      ? job.garments.map((g) => garmentName(g)).join(", ")
      : "—";
  const addressText = formatAddress(job);
  const tel = telLink(job);
  const phoneDisplay = formatPhone(job);
  const mapLink = mapsUrl(job);

  const isCompleted = job.status === "completed" || job.status === "cancelled";

  function navigate() {
    router.push(`/style_captain_dashboard/measure/${job.id}`);
  }

  return (
    <article
      onClick={navigate}
      className="tap cursor-pointer rounded-card border border-hairline bg-chalk-white p-4 shadow-card transition hover:border-hairline-strong"
    >
      {/* Header row: status + order # */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass(
                job.status,
              )}`}
            >
              {humanStatus(job.status)}
            </span>
            {job.order_number && (
              <span className="truncate font-mono text-[11px] text-muted">
                #{job.order_number}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 font-heading text-body font-semibold text-ink-navy">
            {job.customer_name ?? "Walk-in customer"}
          </h3>
          {job.customer_phone && (
            <p className="mt-0.5 text-caption text-muted">{phoneDisplay}</p>
          )}
        </div>
        <svg
          className="mt-1 h-4 w-4 shrink-0 text-muted"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            d="M7 5l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Detail rows */}
      <dl className="space-y-1.5 text-caption">
        <DetailRow label="Garments" value={garmentsText} />
        <DetailRow label="Scheduled" value={slotText} />
        {addressText && <DetailRow label="Address" value={addressText} />}
        <DetailRow
          label={isCompleted ? "Completed" : "Created"}
          value={
            isCompleted
              ? formatDateTime(job.performed_at)
              : formatDateTime(job.created_at)
          }
        />
        {job.measurements.length > 0 && (
          <DetailRow
            label="Readings"
            value={`${job.measurements.length} captured`}
          />
        )}
      </dl>

      {/* Action buttons row */}
      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
        {tel && (
          <a
            href={tel}
            onClick={(e) => e.stopPropagation()}
            className="tap flex flex-1 items-center justify-center gap-1.5 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy hover:bg-mist-navy"
          >
            <svg className="h-4 w-4 text-success" viewBox="0 0 20 20" fill="none">
              <path
                d="M4 4c0 6 6 12 12 12l1.5-2.5-3-1.5-1.5 1.5c-2-1-3.5-2.5-4.5-4.5l1.5-1.5L9.5 4 7 5 4 4z"
                fill="currentColor"
              />
            </svg>
            Call
          </a>
        )}
        {addressText && (
          <a
            href={mapLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="tap flex flex-1 items-center justify-center gap-1.5 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy hover:bg-mist-navy"
          >
            <svg className="h-4 w-4 text-accent-text" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 2C6.7 2 4 4.7 4 8c0 4.5 6 10 6 10s6-5.5 6-10c0-3.3-2.7-6-6-6z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="10" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            Map
          </a>
        )}
        {!addressText && job.customer_name && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.customer_name)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="tap flex flex-1 items-center justify-center gap-1.5 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy hover:bg-mist-navy"
          >
            <svg className="h-4 w-4 text-accent-text" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 2C6.7 2 4 4.7 4 8c0 4.5 6 10 6 10s6-5.5 6-10c0-3.3-2.7-6-6-6z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="10" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            Map
          </a>
        )}
        {!isCompleted && (
          <span className="flex-1 text-right text-caption font-medium text-accent-text">
            {job.status === "in_progress" ? "Continue →" : "Start →"}
          </span>
        )}
      </div>
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
