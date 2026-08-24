"use client";

/**
 * Schedule — slot picker that runs BEFORE payment.
 *
 * Flow: /contact → /schedule (this page) → /pay → /confirmed
 *
 * The customer picks a measurement-visit slot here. The booking is
 * created on the server (POST /orders/{id}/booking), captured in the
 * Zustand draft (draft.booking), and the customer proceeds to /pay.
 *
 * Refresh-resume: if draft.booking already exists (user navigated back),
 * we render the booking summary with "Change slot" / "Continue to payment".
 * If the user changes slot, we PATCH the booking and update the store.
 *
 * Voice & tone per Brand Book: exact promises —
 *   "[Captain Name] will visit [Day], [Time]"
 * never "soon!".
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { TapeProgress } from "@/components/layout/TapeProgress";
import { Button } from "@/components/ui/Button";
import { SlotPicker } from "@/components/confirmed/SlotPicker";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { Calendar, Check, Clock, HomeVisit } from "@/components/ui/icons";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { bookingApi } from "@/lib/api";
import type { Booking } from "@/types/booking";

export default function SchedulePage() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const setBooking = useBookingStore((s) => s.setBooking);

  // existingBooking = the booking captured on a prior visit to this page
  // (refresh-resume / back-navigation from /pay).
  const [existingBooking, setExistingBooking] = useState<Booking | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [rescheduling, setRescheduling] = useState(false);

  const orderId = draft?.orderId;
  const address = draft?.contact
    ? `${draft.contact.address1}${draft.contact.address2 ? `, ${draft.contact.address2}` : ""}, ${draft.contact.pincode}`
    : "";

  // On mount: check for an existing booking on this order (refresh-resume).
  // The store's draft.booking is the fast path; the GET is the source-of-
  // truth fallback for cross-device/cross-session resume.
  useEffect(() => {
    if (!hydrated || !orderId) return;
    let cancelled = false;

    // Fast path — draft already has the booking from a prior visit.
    if (draft?.booking) {
      setExistingBooking(draft.booking);
      setCheckingExisting(false);
      return;
    }

    const run = async () => {
      try {
        const b = await bookingApi.getBooking(orderId);
        if (!cancelled) {
          setExistingBooking(b);
          setBooking(b);
        }
      } catch {
        // 404 = no booking yet — normal first-visit case.
      } finally {
        if (!cancelled) setCheckingExisting(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, orderId]);

  const visitLabel = useMemo(() => {
    if (!existingBooking) return "";
    const d = new Date(existingBooking.scheduled_at);
    const day = d.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    const time = d.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${day}, ${time}`;
  }, [existingBooking]);

  const captainLabel = existingBooking?.captain_name
    ? existingBooking.captain_name
    : "Your Style Captain";

  // Draft hold: time picked, captain only assigned when payment confirms.
  const isDraftHold = existingBooking?.status === "draft";

  if (!hydrated || !draft) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  if (!orderId) {
    return (
      <ScreenShell className="pt-6">
        <div className="flex flex-col items-center text-center">
          <p className="text-body text-muted">
            We couldn&apos;t find your order. Please start again.
          </p>
          <Button onClick={() => router.push("/")} className="mt-4">
            Start over
          </Button>
        </div>
      </ScreenShell>
    );
  }

  const handleBooked = (b: Booking) => {
    setBooking(b);
    setExistingBooking(b);
    setRescheduling(false);
    track({
      event: b.status === "draft" ? "slot_held" : "slot_booked",
      job_id: b.job_id,
      captain: b.captain_name ?? (b.status === "draft" ? "unassigned" : "auto"),
    });
    // Proceed to payment once the slot is secured.
    router.push("/pay");
  };

  const showPicker = !existingBooking || rescheduling;

  return (
    <>
      <TapeProgress currentRoute="/review" />
      <ScreenShell className="pt-4">
        <p className="eyebrow">Visit details</p>
        <h1 className="font-heading text-h1 text-ink-navy">
          {strings.schedule.title}
        </h1>
        <p className="mt-2 text-body text-ink/85">{strings.schedule.body}</p>

        {/* Loading state while checking for existing booking */}
        {checkingExisting && !existingBooking && (
          <div className="mt-8 flex items-center justify-center py-8">
            <div className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
              <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
            </div>
          </div>
        )}

        {/* Slot picker — first visit OR rescheduling */}
        {showPicker && !checkingExisting && (
          <section className="mt-6">
            {rescheduling && (
              <div className="mb-3 flex items-center gap-2 rounded-card bg-warm-sand px-3 py-2 text-caption text-muted">
                <Calendar size={14} />
                Pick a new time — your current slot stays until you confirm.
              </div>
            )}
            <SlotPicker orderId={orderId} onBooked={handleBooked} />
            {rescheduling && (
              <button
                onClick={() => setRescheduling(false)}
                className="mt-3 w-full text-center text-caption text-muted underline"
              >
                {strings.schedule.keepSlot}
              </button>
            )}
          </section>
        )}

        {/* Existing booking summary — refresh-resume / back from /pay */}
        {existingBooking && !showPicker && (
          <section className="mt-6 space-y-4">
            <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 flex-none items-center justify-center rounded-pill ${
                    isDraftHold ? "bg-warm-sand text-accent-text" : "bg-success text-chalk-white"
                  }`}
                >
                  {isDraftHold ? <Clock size={20} strokeWidth={2.5} /> : <Check size={20} strokeWidth={3} />}
                </div>
                <div className="flex-1">
                  <p className={`eyebrow ${isDraftHold ? "text-accent-text" : "text-success"}`}>
                    {isDraftHold
                      ? strings.schedule.heldHeading
                      : strings.schedule.bookedHeading}
                  </p>
                  <p className="mt-1 font-heading text-h3 text-ink-navy">
                    {visitLabel}
                  </p>
                  <p className="mt-0.5 text-caption text-muted">
                    {isDraftHold ? strings.schedule.heldCaption : `with ${captainLabel}`}
                  </p>
                </div>
              </div>

              {address && (
                <div className="mt-3 flex items-start gap-3 rounded-card bg-warm-sand p-3">
                  <HomeVisit size={20} className="mt-1 text-accent-text" />
                  <div className="flex-1">
                    <p className="text-caption text-muted">Address</p>
                    <p className="text-body text-ink">{address}</p>
                  </div>
                </div>
              )}
            </div>

            <Button fullWidth onClick={() => router.push("/pay")}>
              {strings.schedule.continueCta}
            </Button>
            <button
              onClick={() => setRescheduling(true)}
              className="w-full text-center text-caption text-navy-interactive underline"
            >
              {strings.schedule.changeSlot}
            </button>
          </section>
        )}

        {/* Order ID footer */}
        {orderId && (
          <p className="mt-8 text-center text-caption text-muted">
            <span className="text-muted">Order ID</span>{" "}
            <MonoNumber className="font-mono text-ink-navy">
              {orderId.slice(0, 8)}
            </MonoNumber>
          </p>
        )}
      </ScreenShell>
    </>
  );
}
