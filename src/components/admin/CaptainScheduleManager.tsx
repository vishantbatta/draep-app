"use client";

/**
 * CaptainScheduleManager — admin-side schedule editor.
 *
 * Lets an admin manage a style captain's availability rules, date exceptions
 * (holidays/blocks), and manual one-off slots. Uses the generic admin table
 * endpoints (PUT/POST/DELETE /admin/tables/{table}) scoped to the selected
 * captain's ID.
 *
 * Tables:
 *   - style_captain_availability_rules  (weekly recurring rules)
 *   - style_captain_slot_exceptions     (date blocks / holidays)
 *   - style_captain_slots               (manual one-off open slots)
 *
 * This mirrors the UI structure of the captain-facing SchedulePanel
 * (components/style-captain/SchedulePanel.tsx) but uses admin table API
 * instead of /captain/schedule/* endpoints.
 */

import { useCallback, useEffect, useState } from "react";
import {
  fetchTableRows,
  createTableRow,
  updateTableRow,
  deleteTableRow,
} from "@/lib/admin-api";

// ─── Types matching the DB tables ─────────────────────────────────────────────

interface AvailabilityRule {
  id: string;
  style_captain_id: string | null;
  weekday: number | null; // null = daily, 0=Sunday..6=Saturday
  is_closed: boolean | null;
  start_time: string | null; // "HH:MM:SS"
  end_time: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean | null;
}

