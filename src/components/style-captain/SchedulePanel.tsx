"use client";

import { useCallback, useEffect, useState } from "react";
import {
  scFetchScheduleOverview,
  scFetchSchedulePreview,
  scCreateRule,
  scUpdateRule,
  scDeleteRule,
  scCreateException,
  scUpdateException,
  scDeleteException,
  scCreateManualSlot,
  scDeleteManualSlot,
  type SCScheduleOverview,
  type SCSchedulePreview,
  type SCRule,
  type SCException,
  type SCManualSlot,
  type SCPreviewSlot,
} from "@/lib/style-captain-api";

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function weekdayLabel(weekday: number | null): string {
  if (weekday === null) return "Daily";
  return WEEKDAY_LABELS[weekday] ?? `Day ${weekday}`;
}

function timeLabel(t: string | null | undefined): string {
  if (!t) return "—";
  // t comes as "HH:MM:SS" — strip seconds for display
  const parts = t.split(":");
  if (parts.length < 2) return t;
  const [h, m] = parts;
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${m} ${ampm}`;
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function datetimeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Convert an ISO timestamp to a local-date key (YYYY-MM-DD). */
function dayKeyFromISO(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Extract time as h:mm AM/PM from an ISO timestamp in the browser's local timezone. */
function hhmmFromISO(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m} ${ampm}`;
}

const SLOT_STATUS_COLORS: Record<string, string> = {
  open: "bg-success-bg text-success-text border-success-border",
  booked: "bg-mist-navy text-ink-navy border-navy-interactive/30",
  manual: "bg-orange-badge-bg text-accent-text border-orange-highlight/40",
  blocked: "bg-error-bg text-error-text border-error-border",
};

type SubTab = "rules" | "blocks" | "slots" | "preview";

export function SchedulePanel({ onClose }: { onClose: () => void }) {
  const [overview, setOverview] = useState<SCScheduleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("rules");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await scFetchScheduleOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-warm-sand">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline bg-chalk-white px-4 py-3 shadow-card">
        <h2 className="font-heading text-h4 font-semibold text-ink-navy">
          My Schedule
        </h2>
        <button
          onClick={onClose}
          className="tap flex h-9 w-9 items-center justify-center rounded-pill text-muted hover:bg-mist-navy hover:text-ink-navy"
          aria-label="Close schedule"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-[480px] space-y-4">
          {/* Error */}
          {error && (
            <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
              {error}
            </div>
          )}

          {loading && !overview ? (
            <div className="py-12 text-center text-caption text-muted">
              Loading schedule…
            </div>
          ) : overview ? (
            <>
              {/* Summary chip row */}
              <div className="grid grid-cols-3 gap-2">
                <StatChip
                  label="Today"
                  value={String(overview.today_bookings_count)}
                  sublabel="visits"
                />
                <StatChip
                  label="Open slots"
                  value={String(
                    overview.rules.filter((r) => r.is_active ?? true).length,
                  )}
                  sublabel="rules"
                />
                <StatChip
                  label="Blocked"
                  value={String(overview.upcoming_exceptions.length)}
                  sublabel="dates"
                />
              </div>

              {/* Sub-tab switcher */}
              <div className="flex gap-1 rounded-pill border border-hairline bg-chalk-white p-1">
                {(["rules", "blocks", "slots", "preview"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setSubTab(t)}
                    className={`tap flex-1 rounded-pill px-2 py-2 text-[11px] font-medium capitalize transition ${
                      subTab === t
                        ? "bg-ink-navy text-chalk-white"
                        : "text-muted hover:text-ink-navy"
                    }`}
                  >
                    {t === "rules"
                      ? "Schedule"
                      : t === "blocks"
                        ? "Holidays"
                        : t === "slots"
                          ? "Extra Slots"
                          : "Preview"}
                  </button>
                ))}
              </div>

              {/* Sub-tab content */}
              {subTab === "rules" && (
                <RulesSection
                  rules={overview.rules}
                  slotMinutes={overview.config.slot_minutes}
                  onChanged={load}
                />
              )}
              {subTab === "blocks" && (
                <BlocksSection
                  exceptions={overview.upcoming_exceptions}
                  onChanged={load}
                />
              )}
              {subTab === "slots" && (
                <SlotsSection
                  slots={overview.upcoming_manual_slots}
                  onChanged={load}
                />
              )}
              {subTab === "preview" && <PreviewSection />}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Stat chip ──────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div className="rounded-card border border-hairline bg-chalk-white px-3 py-2.5 text-center shadow-card">
      <p className="text-eyebrow uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 font-heading text-h4 font-semibold text-ink-navy">
        {value}
      </p>
      <p className="text-[10px] text-muted">{sublabel}</p>
    </div>
  );
}

