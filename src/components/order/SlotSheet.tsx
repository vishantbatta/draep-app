"use client";

/**
 * SlotSheet — visit-slot picker in a bottom sheet for the order page.
 *
 * Shows the next 7 days (today first) as a horizontally scrollable date
 * strip, the day's available times grouped Morning / Afternoon / Evening,
 * and a sticky Select CTA. Selecting books (or reschedules) the order's
 * measurement visit:
 *
 *   no active visit  → POST /orders/{id}/booking  (auto-assigns a captain)
 *   active visit     → PATCH /orders/{id}/booking (reschedule)
 *
 * Booking contract: the sheet echoes the canonical `start_at` instant the
 * BE returned — never reconstructs an instant from a wall-clock string.
 * Days the BE reports as sold out stay in the strip but are disabled, so
 * "today" never silently disappears.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { Clock } from "@/components/ui/icons";
import { ApiError, bookingApi } from "@/lib/api";
import { strings } from "@/lib/strings";
import { visitDateTimeLabel } from "@/lib/order-display";
import type { Booking, DaySlots, SlotOption } from "@/types/booking";

interface SlotSheetProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  /** The order's active visit, if one exists — Select then reschedules. */
  currentBooking: Booking | null;
  onBooked: (booking: Booking) => void;
  /** 409 order_already_booked — someone booked elsewhere; parent refreshes. */
  onAlreadyBooked?: () => void;
}