interface SlotException {
  id: string;
  style_captain_id: string | null;
  date: string | null; // ISO date
  type: string | null; // "block"
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

interface ManualSlot {
  id: string;
  style_captain_id: string | null;
  start_at: string | null; // ISO timestamp
  end_at: string | null;
  status: string | null;
  source: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Table names ──────────────────────────────────────────────────────────────

const RULES_TABLE = "style_captain_availability_rules";
const EXCEPTIONS_TABLE = "style_captain_slot_exceptions";
const SLOTS_TABLE = "style_captain_slots";

// ─── Main component ───────────────────────────────────────────────────────────

type SubTab = "rules" | "blocks" | "slots";

export function CaptainScheduleManager({
  captainId,
  captainName,
}: {
  captainId: string;
  captainName: string | null;
}) {
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [exceptions, setExceptions] = useState<SlotException[]>([]);
  const [slots, setSlots] = useState<ManualSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("rules");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, excRes, slotsRes] = await Promise.all([
        fetchTableRows<AvailabilityRule>(RULES_TABLE, {
          filters: { style_captain_id: captainId },
          perPage: 100,
        }).catch(() => ({ rows: [] as AvailabilityRule[], total: 0, columns: [] })),
        fetchTableRows<SlotException>(EXCEPTIONS_TABLE, {
          filters: { style_captain_id: captainId },
          perPage: 100,
          sortColumn: "date",
          sortDirection: "asc",
        }).catch(() => ({ rows: [] as SlotException[], total: 0, columns: [] })),
        fetchTableRows<ManualSlot>(SLOTS_TABLE, {
          filters: { style_captain_id: captainId },
          perPage: 100,
          sortColumn: "start_at",
          sortDirection: "asc",
        }).catch(() => ({ rows: [] as ManualSlot[], total: 0, columns: [] })),
      ]);
      setRules(rulesRes.rows);
      setExceptions(excRes.rows);
      setSlots(slotsRes.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [captainId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="mb-6">
      <h2 className="mb-3 font-heading text-lg font-semibold text-ink-navy">
        Schedule Management
      </h2>

      <div className="rounded-xl border border-hairline bg-chalk-white p-5">
        {/* Summary */}
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-hairline bg-mist-navy/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted">Active Rules</p>
            <p className="mt-0.5 text-xl font-bold text-ink-navy">
              {rules.filter((r) => r.is_active ?? true).length}
            </p>
          </div>
          <div className="rounded-lg border border-hairline bg-mist-navy/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted">Blocked Dates</p>
            <p className="mt-0.5 text-xl font-bold text-ink-navy">{exceptions.length}</p>
          </div>
          <div className="rounded-lg border border-hairline bg-mist-navy/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted">Manual Slots</p>
            <p className="mt-0.5 text-xl font-bold text-ink-navy">{slots.length}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={load} className="ml-2 underline">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-muted">Loading schedule…</div>
        ) : (
          <>
            {/* Sub-tab switcher */}
            <div className="mb-4 flex gap-1 rounded-lg border border-hairline bg-mist-navy/20 p-1">
              {(["rules", "blocks", "slots"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSubTab(t)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium capitalize transition ${
                    subTab === t
                      ? "bg-ink-navy text-chalk-white"
                      : "text-muted hover:text-ink-navy"
                  }`}
                >
                  {t === "rules" ? "Schedule Rules" : t === "blocks" ? "Holidays / Blocks" : "Manual Slots"}
                </button>
              ))}
            </div>

            {subTab === "rules" && (
              <RulesSection captainId={captainId} rules={rules} onChanged={load} />
            )}
            {subTab === "blocks" && (
              <BlocksSection captainId={captainId} exceptions={exceptions} onChanged={load} />
            )}
            {subTab === "slots" && (
              <SlotsSection captainId={captainId} slots={slots} onChanged={load} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ─── Rules Section ────────────────────────────────────────────────────────────

function RulesSection({
  captainId,
  rules,
  onChanged,
}: {
  captainId: string;
  rules: AvailabilityRule[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AvailabilityRule | null>(null);

  if (showForm || editing) {
    return (
      <RuleForm
        captainId={captainId}
        rule={editing}
        onCancel={() => {
          setShowForm(false);
          setEditing(null);
        }}
        onSaved={() => {
          setShowForm(false);
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  const sorted = [...rules].sort((a, b) => {
    if (a.weekday === null && b.weekday !== null) return -1;
    if (a.weekday !== null && b.weekday === null) return 1;
    return (a.weekday ?? 0) - (b.weekday ?? 0);
  });

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-hairline-strong bg-chalk-white px-4 py-3 text-sm font-medium text-ink-navy hover:bg-mist-navy/30"
      >
        + Add availability rule
      </button>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-6 text-center">
          <p className="text-sm font-medium text-ink-navy">No rules yet</p>
          <p className="mt-1 text-xs text-muted">
            Add a rule to set this captain&apos;s weekly availability.
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
  rule: AvailabilityRule;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleToggle() {
    setBusy(true);
    try {
      await updateTableRow(RULES_TABLE, rule.id, {
        is_active: !(rule.is_active ?? true),
      });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteTableRow(RULES_TABLE, rule.id);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const isActive = rule.is_active ?? true;
  const isClosed = rule.is_closed ?? false;

  return (
    <div
      className={`rounded-lg border p-4 transition ${
        isActive ? "border-hairline bg-chalk-white" : "border-hairline-strong bg-mist-navy/20"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={isActive ? "" : "opacity-60"}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-navy">
              {weekdayLabel(rule.weekday)}
            </span>
            {!isActive && (
              <span className="rounded-pill bg-mist-navy px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">
                Paused
              </span>
            )}
            {isClosed && (
              <span className="rounded-pill bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                Closed
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {isClosed
              ? "Not available this day"
              : `${timeLabel(rule.start_time)} – ${timeLabel(rule.end_time)}`}
          </p>
        </div>
        <span
          className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
            isActive ? "bg-green-500" : "bg-gray-300"
          }`}
        />
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
        <button
          onClick={onEdit}
          disabled={busy}
          className="flex-1 rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs font-medium text-ink-navy hover:bg-mist-navy/30 disabled:opacity-50"
        >
          Edit
        </button>
        <button
          onClick={handleToggle}
          disabled={busy}
          className="flex-1 rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs font-medium text-ink-navy hover:bg-mist-navy/30 disabled:opacity-50"
        >
          {isActive ? "Pause" : "Activate"}
        </button>
        {confirmDelete ? (
          <>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function RuleForm({
  captainId,
  rule,
  onCancel,
  onSaved,
}: {
  captainId: string;
  rule: AvailabilityRule | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [weekday, setWeekday] = useState<string>(
    rule?.weekday === null || rule?.weekday === undefined ? "daily" : String(rule.weekday),
  );
  const [isClosed, setIsClosed] = useState(rule?.is_closed ?? false);
  const [startTime, setStartTime] = useState(rule?.start_time?.slice(0, 5) ?? "09:00");
  const [endTime, setEndTime] = useState(rule?.end_time?.slice(0, 5) ?? "17:00");
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const weekdayNum = weekday === "daily" ? null : parseInt(weekday, 10);
      const payload = {
        style_captain_id: captainId,
        weekday: weekdayNum,
        is_closed: isClosed,
        start_time: isClosed ? null : `${startTime}:00`,
        end_time: isClosed ? null : `${endTime}:00`,
        is_active: isActive,
      };

      if (rule) {
        await updateTableRow(RULES_TABLE, rule.id, payload);
      } else {
        await createTableRow(RULES_TABLE, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-chalk-white p-4">
      <h3 className="mb-4 text-sm font-semibold text-ink-navy">
        {rule ? "Edit rule" : "New availability rule"}
      </h3>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Weekday */}
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Applies to
          </label>
          <select
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
          >
            <option value="daily">Every day (daily)</option>
            {Object.entries(WEEKDAY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Closed toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is-closed"
            checked={isClosed}
            onChange={(e) => setIsClosed(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="is-closed" className="text-sm text-ink">
            Mark as closed (unavailable)
          </label>
        </div>

        {/* Time range */}
        {!isClosed && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                Start time
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                End time
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
              />
            </div>
          </div>
        )}

        {/* Active toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is-active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="is-active" className="text-sm text-ink">
            Active (takes effect immediately)
          </label>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-semibold text-chalk-white hover:bg-tape disabled:opacity-50"
        >
          {saving ? "Saving…" : rule ? "Update Rule" : "Create Rule"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-hairline-strong px-4 py-1.5 text-xs font-medium hover:bg-mist-navy/30"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Blocks Section (Exceptions) ──────────────────────────────────────────────

function BlocksSection({
  captainId,
  exceptions,
  onChanged,
}: {
  captainId: string;
  exceptions: SlotException[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = exceptions.filter(
    (e) => (e.date ?? "") >= today,
  );

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-hairline-strong bg-chalk-white px-4 py-3 text-sm font-medium text-ink-navy hover:bg-mist-navy/30"
      >
        {showForm ? "✕ Cancel" : "+ Block a date"}
      </button>

      {showForm && (
        <BlockForm
          captainId={captainId}
          onCancel={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            onChanged();
          }}
        />
      )}

      {upcoming.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-6 text-center">
          <p className="text-sm font-medium text-ink-navy">No upcoming blocks</p>
          <p className="mt-1 text-xs text-muted">
            Add a block to mark this captain unavailable on a specific date.
          </p>
        </div>
      ) : (
        upcoming.map((exc) => (
          <ExceptionRow key={exc.id} exception={exc} onChanged={onChanged} />
        ))
      )}
    </div>
  );
}

function BlockForm({
  captainId,
  onCancel,
  onSaved,
}: {
  captainId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [reason, setReason] = useState("");
  const [fullDay, setFullDay] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!date) {
      setError("Date is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createTableRow(EXCEPTIONS_TABLE, {
        style_captain_id: captainId,
        date,
        type: "block",
        start_time: fullDay ? null : `${startTime}:00`,
        end_time: fullDay ? null : `${endTime}:00`,
        reason: reason.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create block");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-chalk-white p-4">
      <h3 className="mb-4 text-sm font-semibold text-ink-navy">New date block</h3>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Date *
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="full-day"
            checked={fullDay}
            onChange={(e) => setFullDay(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="full-day" className="text-sm text-ink">
            Full day block
          </label>
        </div>
        {!fullDay && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                From
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                To
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
              />
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Reason (optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Holiday, sick leave…"
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
          />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-semibold text-chalk-white hover:bg-tape disabled:opacity-50"
        >
          {saving ? "Creating…" : "Block Date"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-hairline-strong px-4 py-1.5 text-xs font-medium hover:bg-mist-navy/30"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ExceptionRow({
  exception,
  onChanged,
}: {
  exception: SlotException;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm(`Remove block on ${dateLabel(exception.date)}?`)) return;
    setBusy(true);
    try {
      await deleteTableRow(EXCEPTIONS_TABLE, exception.id);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  const isFullDay =
    !exception.start_time && !exception.end_time;

  return (
    <div className="flex items-center justify-between rounded-lg border border-hairline bg-chalk-white p-3">
      <div>
        <div className="text-sm font-medium text-ink-navy">
          {dateLabel(exception.date)}
        </div>
        <div className="text-xs text-muted">
          {isFullDay
            ? "Full day blocked"
            : `${timeLabel(exception.start_time)} – ${timeLabel(exception.end_time)}`}
          {exception.reason ? ` • ${exception.reason}` : ""}
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={busy}
        className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}

// ─── Manual Slots Section ─────────────────────────────────────────────────────

function SlotsSection({
  captainId,
  slots,
  onChanged,
}: {
  captainId: string;
  slots: ManualSlot[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-hairline-strong bg-chalk-white px-4 py-3 text-sm font-medium text-ink-navy hover:bg-mist-navy/30"
      >
        {showForm ? "✕ Cancel" : "+ Add manual slot"}
      </button>

      {showForm && (
        <ManualSlotForm
          captainId={captainId}
          onCancel={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            onChanged();
          }}
        />
      )}

      {slots.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-6 text-center">
          <p className="text-sm font-medium text-ink-navy">No manual slots</p>
          <p className="mt-1 text-xs text-muted">
            Add a one-off slot to create extra availability outside the weekly rules.
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

function ManualSlotForm({
  captainId,
  onCancel,
  onSaved,
}: {
  captainId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [startAt, setStartAt] = useState("");
  const [durationMin, setDurationMin] = useState("60");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!startAt) {
      setError("Start date/time is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const start = new Date(startAt);
      const end = new Date(start.getTime() + parseInt(durationMin, 10) * 60000);
      await createTableRow(SLOTS_TABLE, {
        style_captain_id: captainId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status: "open",
        source: "admin",
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create slot");
    } finally {
      setSaving(false);
    }
  }

  // Min datetime = now in local ISO format for input
  const minDatetime = new Date().toISOString().slice(0, 16);

  return (
    <div className="rounded-lg border border-hairline bg-chalk-white p-4">
      <h3 className="mb-4 text-sm font-semibold text-ink-navy">New manual slot</h3>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Start date & time *
          </label>
          <input
            type="datetime-local"
            value={startAt}
            min={minDatetime}
            onChange={(e) => setStartAt(e.target.value)}
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Duration (minutes)
          </label>
          <select
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px]"
          >
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
            <option value="180">3 hours</option>
          </select>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-semibold text-chalk-white hover:bg-tape disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create Slot"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-hairline-strong px-4 py-1.5 text-xs font-medium hover:bg-mist-navy/30"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ManualSlotRow({
  slot,
  onChanged,
}: {
  slot: ManualSlot;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm("Remove this manual slot?")) return;
    setBusy(true);
    try {
      await deleteTableRow(SLOTS_TABLE, slot.id);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  const isPast = slot.start_at ? new Date(slot.start_at) < new Date() : false;

  return (
    <div className="flex items-center justify-between rounded-lg border border-hairline bg-chalk-white p-3">
      <div>
        <div className="text-sm font-medium text-ink-navy">
          {datetimeLabel(slot.start_at)}
        </div>
        <div className="text-xs text-muted">
          to {datetimeLabel(slot.end_at)}
          {slot.status ? ` • ${slot.status}` : ""}
          {slot.source ? ` • via ${slot.source}` : ""}
          {isPast ? " • past" : ""}
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={busy}
        className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}
