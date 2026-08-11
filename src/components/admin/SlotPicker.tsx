"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchOpenSlots,
  type AdminDaySlots,
  type AdminSlotOption,
  type UserRow,
} from "@/lib/admin-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateId(id: string): string {
  return id.slice(0, 8);
}

/** Convert "HH:MM" (24-hour) → "h:MM AM/PM" for display. */
function formatTimeLabel(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface SlotPickerProps {
  /** ISO date (YYYY-MM-DD) currently selected, or null. */
  selectedDate: string | null;
  /** Full slot object currently selected, or null. Parent reads `.start_at`. */
  selectedSlot: AdminSlotOption | null;
  /** Currently chosen captain id, or "" for auto-assign. */
  selectedCaptainId: string;
  onDateChange: (date: string | null) => void;
  onSlotChange: (slot: AdminSlotOption | null) => void;
  onCaptainChange: (captainId: string) => void;
  /** Full captain list; the picker filters to those available at the slot. */
  captains: UserRow[];
  /** Hide the captain <select> when the parent already owns a captain control. */
  hideCaptainSelect?: boolean;
  fromDate?: string;
  toDate?: string;
}

export function SlotPicker({
  selectedDate,
  selectedSlot,
  selectedCaptainId,
  onDateChange,
  onSlotChange,
  onCaptainChange,
  captains,
  hideCaptainSelect = false,
  fromDate,
  toDate,
}: SlotPickerProps) {
  const [slotDays, setSlotDays] = useState<AdminDaySlots[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // ── Load open slots on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    fetchOpenSlots(fromDate, toDate)
      .then((res) => {
        if (cancelled) return;
        setSlotDays(res.days);
        if (res.days.length > 0 && !selectedDate) {
          onDateChange(res.days[0].date);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setSlotsError(
          e instanceof Error ? e.message : "Couldn't load available slots.",
        );
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Slots for the currently selected date ──────────────────────────────────
  const currentDaySlots = useMemo(
    () => slotDays.find((d) => d.date === selectedDate)?.slots ?? [],
    [slotDays, selectedDate],
  );

  // ── Captains available at the selected slot ────────────────────────────────
  const availableCaptains = useMemo(
    () =>
      selectedSlot
        ? captains.filter((c) => selectedSlot.captain_ids.includes(c.id))
        : [],
    [selectedSlot, captains],
  );

  return (
    <div className="space-y-4">
      {/* Loading */}
      {slotsLoading && (
        <div className="py-4 text-center text-xs text-muted">
          Loading available slots…
        </div>
      )}

      {/* Error */}
      {slotsError && !slotsLoading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {slotsError}
        </div>
      )}

      {/* No slots */}
      {!slotsLoading && !slotsError && slotDays.length === 0 && (
        <div className="rounded-lg border border-hairline bg-mist-navy/10 px-3 py-4 text-center text-xs text-muted">
          No slots available in the next two weeks.
        </div>
      )}

      {/* Picker */}
      {!slotsLoading && !slotsError && slotDays.length > 0 && (
        <>
          {/* Date chips */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-muted">Date</div>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {slotDays.map((d) => {
                const dt = new Date(d.date + "T00:00:00");
                return (
                  <button
                    key={d.date}
                    onClick={() => {
                      onDateChange(d.date);
                      onSlotChange(null);
                      onCaptainChange("");
                    }}
                    className={`flex flex-col items-center rounded-lg border px-1 py-1.5 transition ${
                      selectedDate === d.date
                        ? "border-ink-navy bg-ink-navy text-chalk-white"
                        : "border-hairline-strong bg-chalk-white text-ink hover:bg-mist-navy/30"
                    }`}
                  >
                    <span className="text-[9px] uppercase opacity-70">
                      {dt.toLocaleDateString("en-IN", { weekday: "short" })}
                    </span>
                    <span className="text-[11px] font-medium leading-tight">
                      {dt.toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time chips */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-muted">
              {currentDaySlots.length > 0
                ? "Available times"
                : "No times on this day — pick another date."}
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {currentDaySlots.map((s) => (
                <button
                  key={s.start_at}
                  onClick={() => {
                    onSlotChange(s);
                    onCaptainChange("");
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                    selectedSlot?.start_at === s.start_at
                      ? "border-ink-navy bg-ink-navy text-chalk-white"
                      : "border-hairline-strong bg-chalk-white text-ink hover:bg-mist-navy/30"
                  }`}
                >
                  {formatTimeLabel(s.label)}
                </button>
              ))}
            </div>
          </div>

          {/* Captain selection — only after a slot is picked */}
          {!hideCaptainSelect && selectedSlot && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted">
                Style Captain{" "}
                <span className="text-muted">
                  ({availableCaptains.length} available — auto-assigned if left
                  blank)
                </span>
              </label>
              <select
                value={selectedCaptainId}
                onChange={(e) => onCaptainChange(e.target.value)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              >
                <option value="">— Auto-assign —</option>
                {availableCaptains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.phone ?? truncateId(c.id)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}
