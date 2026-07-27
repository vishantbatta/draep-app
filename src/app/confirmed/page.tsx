"use client";

/**
 * Confirmation — spec §6.12.
 *
 * Success state: green tick, Booking confirmed H1, order ID in mono.
 * Real BE-backed slot picker (GET /orders/{id}/slots → POST /orders/{id}/booking).
 * After booking: summary card with captain name + scheduled time + address.
 *
 * Voice & tone per Brand Book: exact promises —
 *   "[Captain Name] will visit [Day], [Time]"
 * never "soon!".
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { Button } from "@/components/ui/Button";
import { SlotPicker } from "@/components/confirmed/SlotPicker";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { Check, HomeVisit, Sparkle, Calendar } from "@/components/ui/icons";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { bookingApi, checkoutApi } from "@/lib/api";
import type { Booking } from "@/types/booking";

export default function ConfirmedPage() {
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const setPayment = useBookingStore((s) => s.setPayment);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [rescheduling, setRescheduling] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const orderId = draft?.orderId;
  const paymentOrderId = draft?.payment?.orderId;
  const paymentStatus = draft?.payment?.status;

  // On mount: verify payment status if needed, then check for existing booking
  useEffect(() => {
    if (!hydrated || !orderId) return;
    let cancelled = false;

    const run = async () => {
      // Step 1: Verify payment if not already confirmed
      if (paymentStatus !== "paid" && paymentOrderId) {
        setVerifying(true);
        try {
          const status = await checkoutApi.getOrderStatus(paymentOrderId);
          if (cancelled) return;
          if (status.payment_status === "paid") {
            setPayment({ orderId: paymentOrderId, status: "paid" });
          }
        } catch {
          // Non-fatal — user can retry
        } finally {
          if (!cancelled) setVerifying(false);
        }
      }

      // Step 2: Check for existing booking (refresh-resume case)
      try {
        const existing = await bookingApi.getBooking(orderId);
        if (!cancelled) setBooking(existing);
      } catch {
        // 404 = no booking yet, which is the normal first-visit case
      } finally {
        if (!cancelled) setCheckingExisting(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [hydrated, orderId, paymentOrderId, paymentStatus, setPayment]);

  const displayOrderId = draft?.payment?.orderId ?? "DRP-——";
  const address = draft?.contact
    ? `${draft.contact.address1}${draft.contact.address2 ? `, ${draft.contact.address2}` : ""}, ${draft.contact.pincode}`
    : "";

  // Format the booking's scheduled_at into a readable visit line
  const visitLabel = useMemo(() => {
    if (!booking) return "";
    const d = new Date(booking.scheduled_at);
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
  }, [booking]);

  const captainLabel = booking?.captain_name
    ? booking.captain_name
    : "Your Style Captain";

  if (!hydrated || !draft) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  // No orderId means something went wrong — send back to style selection
  if (!orderId) {
    return (
      <ScreenShell className="pt-6">
        <div className="flex flex-col items-center text-center">
          <p className="text-body text-muted">
            We couldn&apos;t find your order. Please start again.
          </p>
          <Link
            href="/style"
            className="mt-4 rounded-pill bg-tape px-5 py-2.5 text-body font-semibold text-chalk-white"
          >
            Design your blouse
          </Link>
        </div>
      </ScreenShell>
    );
  }

  const handleBooked = (b: Booking) => {
    setBooking(b);
    setRescheduling(false);
    track({
      event: "slot_booked",
      job_id: b.job_id,
      captain: b.captain_name ?? "auto",
    });
  };

  const showPicker = !booking || rescheduling;

  return (
    <ScreenShell className="pt-6">
      {/* Success header — brand handshake: navy + orange */}
      <div className="flex flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-pill bg-success text-chalk-white shadow-card">
          <Check size={32} strokeWidth={3} />
        </div>
        <p className="eyebrow mt-3">Confirmed</p>
        <h1 className="mt-1 font-heading text-h1 text-ink-navy">
          {strings.confirmed.title}
        </h1>
        <p className="mt-2 text-body text-ink/85">{strings.confirmed.body}</p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-pill bg-mist-navy px-3 py-1.5">
          <span className="text-caption text-muted">{strings.confirmed.orderId}</span>
          <MonoNumber className="text-data font-semibold text-ink-navy">
            {displayOrderId}
          </MonoNumber>
        </div>
      </div>

      {/* Loading state while checking for existing booking */}
      {(checkingExisting || verifying) && !booking && (
        <div className="mt-8 flex items-center justify-center py-8">
          <div className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
            <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
          </div>
        </div>
      )}

      {/* Slot picker — shown when no booking yet OR rescheduling */}
      {showPicker && !checkingExisting && orderId && (
        <section className="mt-8">
          <h2 className="font-heading text-h2 text-ink-navy">
            {rescheduling ? "Pick a new time" : strings.confirmed.pickSlotTitle}
          </h2>
          <div className="mt-4">
            <SlotPicker orderId={orderId} onBooked={handleBooked} />
          </div>
          {rescheduling && (
            <button
              onClick={() => setRescheduling(false)}
              className="mt-3 w-full text-center text-caption text-muted underline"
            >
              Keep my current slot
            </button>
          )}
        </section>
      )}

      {/* Booking confirmation card */}
      {booking && !showPicker && (
        <section className="mt-8 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <h2 className="font-heading text-h3 text-ink-navy">
            {strings.confirmed.summaryTitle}
          </h2>

          {/* Slot */}
          <div className="mt-3 flex items-start gap-3 rounded-card bg-warm-sand p-3">
            <Calendar size={20} className="mt-1 text-accent-text" />
            <div className="flex-1">
              <p className="text-caption text-muted">Visit</p>
              <p className="font-heading text-h3 text-ink-navy">
                {visitLabel}
              </p>
              <p className="mt-0.5 text-caption text-muted">
                with {captainLabel}
              </p>
            </div>
          </div>

          {/* Address */}
          {address && (
            <div className="mt-2 flex items-start gap-3 rounded-card bg-warm-sand p-3">
              <HomeVisit size={20} className="mt-1 text-accent-text" />
              <div className="flex-1">
                <p className="text-caption text-muted">Address</p>
                <p className="text-body text-ink">{address}</p>
              </div>
            </div>
          )}

          {/* What happens next — tick bullets */}
          <ul className="mt-4 space-y-3">
            <Step
              icon={<HomeVisit size={16} />}
              body={`${captainLabel} will visit ${visitLabel}.`}
            />
            <Step icon={<Sparkle size={16} />} body={strings.confirmed.measureLine} />
            <Step icon={<Check size={16} />} body={strings.confirmed.deliveryLine} terminal />
          </ul>

          {/* Reschedule */}
          <Button
            variant="secondary"
            fullWidth
            className="mt-4"
            onClick={() => setRescheduling(true)}
          >
            Reschedule
          </Button>
        </section>
      )}

      <p className="mt-8 text-center text-caption text-muted">
        Need to change something?{" "}
        <Link href="/review" className="text-navy-interactive underline">
          Edit your design
        </Link>
      </p>
    </ScreenShell>
  );
}

function Step({
  icon,
  body,
  terminal,
}: {
  icon: React.ReactNode;
  body: string;
  terminal?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-pill bg-accent-fill text-chalk-white"
      >
        {icon}
      </span>
      <span className="flex-1 text-body text-ink">{body}</span>
      {terminal && (
        <span aria-hidden className="mt-2 h-2 w-2 flex-none rounded-full bg-accent-fill" />
      )}
    </li>
  );
}
