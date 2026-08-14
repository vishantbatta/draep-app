"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchCalendar,
  fetchStyleCaptains,
  type CalendarDay,
  type CalendarSlot,
  type UserRow,
} from "@/lib/admin-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "HH:MM" (24-hour) → "h:MM AM/PM" */
function formatTimeLabel(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

function parseDayLabel(day: string): string {
  const dt = new Date(day + "T00:00:00");
  if (isNaN(dt.getTime())) return day;
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Local calendar date (YYYY-MM-DD) offset by n days. */
function isoDateOffset(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Tooltip text: captains available vs booked at this slot. */
function slotTooltip(slot: CalendarSlot): string {
  const lines = [`${formatTimeLabel(slot.label)}`];
  if (slot.available.length > 0) {
    lines.push(
      `Available (${slot.available.length}): ${slot.available
        .map((c) => c.name)
        .join(", ")}`,
    );
  } else {
    lines.push("Available (0)");
  }
  if (slot.booked.length > 0) {
    lines.push(
      `Booked (${slot.booked.length}): ${slot.booked
        .map(
          (c) =>
            `${c.name}${c.order_number ? ` — ${c.order_number}` : ""} (${c.status})`,
        )
        .join(", ")}`,
    );
  } else {
    lines.push("Booked (0)");
  }
  return lines.join("\n");
}

// ─── Slot chip ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "booked"
      ? "bg-ink-navy/10 text-ink-navy"
      : status === "manual"
        ? "bg-orange-100 text-orange-800"
        : "bg-red-100 text-red-700";
  return (
    <span
      className={`rounded-pill px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

function SlotChip({
  slot,
  onOpenOrder,
}: {
  slot: CalendarSlot;
  onOpenOrder: (orderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false); // open below when chip is near viewport top
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const avail = slot.available.length;
  const booked = slot.booked.length;

  const openPopover = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r && r.top < 240) setFlip(true);
    else setFlip(false);
    setOpen(true);
  };

  // Click-only popover: close on outside click, scroll, or Escape
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  let chipClass: string;
  if (avail > 0 && booked > 0) {
    // Mixed: some captains free, at least one claim overlapping
    chipClass =
      "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100";
  } else if (avail > 0) {
    chipClass =
      "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
  } else if (booked > 0) {
    // Fully booked: no captain is available at this grid step
    chipClass =
      "border-ink-navy/40 bg-ink-navy text-chalk-white hover:bg-ink-navy/90";
  } else {
    // Neither: inside someone's buffer window or past lead time
    chipClass =
      "border-dashed border-hairline-strong bg-mist-navy/20 text-muted";
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        title={slotTooltip(slot)}
        aria-expanded={open}
        className={`w-full rounded-lg border px-1.5 py-1 text-center transition ${chipClass}`}
      >
        <div className="text-[11px] font-medium leading-tight">
          {formatTimeLabel(slot.label)}
        </div>
        <div className="flex items-center justify-center gap-1 text-[9px] leading-tight">
          {avail > 0 && (
            <span className="font-semibold text-emerald-700">{avail} free</span>
          )}
          {avail > 0 && booked > 0 && <span className="opacity-50">·</span>}
          {booked > 0 && (
            <span
              className={`font-semibold ${avail > 0 ? "text-amber-800" : "text-chalk-white/80"}`}
            >
              {booked} booked
            </span>
          )}
          {avail === 0 && booked === 0 && <span>—</span>}
        </div>
      </button>

      {open && (
        <div
          className={`absolute left-1/2 z-30 w-60 max-w-[75vw] -translate-x-1/2 rounded-xl border border-hairline bg-chalk-white p-2.5 text-left shadow-card ${
            flip ? "top-full mt-1.5" : "bottom-full mb-1.5"
          }`}
        >
          <div className="mb-1.5 border-b border-hairline pb-1.5">
            <div className="font-heading text-[13px] font-semibold text-ink-navy">
              {formatTimeLabel(slot.label)}
            </div>
            <div className="text-[10px] text-muted">
              {avail} available · {booked} booked
            </div>
          </div>

          {/* Booked jobs — one-liner rows like the available list; clickable
              rows jump to the order page */}
          {booked > 0 && (
            <div className="mb-1.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Booked
              </div>
              <div className="space-y-0.5">
                {slot.booked.map((c) => {
                  const row = (
                    <>
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-navy" />
                      <span className="truncate text-[11px] font-medium text-ink-navy">
                        {c.name}
                      </span>
                      <StatusBadge status={c.status} />
                      {c.order_number && (
                        <span className="truncate text-[10px] text-muted">
                          {c.order_number}
                        </span>
                      )}
                      {c.order_id && (
                        <span className="ml-auto shrink-0 text-[10px] text-muted">
                          →
                        </span>
                      )}
                    </>
                  );
                  return c.order_id ? (
                    <button
                      key={c.id}
                      type="button"
                      title="View order"
                      onClick={() => onOpenOrder(c.order_id!)}
                      className="tap flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-mist-navy/40"
                    >
                      {row}
                    </button>
                  ) : (
                    <div
                      key={c.id}
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5"
                    >
                      {row}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available captains */}
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Available
            </div>
            {avail > 0 ? (
              <div className="space-y-0.5">
                {slot.available.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-1.5 text-[11px] text-ink"
                  >
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate">{c.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-muted">
                No captain free at this slot.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Day card ─────────────────────────────────────────────────────────────────

function DayCard({
  day,
  onOpenOrder,
  captainFilter,
}: {
  day: CalendarDay;
  onOpenOrder: (orderId: string) => void;
  captainFilter: string;
}) {
  const availCount = day.slots.filter((s) => s.available.length > 0).length;
  const bookedCount = day.slots.filter((s) => s.booked.length > 0).length;

  return (
    <div className="rounded-xl border border-hairline bg-chalk-white p-3 shadow-card">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-hairline pb-2">
        <div className="font-heading text-sm font-semibold text-ink-navy">
          {parseDayLabel(day.date)}
        </div>
        <div className="text-[11px] text-muted">
          <span className="font-semibold text-emerald-700">{availCount} available</span>
          <span className="mx-1">·</span>
          <span className="font-semibold text-ink-navy">{bookedCount} booked</span>
          <span className="mx-1">·</span>
          <span>{day.slots.length} slots</span>
        </div>
      </div>
      {day.slots.length === 0 ? (
        <div className="py-3 text-center text-xs text-muted">
          No working hours{captainFilter ? "" : " — all captains off"}.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {day.slots.map((s) => (
            <SlotChip key={s.start_at} slot={s} onOpenOrder={onOpenOrder} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 7;

export default function AdminCalendarPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [weekStartOffset, setWeekStartOffset] = useState(0); // days from today
  const [captainFilter, setCaptainFilter] = useState(""); // "" = all captains
  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [data, setData] = useState<CalendarDay[]>([]);
  const [slotMinutes, setSlotMinutes] = useState(15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openOrder = useCallback(
    (orderId: string) => router.push(`/admin/orders/${orderId}`),
    [router],
  );

  const fromDate = isoDateOffset(today, weekStartOffset);
  const toDate = isoDateOffset(today, weekStartOffset + WINDOW_DAYS - 1);

  // Calendar tab has no sub-tabs — clear the secondary sidebar
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", { detail: null }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("admin-sidebar-update", { detail: null }),
      );
    };
  }, []);

  // Style captain list for the filter dropdown
  useEffect(() => {
    fetchStyleCaptains()
      .then(setCaptains)
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchCalendar(fromDate, toDate, captainFilter || undefined)
      .then((res) => {
        setData(res.days);
        setSlotMinutes(res.slot_minutes);
      })
      .catch((e) => {
        setError(
          e instanceof Error ? e.message : "Couldn't load the calendar.",
        );
      })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, captainFilter]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  // Window-wide summary
  const summary = useMemo(() => {
    let total = 0;
    let avail = 0;
    let booked = 0;
    for (const d of data) {
      for (const s of d.slots) {
        total += 1;
        if (s.available.length > 0) avail += 1;
        if (s.booked.length > 0) booked += 1;
      }
    }
    return { total, avail, booked };
  }, [data]);

  const rangeLabel = `${parseDayLabel(fromDate).replace(/^\w+,?\s*/, "")} – ${parseDayLabel(toDate)}`;

  return (
    <div className="min-h-dvh bg-warm-sand p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-eyebrow text-muted">Draep admin</div>
            <h1 className="font-heading text-h2 text-ink-navy">Calendar</h1>
            <p className="text-caption text-muted">
              {slotMinutes}-minute grid · tap a slot to see which captains are
              free or booked
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="mr-1 flex items-center gap-1.5 text-[11px] font-medium text-muted">
              Captain
              <select
                value={captainFilter}
                onChange={(e) => setCaptainFilter(e.target.value)}
                className="max-w-44 truncate rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1.5 text-xs text-ink focus:border-ink-navy focus:outline-none"
              >
                <option value="">All</option>
                {captains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.phone ?? c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => setWeekStartOffset((o) => o - WINDOW_DAYS)}
              className="tap rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-mist-navy/30"
            >
              ← Prev
            </button>
            <button
              onClick={() => setWeekStartOffset(0)}
              disabled={weekStartOffset === 0}
              className="tap rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-mist-navy/30 disabled:opacity-40"
            >
              Today
            </button>
            <button
              onClick={() => setWeekStartOffset((o) => o + WINDOW_DAYS)}
              className="tap rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-mist-navy/30"
            >
              Next →
            </button>
          </div>
        </div>

        {/* Legend + summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-chalk-white px-3 py-2 shadow-card">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-50" />
              Available
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-300 bg-amber-50" />
              Mixed (free + booked)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-ink-navy/40 bg-ink-navy" />
              Fully booked
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-hairline-strong bg-mist-navy/20" />
              Buffer / closed
            </span>
          </div>
          <div className="text-[11px] text-muted">
            <span className="font-semibold text-ink-navy">{rangeLabel}</span>
            <span className="mx-1.5">·</span>
            <span className="font-semibold text-emerald-700">
              {summary.avail} available
            </span>
            <span className="mx-1">·</span>
            <span className="font-semibold text-ink-navy">
              {summary.booked} booked
            </span>
            <span className="mx-1">·</span>
            <span>{summary.total} slots</span>
          </div>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-8 text-center text-xs text-muted">
            Loading calendar…
          </div>
        )}

        {/* Days */}
        {!loading && !error && data.length === 0 && (
          <div className="rounded-xl border border-hairline bg-mist-navy/10 px-3 py-6 text-center text-xs text-muted">
            No scheduling grid for {rangeLabel} — check captain availability
            rules.
          </div>
        )}
        {!loading && !error && data.length > 0 && (
          <div className="space-y-3">
            {data.map((d) => (
              <DayCard
                key={d.date}
                day={d}
                onOpenOrder={openOrder}
                captainFilter={captainFilter}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
