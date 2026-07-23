"use client";

/**
 * Confirmation — spec §6.12.
 *
 * Success state: green tick, Booking confirmed H1, order ID in mono.
 * 3-hour home-visit slot picker. Confirm slot → summary card: slot, address,
 * what happens next (Style Captain visit explained in one line each, tick bullets).
 *
 * Voice & tone per Brand Book: exact promises — "Your Style Captain will arrive
 * Saturday, 6–9 PM", never "soon!".
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
import { VISIT_SLOT_WINDOWS } from "@/lib/pricing-config";
import { checkoutApi } from "@/lib/api";

export default function ConfirmedPage() {
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const setSlot = useBookingStore((s) => s.setSlot);
  const setPayment = useBookingStore((s) => s.setPayment);

  const [selectedDate, setSelectedDate] = useState<string | undefined>(draft?.slot?.date);
  const [selectedWindow, setSelectedWindow] = useState<string | undefined>(draft?.slot?.window);
  const [confirmed, setConfirmed] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // On mount: if we have an orderId but no payment record, verify the payment
  // status from the server (handles page refresh mid-payment)
  const serverOrderId = draft?.orderId;
  const paymentStatus = draft?.payment?.status;
  useEffect(() => {
    if (!hydrated || !serverOrderId || paymentStatus === "paid") return;
    let cancelled = false;
    setVerifying(true);
    checkoutApi
      .getOrderStatus(serverOrderId)
      .then((status) => {
        if (cancelled) return;
        if (status.payment_status === "paid") {
          setPayment({ orderId: serverOrderId, status: "paid" });
        }
      })
      .catch(() => {
        // Non-fatal — user can retry
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => { cancelled = true; };
  }, [hydrated, serverOrderId, paymentStatus, setPayment]);

  useEffect(() => {
    if (hydrated && draft?.slot) {
      setSelectedDate(draft.slot.date);
      setSelectedWindow(draft.slot.window);
      setConfirmed(true);
    }
  }, [hydrated, draft?.slot]);

  const orderId = draft?.payment?.orderId ?? "DRP-——";
  const address = draft?.contact
    ? `${draft.contact.address1}${draft.contact.address2 ? `, ${draft.contact.address2}` : ""}, ${draft.contact.pincode}`
    : "";

  const dateLabel = useMemo(() => {
    if (!selectedDate) return "";
    const d = new Date(selectedDate);
    return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  }, [selectedDate]);

  const windowLabel = VISIT_SLOT_WINDOWS.find((w) => w.id === selectedWindow)?.label ?? "";

  if (!hydrated || !draft) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  const handleConfirmSlot = () => {
    if (!selectedDate || !selectedWindow) return;
    setSlot({ date: selectedDate, window: selectedWindow });
    setConfirmed(true);
    track({ event: "slot_selected", date: selectedDate, window: selectedWindow });
  };

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
            {orderId}
          </MonoNumber>
        </div>
      </div>

      {!confirmed && (
        <section className="mt-8">
          <h2 className="font-heading text-h2 text-ink-navy">
            {strings.confirmed.pickSlotTitle}
          </h2>
          <div className="mt-4">
            <SlotPicker
              selectedDate={selectedDate}
              selectedWindow={selectedWindow}
              onSelectDate={setSelectedDate}
              onSelectWindow={setSelectedWindow}
            />
          </div>
          <Button
            onClick={handleConfirmSlot}
            disabled={!selectedDate || !selectedWindow}
            fullWidth
            className="mt-5"
          >
            {strings.confirmed.confirmSlot}
          </Button>
        </section>
      )}

      {confirmed && selectedDate && selectedWindow && (
        <section className="mt-8 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <h2 className="font-heading text-h3 text-ink-navy">
            {strings.confirmed.summaryTitle}
          </h2>

          {/* Slot */}
          <div className="mt-3 flex items-start gap-3 rounded-card bg-warm-sand p-3">
            <Calendar size={20} className="mt-1 text-accent-text" />
            <div className="flex-1">
              <p className="text-caption text-muted">Visit slot</p>
              <p className="font-heading text-h3 text-ink-navy">
                {strings.confirmed.captainLine(dateLabel, windowLabel)}
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
            <Step icon={<HomeVisit size={16} />} body={strings.confirmed.captainLine(dateLabel, windowLabel)} />
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
