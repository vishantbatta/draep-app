"use client";

/**
 * Confirmation — spec §6.12.
 *
 * Pure success screen rendered AFTER payment succeeds. The slot was
 * picked on /schedule (before payment) and is captured in draft.booking,
 * so this page needs no API calls — it just renders the summary.
 *
 * If draft.booking is missing (rare: user navigated directly to /confirmed
 * without scheduling), we still show a generic success message with the
 * order ID. The order is still valid; scheduling can happen later.
 *
 * Voice & tone per Brand Book: exact promises —
 *   "[Captain Name] will visit [Day], [Time]"
 * never "soon!".
 */

import { useMemo } from "react";
import Link from "next/link";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { Check, HomeVisit, Sparkle, Calendar } from "@/components/ui/icons";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";

export default function ConfirmedPage() {
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);

  const orderId = draft?.orderId;
  const paymentOrderId = draft?.payment?.orderId;
  const booking = draft?.booking;

  const displayOrderId = paymentOrderId
    ? paymentOrderId.slice(0, 8)
    : orderId
      ? orderId.slice(0, 8)
      : "——";

  const address = draft?.contact
    ? `${draft.contact.address1}${draft.contact.address2 ? `, ${draft.contact.address2}` : ""}, ${draft.contact.pincode}`
    : "";

  // Format the booking's scheduled_at into a readable visit line.
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

      {/* Booking summary — only if we have the booking captured from /schedule */}
      {booking && (
        <section className="mt-8 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <h2 className="font-heading text-h3 text-ink-navy">
            Your visit
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
          <h3 className="mt-4 font-heading text-h3 text-ink-navy">
            {strings.confirmed.summaryTitle}
          </h3>
          <ul className="mt-3 space-y-3">
            <Step
              icon={<HomeVisit size={16} />}
              body={`${captainLabel} will visit ${visitLabel}.`}
            />
            <Step icon={<Sparkle size={16} />} body={strings.confirmed.measureLine} />
            <Step icon={<Check size={16} />} body={strings.confirmed.deliveryLine} terminal />
          </ul>
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