/** Local yyyy-mm-dd key, matching the BE's date keys (Asia/Kolkata days). */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "14:00" → "2:00 PM" — label is already in the project timezone. */
function to12h(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

const PARTS_OF_DAY = [
  { key: "morning", label: strings.orderDetail.slotMorning, from: 0, to: 12 },
  { key: "afternoon", label: strings.orderDetail.slotAfternoon, from: 12, to: 17 },
  { key: "evening", label: strings.orderDetail.slotEvening, from: 17, to: 24 },
] as const;

export function SlotSheet({
  open,
  onClose,
  orderId,
  currentBooking,
  onBooked,
  onAlreadyBooked,
}: SlotSheetProps) {
  const [days, setDays] = useState<DaySlots[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotOption | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // The strip is generated client-side so all 7 days always render; the BE
  // only returns days that still have open slots.
  const strip = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return { date: d, key: dayKey(d) };
    });
  }, []);

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await bookingApi.getSlots(
        orderId,
        strip[0].key,
        strip[strip.length - 1].key,
      );
      setDays(res.days);
      setSelectedSlot(null);
      // Default to the current booking's day when rescheduling, else the
      // first day that still has slots (today may be sold out).
      const preferred =
        (currentBooking?.scheduled_at &&
          dayKey(new Date(currentBooking.scheduled_at))) ||
        res.days.find((d) => d.slots.length > 0)?.date ||
        res.days[0]?.date ||
        strip[0].key;
      setSelectedDate(preferred);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : strings.orderDetail.slotLoadError,
      );
    } finally {
      setLoading(false);
    }
  }, [orderId, strip, currentBooking]);

  useEffect(() => {
    if (open) void loadSlots();
  }, [open, loadSlots]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, SlotOption[]>();
    for (const d of days) map.set(d.date, d.slots);
    return map;
  }, [days]);

  const slots = selectedDate ? (slotsByDay.get(selectedDate) ?? []) : [];

  const handleSelect = async () => {
    if (!selectedSlot || booking) return;
    setBooking(true);
    setBookError(null);
    try {
      const result = currentBooking
        ? await bookingApi.rescheduleBooking(orderId, selectedSlot.start_at)
        : await bookingApi.createBooking(orderId, selectedSlot.start_at);
      onBooked(result);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === "order_already_booked" &&
        onAlreadyBooked
      ) {
        onAlreadyBooked();
        return;
      }
      setBookError(
        err instanceof Error ? err.message : strings.orderDetail.slotBookError,
      );
      // The pick may have been taken in a race — refresh the times so the
      // sheet doesn't keep offering a dead slot.
      if (err instanceof ApiError && err.code === "slot_taken") {
        try {
          const res = await bookingApi.getSlots(
            orderId,
            strip[0].key,
            strip[strip.length - 1].key,
          );
          setDays(res.days);
          setSelectedSlot(null);
        } catch {
          // keep the surfaced booking error
        }
      }
    } finally {
      setBooking(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={strings.orderDetail.slotSheetTitle}
      footer={
        <div>
          {selectedSlot && (
            <p className="mb-2 flex items-center justify-center gap-1.5 text-caption text-muted">
              <Clock size={13} className="text-accent-text" />
              {visitDateTimeLabel(selectedSlot.start_at)}
            </p>
          )}
          <Button
            fullWidth
            disabled={!selectedSlot}
            loading={booking}
            onClick={() => void handleSelect()}
          >
            {strings.orderDetail.slotSelect}
          </Button>
        </div>
      }
    >
      <p className="pb-3 text-caption text-muted">
        {strings.orderDetail.slotSheetHint}
      </p>

      {/* Date strip — next 7 days, today first, sold-out days disabled */}
      <div className="flex gap-2 overflow-x-auto pb-3">
        {strip.map(({ date, key }, i) => {
          const count = slotsByDay.get(key)?.length ?? 0;
          const selected = selectedDate === key;
          const disabled = count === 0;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => {
                setSelectedDate(key);
                setSelectedSlot(null);
              }}
              className={`flex min-w-[64px] flex-col items-center rounded-card border-[1.5px] px-2 py-2.5 transition ${
                disabled
                  ? "cursor-not-allowed border-hairline bg-mist-navy/30 opacity-45"
                  : selected
                    ? "border-navy-interactive bg-navy-interactive text-chalk-white shadow-card"
                    : "border-hairline bg-chalk-white hover:bg-mist-navy/40"
              }`}
            >
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  selected ? "text-chalk-white/80" : "text-muted"
                }`}
              >
                {i === 0
                  ? strings.orderDetail.slotToday
                  : date.toLocaleDateString("en-IN", { weekday: "short" })}
              </span>
              <MonoNumber
                className={`mt-0.5 text-data text-lg ${
                  selected ? "text-chalk-white" : "text-ink-navy"
                }`}
              >
                {date.getDate()}
              </MonoNumber>
              <span
                className={`text-[10px] uppercase ${
                  selected ? "text-chalk-white/80" : "text-muted"
                }`}
              >
                {date.toLocaleDateString("en-IN", { month: "short" })}
              </span>
            </button>
          );
        })}
      </div>

      {/* Times for the selected day */}
      {loading ? (
        <div className="space-y-3 pb-4" aria-busy="true">
          {[0, 1, 2].map((g) => (
            <div key={g}>
              <div className="mb-2 h-3 w-20 animate-pulse rounded-pill bg-mist-navy/70" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 5 }, (_, c) => (
                  <div
                    key={c}
                    className="h-9 w-[76px] animate-pulse rounded-pill bg-mist-navy/70"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="pb-4">
          <Banner variant="error">
            <p className="text-caption">{loadError}</p>
          </Banner>
          <Button
            variant="secondary"
            fullWidth
            className="mt-3"
            onClick={() => void loadSlots()}
          >
            {strings.orderDetail.slotRetry}
          </Button>
        </div>
      ) : slots.length === 0 ? (
        <p className="rounded-card border border-hairline bg-warm-sand/60 px-4 py-6 text-center text-body text-muted">
          {strings.orderDetail.slotNoneDay}
        </p>
      ) : (
        <div className="space-y-4 pb-4">
          {PARTS_OF_DAY.map((part) => {
            const group = slots.filter((s) => {
              const h = parseInt(s.label.split(":")[0], 10);
              return h >= part.from && h < part.to;
            });
            if (group.length === 0) return null;
            return (
              <div key={part.key}>
                <p className="eyebrow mb-2">{part.label}</p>
                <div className="flex flex-wrap gap-2">
                  {group.map((s) => {
                    const selected = selectedSlot?.start_at === s.start_at;
                    return (
                      <button
                        key={s.start_at}
                        type="button"
                        onClick={() => setSelectedSlot(s)}
                        className={`min-h-[36px] rounded-pill border-[1.5px] px-3.5 text-caption font-medium transition ${
                          selected
                            ? "border-navy-interactive bg-navy-interactive text-chalk-white shadow-card"
                            : "border-hairline bg-chalk-white text-ink-navy hover:bg-mist-navy/40"
                        }`}
                      >
                        {to12h(s.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {bookError && (
        <Banner variant="error" className="mb-4">
          <p className="text-caption">{bookError}</p>
        </Banner>
      )}
    </BottomSheet>
  );
}