// ─── Rules section (change schedule / add schedule) ────────────────────────

function RulesSection({
  rules,
  slotMinutes,
  onChanged,
}: {
  rules: SCRule[];
  slotMinutes: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<SCRule | null>(null);
  const [adding, setAdding] = useState(false);

  if (adding || editing) {
    return (
      <RuleForm
        rule={editing}
        slotMinutes={slotMinutes}
        onCancel={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSaved={() => {
          setAdding(false);
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  // Group rules: daily first, then by weekday
  const sorted = [...rules].sort((a, b) => {
    if (a.weekday === null && b.weekday !== null) return -1;
    if (a.weekday !== null && b.weekday === null) return 1;
    return (a.weekday ?? 0) - (b.weekday ?? 0);
  });

  return (
    <div className="space-y-3">
      <button
        onClick={() => setAdding(true)}
        className="tap flex w-full items-center justify-center gap-2 rounded-pill border border-dashed border-hairline-strong bg-chalk-white px-4 py-3 text-caption font-medium text-ink-navy hover:bg-mist-navy"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 4v12M4 10h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        Add a schedule rule
      </button>

      {sorted.length === 0 ? (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-8 text-center">
          <p className="text-body font-medium text-ink-navy">No rules yet</p>
          <p className="mt-1 text-caption text-muted">
            Add a rule to set your weekly availability.
          </p>
        </div>
      ) : (
        sorted.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onEdit={() => setEditing(rule)}
            onChanged={onChanged}
          />
        ))
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onEdit,
  onChanged,
}: {
  rule: SCRule;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      await scDeleteRule(rule.id);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  async function handleToggle() {
    setBusy(true);
    try {
      await scUpdateRule(rule.id, {
        weekday: rule.weekday,
        is_closed: rule.is_closed ?? false,
        start_time: rule.start_time,
        end_time: rule.end_time,
        is_active: !(rule.is_active ?? true),
      });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle");
    } finally {
      setBusy(false);
    }
  }

  const isActive = rule.is_active ?? true;
  const isClosed = rule.is_closed ?? false;

  return (
    <article
      className={`rounded-card border p-4 shadow-card transition ${
        isActive
          ? "border-hairline bg-chalk-white"
          : "border-hairline-strong bg-mist-navy/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`min-w-0 ${isActive ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-2">
            <h3
              className={`font-heading text-body font-semibold ${
                isActive ? "text-ink-navy" : "text-muted"
              }`}
            >
              {weekdayLabel(rule.weekday)}
            </h3>
            {!isActive && (
              <span className="rounded-pill bg-mist-navy px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">
                Paused
              </span>
            )}
            {isClosed && (
              <span className="rounded-pill bg-error-bg px-2 py-0.5 text-[10px] font-semibold uppercase text-error-text">
                Closed
              </span>
            )}
          </div>
          <p className="mt-0.5 text-caption text-muted">
            {isClosed
              ? "Not available this day"
              : `${timeLabel(rule.start_time)} – ${timeLabel(rule.end_time)}`}
          </p>
        </div>
        <span
          className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
            isActive ? "bg-success" : "bg-hairline-strong"
          }`}
        />
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
        <button
          onClick={onEdit}
          disabled={busy}
          className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy hover:bg-mist-navy disabled:opacity-50"
        >
          Edit
        </button>
        <button
          onClick={handleToggle}
          disabled={busy}
          className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy hover:bg-mist-navy disabled:opacity-50"
        >
          {isActive ? "Pause" : "Resume"}
        </button>
        {confirmDelete ? (
          <button
            onClick={handleDelete}
            disabled={busy}
            className="tap flex-1 rounded-pill bg-error-text px-3 py-2 text-caption font-medium text-chalk-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : "Confirm"}
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="tap rounded-pill border border-error-border bg-error-bg px-3 py-2 text-caption font-medium text-error-text hover:opacity-80 disabled:opacity-50"
          >
            Del
          </button>
        )}
      </div>
    </article>
  );
}

function RuleForm({
  rule,
  slotMinutes,
  onCancel,
  onSaved,
}: {
  rule: SCRule | null;
  slotMinutes: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!rule;
  const [weekday, setWeekday] = useState<string>(
    rule?.weekday === null || rule?.weekday === undefined
      ? "daily"
      : String(rule.weekday),
  );
  const [isClosed, setIsClosed] = useState(rule?.is_closed ?? false);
  const [startTime, setStartTime] = useState(
    (rule?.start_time ?? "10:00").slice(0, 5),
  );
  const [endTime, setEndTime] = useState(
    (rule?.end_time ?? "18:00").slice(0, 5),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        weekday: weekday === "daily" ? null : parseInt(weekday, 10),
        is_closed: isClosed,
        start_time: isClosed ? null : `${startTime}:00`,
        end_time: isClosed ? null : `${endTime}:00`,
        is_active: true,
      };
      if (isEdit && rule) {
        await scUpdateRule(rule.id, payload);
      } else {
        await scCreateRule(payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
      <h3 className="font-heading text-body font-semibold text-ink-navy">
        {isEdit ? "Edit rule" : "New rule"}
      </h3>

      {err && (
        <div className="rounded-card border border-error-border bg-error-bg px-3 py-2 text-caption text-error-text">
          {err}
        </div>
      )}

      {/* Day selector */}
      <Field label="Applies to">
        <select
          value={weekday}
          onChange={(e) => setWeekday(e.target.value)}
          className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
        >
          <option value="daily">Every day</option>
          {Object.entries(WEEKDAY_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {/* Closed toggle */}
      <Field label="Availability">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsClosed(false)}
            className={`tap flex-1 rounded-pill border px-4 py-2.5 text-caption font-medium ${
              !isClosed
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy"
            }`}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setIsClosed(true)}
            className={`tap flex-1 rounded-pill border px-4 py-2.5 text-caption font-medium ${
              isClosed
                ? "border-error-text bg-error-text text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy"
            }`}
          >
            Closed
          </button>
        </div>
      </Field>

      {/* Times */}
      {!isClosed && (
        <>
          <Field
            label={`Start time${slotMinutes > 0 ? ` (grid: ${slotMinutes}m)` : ""}`}
          >
            <input
              type="time"
              step={slotMinutes * 60}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
            />
          </Field>
          <Field
            label={`End time${slotMinutes > 0 ? ` (grid: ${slotMinutes}m)` : ""}`}
          >
            <input
              type="time"
              step={slotMinutes * 60}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
            />
          </Field>
        </>
      )}

      {/* Actions */}
      <div className="flex gap-2 border-t border-hairline pt-3">
        <button
          onClick={onCancel}
          disabled={busy}
          className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-caption font-medium text-ink-navy hover:bg-mist-navy disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="tap flex-1 rounded-pill bg-tape px-4 py-2.5 text-caption font-semibold text-chalk-white shadow-primary hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : isEdit ? "Save" : "Add rule"}
        </button>
      </div>
    </div>
  );
}

// ─── Blocks section (block slots for holidays) ──────────────────────────────

function BlocksSection({
  exceptions,
  onChanged,
}: {
  exceptions: SCException[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <ExceptionForm
        onCancel={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setAdding(true)}
        className="tap flex w-full items-center justify-center gap-2 rounded-pill border border-dashed border-hairline-strong bg-chalk-white px-4 py-3 text-caption font-medium text-ink-navy hover:bg-mist-navy"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 4v12M4 10h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        Block a date
      </button>

      {exceptions.length === 0 ? (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-8 text-center">
          <p className="text-body font-medium text-ink-navy">No upcoming blocks</p>
          <p className="mt-1 text-caption text-muted">
            Block a date for holidays or time off.
          </p>
        </div>
      ) : (
        exceptions.map((ex) => (
          <ExceptionRow key={ex.id} exception={ex} onChanged={onChanged} />
        ))
      )}
    </div>
  );
}

function ExceptionRow({
  exception,
  onChanged,
}: {
  exception: SCException;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      await scDeleteException(exception.id);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const isPartial =
    exception.start_time !== null && exception.start_time !== undefined;

  return (
    <article className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-heading text-body font-semibold text-ink-navy">
            {dateLabel(exception.date)}
          </h3>
          <p className="mt-0.5 text-caption text-muted">
            {isPartial
              ? `${timeLabel(exception.start_time)} – ${timeLabel(exception.end_time)}`
              : "All day"}
          </p>
          {exception.reason && (
            <p className="mt-1 text-caption italic text-muted">
              {exception.reason}
            </p>
          )}
        </div>
        <span className="rounded-pill bg-error-bg px-2.5 py-0.5 text-[11px] font-semibold text-error-text">
          Blocked
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
        {confirmDelete ? (
          <button
            onClick={handleDelete}
            disabled={busy}
            className="tap flex-1 rounded-pill bg-error-text px-3 py-2 text-caption font-medium text-chalk-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : "Remove block"}
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="tap flex-1 rounded-pill border border-error-border bg-error-bg px-3 py-2 text-caption font-medium text-error-text hover:opacity-80"
          >
            Remove
          </button>
        )}
        <button
          onClick={() => setConfirmDelete(false)}
          className={`tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy hover:bg-mist-navy ${
            confirmDelete ? "" : "hidden"
          }`}
        >
          Keep
        </button>
      </div>
    </article>
  );
}

function ExceptionForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("14:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setErr(null);
    try {
      await scCreateException({
        date,
        type: "block",
        start_time: allDay ? null : `${startTime}:00`,
        end_time: allDay ? null : `${endTime}:00`,
        reason: reason.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to block date");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
      <h3 className="font-heading text-body font-semibold text-ink-navy">
        Block a date
      </h3>

      {err && (
        <div className="rounded-card border border-error-border bg-error-bg px-3 py-2 text-caption text-error-text">
          {err}
        </div>
      )}

      <Field label="Date">
        <input
          type="date"
          value={date}
          min={today}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
        />
      </Field>

      <Field label="Duration">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAllDay(true)}
            className={`tap flex-1 rounded-pill border px-4 py-2.5 text-caption font-medium ${
              allDay
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy"
            }`}
          >
            All day
          </button>
          <button
            type="button"
            onClick={() => setAllDay(false)}
            className={`tap flex-1 rounded-pill border px-4 py-2.5 text-caption font-medium ${
              !allDay
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy"
            }`}
          >
            Partial
          </button>
        </div>
      </Field>

      {!allDay && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
            />
          </Field>
          <Field label="To">
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
            />
          </Field>
        </div>
      )}

      <Field label="Reason (optional)">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Holiday, sick leave…"
          className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
        />
      </Field>

      <div className="flex gap-2 border-t border-hairline pt-3">
        <button
          onClick={onCancel}
          disabled={busy}
          className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-caption font-medium text-ink-navy hover:bg-mist-navy disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="tap flex-1 rounded-pill bg-tape px-4 py-2.5 text-caption font-semibold text-chalk-white shadow-primary hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Blocking…" : "Block date"}
        </button>
      </div>
    </div>
  );
}

// ─── Slots section (add / remove manual slots) ──────────────────────────────

function SlotsSection({
  slots,
  onChanged,
}: {
  slots: SCManualSlot[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <ManualSlotForm
        onCancel={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setAdding(true)}
        className="tap flex w-full items-center justify-center gap-2 rounded-pill border border-dashed border-hairline-strong bg-chalk-white px-4 py-3 text-caption font-medium text-ink-navy hover:bg-mist-navy"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 4v12M4 10h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        Add an extra slot
      </button>

      {slots.length === 0 ? (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-8 text-center">
          <p className="text-body font-medium text-ink-navy">No manual slots</p>
          <p className="mt-1 text-caption text-muted">
            Add one-off slots to extend hours or pre-claim a time.
          </p>
        </div>
      ) : (
        slots.map((slot) => (
          <ManualSlotRow key={slot.id} slot={slot} onChanged={onChanged} />
        ))
      )}
    </div>
  );
}

function ManualSlotRow({
  slot,
  onChanged,
}: {
  slot: SCManualSlot;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      await scDeleteManualSlot(slot.id);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <article className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-heading text-body font-semibold text-ink-navy">
            {datetimeLabel(slot.start_at)}
          </h3>
          <p className="mt-0.5 text-caption text-muted">
            Until {timeLabel((slot.end_at ?? "").slice(11, 19))}
          </p>
        </div>
        <span className="rounded-pill bg-orange-badge-bg px-2.5 py-0.5 text-[11px] font-semibold text-accent-text">
          Manual
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
        {confirmDelete ? (
          <button
            onClick={handleDelete}
            disabled={busy}
            className="tap flex-1 rounded-pill bg-error-text px-3 py-2 text-caption font-medium text-chalk-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : "Release slot"}
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="tap flex-1 rounded-pill border border-error-border bg-error-bg px-3 py-2 text-caption font-medium text-error-text hover:opacity-80"
          >
            Release
          </button>
        )}
        <button
          onClick={() => setConfirmDelete(false)}
          className={`tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy hover:bg-mist-navy ${
            confirmDelete ? "" : "hidden"
          }`}
        >
          Keep
        </button>
      </div>
    </article>
  );
}

function ManualSlotForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setErr(null);
    try {
      // Build ISO timestamps in UTC from local date + time inputs
      const startAt = new Date(`${date}T${startTime}:00`);
      const endAt = new Date(`${date}T${endTime}:00`);
      if (endAt <= startAt) {
        throw new Error("End time must be after start time");
      }
      await scCreateManualSlot({
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add slot");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
      <h3 className="font-heading text-body font-semibold text-ink-navy">
        Add an extra slot
      </h3>

      {err && (
        <div className="rounded-card border border-error-border bg-error-bg px-3 py-2 text-caption text-error-text">
          {err}
        </div>
      )}

      <Field label="Date">
        <input
          type="date"
          value={date}
          min={today}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
          />
        </Field>
        <Field label="To">
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-body text-ink-navy"
          />
        </Field>
      </div>

      <p className="text-caption text-muted">
        This reserves the time for you — customers won&apos;t be auto-assigned to it.
      </p>

      <div className="flex gap-2 border-t border-hairline pt-3">
        <button
          onClick={onCancel}
          disabled={busy}
          className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2.5 text-caption font-medium text-ink-navy hover:bg-mist-navy disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="tap flex-1 rounded-pill bg-tape px-4 py-2.5 text-caption font-semibold text-chalk-white shadow-primary hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add slot"}
        </button>
      </div>
    </div>
  );
}

// ─── Preview section ─────────────────────────────────────────────────────────

function PreviewSection() {
  const [preview, setPreview] = useState<SCSchedulePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await scFetchSchedulePreview();
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading)
    return (
      <div className="py-12 text-center text-caption text-muted">
        Loading preview…
      </div>
    );
  if (error)
    return (
      <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
        {error}
      </div>
    );
  if (!preview || preview.slots.length === 0)
    return (
      <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-8 text-center">
        <p className="text-body font-medium text-ink-navy">No slots in view</p>
        <p className="mt-1 text-caption text-muted">
          Add a rule to see your availability grid.
        </p>
      </div>
    );

  // Group by date
  const byDate = new Map<string, SCPreviewSlot[]>();
  for (const slot of preview.slots) {
    const dayKey = dayKeyFromISO(slot.start_at);
    if (!byDate.has(dayKey)) byDate.set(dayKey, []);
    byDate.get(dayKey)!.push(slot);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-card border border-hairline bg-chalk-white px-4 py-3 shadow-card">
        <p className="text-caption text-muted">
          {dateLabel(preview.from_date)} – {dateLabel(preview.to_date)}
        </p>
        <p className="mt-0.5 text-eyebrow uppercase tracking-wider text-muted">
          {preview.slots.length} slots · {preview.slot_minutes}m grid
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {(["open", "booked", "manual", "blocked"] as const).map((s) => (
          <span
            key={s}
            className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10px] font-medium capitalize ${SLOT_STATUS_COLORS[s]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {s}
          </span>
        ))}
      </div>

      {/* Day groups */}
      {[...byDate.entries()].map(([dayKey, daySlots]) => (
        <div
          key={dayKey}
          className="rounded-card border border-hairline bg-chalk-white p-3 shadow-card"
        >
          <p className="mb-2 text-eyebrow uppercase tracking-wider text-ink-navy">
            {dateLabel(dayKey)}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {daySlots.map((slot, i) => {
              const time = hhmmFromISO(slot.start_at);
              return (
                <div
                  key={`${dayKey}-${i}`}
                  className={`rounded-pill border px-1.5 py-1 text-center text-[10px] font-medium leading-tight ${SLOT_STATUS_COLORS[slot.status] ?? "bg-mist-navy text-muted border-hairline"}`}
                  title={`${time} · ${slot.status}`}
                >
                  {time}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Shared form field wrapper ──────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-eyebrow uppercase tracking-wider text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
