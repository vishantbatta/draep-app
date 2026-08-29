"use client";

/**
 * SlotPicker — real BE-backed slot picker on /confirmed.
 *
 * Calls GET /orders/{id}/slots to fetch collapsed availability across all
 * captains, lets the customer pick date + time, then POST /orders/{id}/booking
 * which auto-assigns the least-utilized captain.
 *
 * Captain names are never shown in the picker (collapsed at the BE). The
 * assigned captain name is returned in the booking response and surfaced by
 * the parent on the confirmation card.
 *
 * Booking contract: the picker echoes the canonical `start_at` instant that
 * the BE returned in SlotOption.start_at — it never reconstructs an instant
 * from a wall-clock string. This removes the entire class of timezone
 * round-trip bugs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { bookingApi, serviceAreaApi, ApiError } from "@/lib/api";
import { strings } from "@/lib/strings";
import type { DaySlots, SlotOption, Booking } from "@/types/booking";

interface SlotPickerProps {
  orderId: string;
  /** Called when the booking is successfully created. */
  onBooked: (booking: Booking) => void;
}

export function SlotPicker({ orderId, onBooked }: SlotPickerProps) {
  const [days, setDays] = useState<DaySlots[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<SlotOption | undefined>();
  const [booking, setBooking] = useState(false);
  // Capture demand once per empty state ("…we will notify you when they
  // open up") — one fire-and-forget POST per empty slots response.
  const notifySentRef = useRef(false);

  // Fetch available slots on mount
  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    notifySentRef.current = false;
    try {
      const res = await bookingApi.getSlots(orderId);
      setDays(res.days);
      if (res.days.length === 0 && !notifySentRef.current) {
        notifySentRef.current = true;
        // Pure demand capture — outcome is irrelevant to the UI.
        void serviceAreaApi.notifyMe({ order_id: orderId }).catch(() => {});
      }
      if (res.days.length > 0 && !selectedDate) {
        setSelectedDate(res.days[0].date);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't load available times. Please refresh.",
      );
    } finally {
      setLoading(false);
    }
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const slots = days.find((d) => d.date === selectedDate)?.slots ?? [];

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setBooking(true);
    setError(null);
    try {
      // Echo the BE-supplied canonical instant verbatim — no client-side
      // reconstruction. See SlotOption.start_at.
      const result = await bookingApi.createBooking(orderId, selectedSlot.start_at);
      onBooked(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't book this slot. Try another time.",
      );
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  if (error && days.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </p>
        <Button variant="secondary" onClick={loadSlots} fullWidth>
          Try again
        </Button>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <p className="rounded-card border border-hairline bg-warm-sand px-4 py-6 text-center text-body text-muted">
        {strings.schedule.noSlotsAvailable}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Date chips */}
      <div>
        <p className="mb-2 text-caption text-muted">Date</p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {days.map((d) => {
            const dt = new Date(d.date + "T00:00:00");
            return (
              <Chip
                key={d.date}
                selected={selectedDate === d.date}
                onClick={() => {
                  setSelectedDate(d.date);
                  setSelectedSlot(undefined);
                }}
                className="flex-col !min-w-[60px]"
              >
                <span className="flex flex-col items-center">
                  <span className="text-[10px] uppercase">
                    {dt.toLocaleDateString("en-IN", { weekday: "short" })}
                  </span>
                  <MonoNumber className="text-data">
                    {dt.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </MonoNumber>
                </span>
              </Chip>
            );
          })}
        </div>
      </div>

      {/* Time chips */}
      <div>
        <p className="mb-2 text-caption text-muted">
          {slots.length > 0
            ? "Available times"
            : selectedDate
              ? "No times available on this day — pick another date."
              : "Pick a date first"}
        </p>
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <Chip
              key={s.start_at}
              selected={selectedSlot?.start_at === s.start_at}
              onClick={() => setSelectedSlot(s)}
            >
              {formatTimeLabel(s.label)}
            </Chip>
          ))}
        </div>
      </div>

      {/* Error message (inline, non-blocking) */}
      {error && days.length > 0 && (
        <p className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </p>
      )}

      {/* Confirm CTA */}
      <Button
        onClick={handleConfirm}
        disabled={!selectedSlot}
        loading={booking}
        fullWidth
        className="mt-2"
      >
        Confirm slot
      </Button>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a BE-supplied "HH:MM" label for display. The label is already
 * rendered in the project timezone (Asia/Kolkata); this just converts the
 * 24-hour format to a friendly 12-hour form.
 *
 * "10:00" → "10:00 AM"
 * "14:00" → "2:00 PM"
 */
function formatTimeLabel(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}
