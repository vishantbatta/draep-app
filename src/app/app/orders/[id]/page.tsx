"use client";

/**
 * /app/orders/{id} — the customer order detail page.
 *
 * Opened by tapping a dashboard card. Shows the full breakdown of the order
 * and each garment order: every selection and add-on as a crisp label → value
 * row with its price, the additive price summary (same math as the invoice),
 * the payment ledger, and the invoice download — which runs the exact PDF
 * generator the /invoice page uses, fetched from the same public invoice
 * endpoint.
 *
 * Every order ends in a pinned bottom bar whose state follows the address
 * and the visit, never the order status: attached (or a saved) address →
 * deliver-to card + Continue; no address at all → "Add delivery address"
 * routes to /app/orders/{id}/address, which saves the address AND attaches
 * it (PUT /orders/{id}/contact). Continue with no visit yet opens the
 * slot sheet — Select books the measurement visit (POST /orders/{id}/
 * booking; reschedules via PATCH when one exists) — after which the CTA
 * reads "Continue", which on a fresh unpaid order opens a method sheet:
 * online (free, straight to the gateway) or Cash on Delivery, which
 * confirms the booking immediately and adds the ₹50 advance fee — the CTA
 * then reads "Pay ₹<advance> in Advance" and the fee is waived if that
 * advance is captured before delivery. Placed orders also get invoice
 * actions above the bar.
 */

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { OrderStatusRows, StatusPill } from "@/components/order/OrderStatus";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import {
  ArrowLeft,
  Calendar,
  ChatBubble,
  Check,
  Clock,
  HomeVisit,
  MapPin,
  Plus,
  ShieldCheck,
  Sparkles,
  Thread,
} from "@/components/ui/icons";
import { ApiError, addressesApi, checkoutApi, ordersApi } from "@/lib/api";
import { loadCashfree } from "@/lib/cashfree";
import {
  displayOrderNumber,
  formatDate,
  slotVisitLabel,
  visitDateTimeLabel,
} from "@/lib/order-display";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { AddressForm } from "@/components/contact/AddressForm";
import { SlotSheet } from "@/components/order/SlotSheet";
import type { Booking } from "@/types/booking";
import type {
  Address,
  CustomerOrderDetail,
  OrderDetailItem,
} from "@/types/api";

/* ─── Row renderers ───────────────────────────────────────────────────────── */

/** One selection/add-on: label on the left, choice (+ price) on the right. */
function ItemRow({ item }: { item: OrderDetailItem }) {
  const placement = item.placement?.length ? ` · ${item.placement.join(" · ")}` : "";
  // Same fallbacks the admin breakdown uses — a stray unlabeled row still
  // reads, and a label-only row shows its price rather than an empty "—".
  const label = item.label ?? (item.type === "add_on" ? "Add-on" : "Selection");
  const value =
    item.value ?? ((item.price ?? 0) !== 0 ? `+ ${formatPrice(item.price ?? 0)}` : null);
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <span className="flex-none text-caption text-muted">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block text-body font-medium text-ink-navy">
          {value ?? "—"}
          {placement}
        </span>
        {item.value != null && (item.price ?? 0) !== 0 && (
          <span className="block text-caption text-muted">
            + {formatPrice(item.price ?? 0)}
          </span>
        )}
      </span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className={strong ? "font-heading text-body text-ink-navy" : "text-body text-ink/85"}>
        {label}
      </span>
      <span
        className={
          strong
            ? "font-heading font-semibold text-body text-ink-navy"
            : "font-mono text-data text-ink-navy"
        }
      >
        {value}
      </span>
    </div>
  );
}

/** One labeled job row in the home-visit card: label left, value right. */
function JobRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="flex-none text-caption text-muted">{label}</span>
      <span className="min-w-0 text-right text-body font-medium text-ink-navy">
        {children}
      </span>
    </div>
  );
}

/* ============================================================ */

// Preview amount for the pay-choice sheet (mirrors BE settings.cod_fee_rupees);
// the authoritative fee always comes back on the order's COD adjustment row.
const COD_FEE_PREVIEW = 50;

export default function OrderDetailPage() {
  // useSearchParams (?placed=1) needs a Suspense boundary during prerender;
  // the content below renders its own loading skeleton, so null suffices.
  return (
    <Suspense fallback={null}>
      <OrderDetailContent />
    </Suspense>
  );
}

function OrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  /* ── Address + slot finish flow: deliver-to card → Continue → slot sheet,
     then the Pay-to-Book CTA once a visit is booked ────────────────────── */
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [slotOpen, setSlotOpen] = useState(false);
  const [paying, setPaying] = useState(false);

  /* ── Pay-method choice sheet: online vs Cash on Delivery ──────────────── */
  const [payChoiceOpen, setPayChoiceOpen] = useState(false);
  const [codConfirmOpen, setCodConfirmOpen] = useState(false);
  const [choosingCod, setChoosingCod] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);

  /* ── Address picker + add-address sheets (Change button) ──────────────── */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Saved addresses feed the deliver-to card when the order has none
  // attached. Non-fatal — on failure the card just stays hidden and
  // Continue routes to the add-address page instead.
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    addressesApi
      .listAddresses()
      .then((list) => {
        if (!cancelled) setSavedAddresses(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detail]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setDetail(await ordersApi.getOrderDetail(id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err.message : strings.errors.generic);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Loading / error states ──────────────────────────────────────────── */
  if (loading) {
    return (
      <ScreenShell className="px-4 pt-6">
        <div className="space-y-3" aria-busy="true">
          <div className="h-8 w-40 animate-pulse rounded-pill bg-mist-navy/60" />
          <div className="h-24 animate-pulse rounded-card bg-mist-navy/60" />
          <div className="h-64 animate-pulse rounded-card bg-mist-navy/60" />
        </div>
      </ScreenShell>
    );
  }

  if (notFound || error || !detail) {
    return (
      <ScreenShell className="px-4 pt-6">
        <Link
          href="/app"
          className="inline-flex min-h-[44px] items-center gap-1 text-caption font-semibold text-navy-interactive"
        >
          <ArrowLeft size={16} />
          {strings.orderDetail.back}
        </Link>
        <div
          role="alert"
          className="mt-6 rounded-card border border-hairline bg-chalk-white p-6 text-center text-body text-error-text shadow-card"
        >
          {notFound ? strings.orderDetail.notFound : strings.orderDetail.loadError}
          {!notFound && error ? ` (${error})` : ""}
          <div className="mt-4">
            {!notFound && (
              <Button variant="secondary" onClick={() => void load()}>
                {strings.orderDetail.retry}
              </Button>
            )}
          </div>
        </div>
      </ScreenShell>
    );
  }

  /* ── Detail ──────────────────────────────────────────────────────────── */
  const isDraft = detail.fulfillment_status === "draft";
  // The slot drives the visit time; orders booked before slots were linked
  // (slot: null) still have it on the measurement job, so fall back there.
  const visit =
    slotVisitLabel(detail.slot) ??
    visitDateTimeLabel(
      (detail.measurement_jobs.find((j) => j.status !== "cancelled") ??
        detail.measurement_jobs[detail.measurement_jobs.length - 1])
        ?.scheduled_at ?? null,
    );
  const contact = detail.contact;
  const addressLine1 =
    typeof contact?.address_line_1 === "string" ? contact.address_line_1 : null;
  const cityLine = [
    typeof contact?.city === "string" ? contact.city : null,
    typeof contact?.pincode === "string" ? contact.pincode : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const orderAdjustments = detail.adjustments.filter((a) => a.amount !== 0);
  const payments = detail.transactions.filter(
    (t) =>
      (t.type === "payment" && t.status === "captured") ||
      (t.type === "refund" && (t.status === "captured" || t.status === "refunded")),
  );

  /* ── Deliver-to card: the attached address, else the first saved one ──── */
  const attached = Boolean(addressLine1);
  // The contact payload carries the attached address row's id — the picker
  // marks that row as the current selection.
  const attachedAddressId = typeof contact?.id === "string" ? contact.id : null;
  const savedPick = savedAddresses[0] ?? null;
  const deliverTo = attached
    ? {
        id: null as string | null,
        line1: addressLine1 ?? "",
        line2: typeof contact?.address_line_2 === "string" ? contact.address_line_2 : null,
        cityLine: [
          cityLine,
          typeof contact?.state === "string" ? contact.state : null,
        ]
          .filter(Boolean)
          .join(", "),
      }
    : savedPick?.address_line_1
      ? {
          id: savedPick.id,
          line1: savedPick.address_line_1,
          line2: savedPick.address_line_2,
          cityLine: [savedPick.city, savedPick.state, savedPick.pincode]
            .filter(Boolean)
            .join(", "),
        }
      : null;

  /* ── Booked visit — drives the slot sheet mode and the Pay CTA ───────── */
  // 'draft' is a held (unconfirmed) time — it preselects the sheet in PATCH
  // mode and shows the Pay CTA; the captain is assigned at payment.
  const activeJob =
    detail.measurement_jobs.find(
      (j) =>
        j.status === "draft" ||
        j.status === "scheduled" ||
        j.status === "in_progress" ||
        j.status === "needs_reassignment",
    ) ?? null;
  const hasActiveVisit = activeJob !== null;
  // The sheet only needs the scheduled instant to preselect the day and to
  // know it must PATCH (reschedule) instead of POST.
  const currentBooking: Booking | null =
    activeJob?.scheduled_at != null
      ? {
          job_id: activeJob.id,
          captain_id: null,
          captain_name: activeJob.captain_name,
          scheduled_at: activeJob.scheduled_at,
          status: (activeJob.status ?? "scheduled") as Booking["status"],
        }
      : null;
  const payAmount = detail.balance_due ?? (detail.total_price ?? 0);
  const paidUp = hasActiveVisit && payAmount <= 0;
  // Once the visit is a real booking (payment confirmed — no longer a
  // pre-payment draft hold), the address and slot are locked; changes go
  // through support.
  const bookingLocked =
    hasActiveVisit && (activeJob?.status !== "draft" || paidUp);

  /* ── COD — the ₹50 booking-advance fee row, waivable until delivery ────── */
  // The active fee is the order-level adjustment tagged source="cod"; it
  // renders in the summary automatically with the other adjustments.
  const codAdj = orderAdjustments.find((a) => a.source === "cod") ?? null;
  const codFee = codAdj?.amount ?? 0;
  const isDelivered = detail.fulfillment_status === "delivered";
  // Advance CTA: pay the total minus the fee while it can still be waived.
  const showCodCta = codAdj !== null && !isDelivered;
  const advanceAmount = showCodCta ? Math.max(payAmount - codFee, 0) : payAmount;
  // Fresh order, nothing paid yet (no online capture, no COD choice) → the
  // Pay button opens the method choice instead of going straight to the
  // gateway. Any payment already made → COD is off the table, pay directly.
  const offerPayChoice = !codAdj && !isDelivered && detail.paid_amount === 0;

  /* ── Pay ₹X to Book — Cashfree drop-in, then the paying page verifies ──── */
  const handlePay = async () => {
    if (paying) return;
    setPaying(true);
    setPlaceError(null);
    try {
      // Amount, name and phone are resolved server-side from the order —
      // the client only receives the session to open.
      const init = await checkoutApi.startOrderPayment(id);
      if (!init.payment_session_id) {
        throw new Error(strings.orderDetail.payInitError);
      }
      // Sandbox sessions (test-mode phones) need the SDK in sandbox mode;
      // live sessions need production — the SDK's default is sandbox.
      const cashfree = await loadCashfree(
        init.environment === "TEST" ? "sandbox" : "production",
      );
      try {
        await cashfree.checkout({
          paymentSessionId: init.payment_session_id,
          redirectTarget: "_modal",
        });
      } catch {
        // Modal dismissed or payment failed inside Cashfree — don't assume;
        // the paying page checks the server (and the gateway) before
        // declaring anything.
      }
      router.push(`/app/orders/${id}/paying`);
    } catch (err) {
      setPlaceError(
        err instanceof Error ? err.message : strings.orderDetail.payInitError,
      );
    } finally {
      setPaying(false);
    }
  };

  /* ── Cash on Delivery — confirm the booking now, add the ₹50 fee; the
     server confirms the order (draft hold → booked visit) and returns the
     refreshed totals, so the CTA becomes "Pay ₹<advance> in Advance" ───── */
  const handleChooseCod = async () => {
    if (choosingCod) return;
    setChoosingCod(true);
    setChoiceError(null);
    try {
      await checkoutApi.chooseCodPayment(id);
      setPayChoiceOpen(false);
      setCodConfirmOpen(false);
      await refreshDetail();
    } catch (err) {
      setChoiceError(
        err instanceof Error ? err.message : strings.payChoice.codError,
      );
    } finally {
      setChoosingCod(false);
    }
  };

  const handleContinue = async () => {
    if (placing || paying) return;
    if (!deliverTo) {
      // No address anywhere yet — the full-page form saves one and attaches it.
      router.push(`/app/orders/${id}/address`);
      return;
    }
    if (hasActiveVisit) {
      // Pay-to-book state (or already paid — nothing left to do here).
      return;
    }
    if (attached || !deliverTo.id) {
      setSlotOpen(true);
      return;
    }
    // Saved pick not attached yet — attach it, then straight into slot picking.
    setPlacing(true);
    setPlaceError(null);
    try {
      await ordersApi.attachOrderAddress(id, deliverTo.id);
      setSlotOpen(true);
    } catch (err) {
      setPlaceError(err instanceof Error ? err.message : strings.orderDetail.attachError);
    } finally {
      setPlacing(false);
    }
  };

  /* ── Address picker sheet ──────────────────────────────────────────────── */
  const refreshDetail = async () => {
    try {
      setDetail(await ordersApi.getOrderDetail(id));
    } catch {
      // picker already shows its own error; keep the current detail
    }
  };

  const handlePick = async (addrId: string) => {
    if (pickingId) return;
    if (addrId === attachedAddressId) {
      setPickerOpen(false);
      return;
    }
    setPickingId(addrId);
    setPickError(null);
    try {
      await ordersApi.attachOrderAddress(id, addrId);
      setPickerOpen(false);
      await refreshDetail();
    } catch (err) {
      setPickError(err instanceof Error ? err.message : strings.orderDetail.attachError);
    } finally {
      setPickingId(null);
    }
  };

  return (
    <ScreenShell className="px-4 pt-6">
      {/* Back + invoice + support */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/app"
          className="inline-flex min-h-[44px] items-center gap-1 text-caption font-semibold text-navy-interactive"
        >
          <ArrowLeft size={16} />
          {strings.orderDetail.back}
        </Link>
        <div className="flex items-center gap-2">
          {!isDraft && (
            <Link
              href={`/invoice/${detail.id}`}
              className="inline-flex min-h-[44px] items-center text-caption font-semibold text-navy-interactive"
            >
              {strings.orderDetail.viewInvoice}
            </Link>
          )}
          <a
            href="https://wa.me/918147497006"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-pill border-[1.5px] border-ink-navy px-3 text-caption font-semibold text-ink-navy transition-all duration-200 ease-brand hover:bg-mist-navy"
          >
            <ChatBubble size={16} />
            {strings.orderDetail.support}
          </a>
        </div>
      </div>

      {/* Header */}
      <header className="mt-2">
        <p className="eyebrow">{strings.orderDetail.title}</p>
        <h1 className="mt-1 font-heading text-h1 text-ink-navy">
          <MonoNumber>{displayOrderNumber(detail.order_number, detail.id)}</MonoNumber>
        </h1>
        {detail.created_at && (
          <p className="mt-1 text-caption text-muted">
            Placed {formatDate(detail.created_at)}
          </p>
        )}
      </header>

      {/* Statuses — separate labelled rows, like the dashboard cards */}
      <section className="mt-4 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <OrderStatusRows
          fulfillmentStatus={detail.fulfillment_status}
          paymentStatus={detail.payment_status}
        />
      </section>

      {/* Home visit + address + the style captain's measurement job(s) */}
      {(visit || addressLine1 || detail.measurement_jobs.length > 0) && (
        <section className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <p className="eyebrow">{strings.orderDetail.visitTitle}</p>
          {visit && (
            <div className="mt-2 flex items-start gap-2">
              <Calendar size={16} className="mt-0.5 text-accent-text" />
              <p className="text-body text-ink">{visit}</p>
            </div>
          )}
          {addressLine1 && (
            <div className="mt-2 flex items-start gap-2">
              <MapPin size={16} className="mt-0.5 text-accent-text" />
              <p className="text-body text-ink">
                {addressLine1}
                {typeof contact?.address_line_2 === "string" &&
                  contact.address_line_2 &&
                  `, ${contact.address_line_2}`}
                {cityLine && (
                  <>
                    <br />
                    <span className="text-caption text-muted">{cityLine}</span>
                  </>
                )}
              </p>
            </div>
          )}
          {detail.measurement_jobs.map((job) => (
            <div key={job.id} className="mt-3 border-t border-hairline pt-1">
              {job.status && (
                <div className="flex items-center justify-between gap-3 py-1">
                  <span className="text-caption text-muted">
                    {strings.orderDetail.visitStatusLabel}
                  </span>
                  <StatusPill status={job.status} kind="fulfillment" />
                </div>
              )}
              <JobRow label={strings.orderDetail.captainLabel}>
                {job.captain_name ?? strings.orderDetail.captainUnassigned}
              </JobRow>
              {job.completed_at && (
                <JobRow label={strings.orderDetail.completedLabel}>
                  {visitDateTimeLabel(job.completed_at)}
                </JobRow>
              )}
              {job.notes && (
                <JobRow label={strings.orderDetail.notesLabel}>{job.notes}</JobRow>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Garment orders — the full breakdown */}
      {detail.garment_orders.map((g, gi) => {
        const selections = g.items.filter((i) => i.type === "selection");
        const addons = g.items.filter((i) => i.type === "add_on");
        return (
          <section
            key={g.id}
            className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-h3 text-ink-navy">
                {g.garment_label ?? "Garment"}
                {detail.garment_orders.length > 1 ? ` ${gi + 1}` : ""}
              </h2>
              {g.status && <StatusPill status={g.status} kind="fulfillment" />}
            </div>

            {selections.length > 0 && (
              <>
                <p className="eyebrow mt-4">{strings.orderDetail.selectionsTitle}</p>
                <div className="mt-1">
                  {selections.map((item, idx) => (
                    <ItemRow key={idx} item={item} />
                  ))}
                </div>
              </>
            )}

            {addons.length > 0 && (
              <>
                <p className="eyebrow mt-4">{strings.orderDetail.addonsTitle}</p>
                <div className="mt-1">
                  {addons.map((item, idx) => (
                    <ItemRow key={idx} item={item} />
                  ))}
                </div>
              </>
            )}

            {g.user_note && (
              <div className="mt-4 flex items-start gap-2 rounded-card bg-warm-sand/70 p-3">
                <Thread size={16} className="mt-0.5 text-accent-text" />
                <p className="flex-1 text-body text-ink">
                  <span className="text-caption text-muted">
                    {strings.orderDetail.noteTitle} —{" "}
                  </span>
                  {g.user_note}
                </p>
              </div>
            )}

            <div className="mt-4 border-t border-hairline pt-2">
              <SummaryRow
                label={strings.orderDetail.basePrice}
                value={formatPrice(g.base_price ?? 0)}
              />
              <SummaryRow
                label={strings.orderDetail.garmentTotal}
                value={formatPrice(g.total_price ?? 0)}
                strong
              />
            </div>
          </section>
        );
      })}

      {/* Order-level adjustments + payment summary */}
      <section className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <p className="eyebrow">{strings.orderDetail.summaryTitle}</p>
        <div className="mt-2">
          {orderAdjustments.map((a, idx) => (
            <SummaryRow
              key={idx}
              label={a.label ?? (a.type === "discount" ? "Discount" : "Adjustment")}
              value={`${a.amount < 0 ? "−" : "+"}${formatPrice(Math.abs(a.amount))}`}
            />
          ))}
          <SummaryRow
            label={strings.orderDetail.total}
            value={formatPrice(detail.total_price ?? 0)}
            strong
          />
          <SummaryRow
            label={strings.orderDetail.paid}
            value={formatPrice(detail.paid_amount)}
          />
          <SummaryRow
            label={strings.orderDetail.balanceDue}
            value={formatPrice(detail.balance_due)}
          />
        </div>
      </section>

      {/* Payment ledger */}
      {payments.length > 0 && (
        <section className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <p className="eyebrow">{strings.orderDetail.paymentsTitle}</p>
          <div className="mt-2">
            {payments.map((t) => {
              const isRefund = t.type === "refund";
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-ink-navy">
                      {isRefund ? strings.orderDetail.refund : "Payment"}
                    </span>
                    <span className="block text-caption text-muted">
                      {strings.orderDetail.paymentMethod(t.method)}
                      {t.captured_at || t.refunded_at || t.created_at
                        ? ` · ${formatDate(
                            (t.captured_at ?? t.refunded_at ?? t.created_at) as string,
                          )}`
                        : ""}
                    </span>
                  </span>
                  <span className="font-mono text-data text-ink-navy">
                    {isRefund ? "−" : "+"}
                    {formatPrice(t.amount ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Address bar — pinned to the viewport bottom. Its state follows the
          attached/saved address only, never the order status. Fully paid →
          nothing left to do down here, so the whole bar (card included)
          goes away. */}
      {!paidUp && (
      <div className="sticky bottom-0 z-20 -mx-4 -mb-6 mt-5 border-t border-hairline bg-chalk-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_16px_-8px_rgba(23,42,72,0.25)]">
        {/* Deliver-to card — food-app style, above the Continue button */}
        {deliverTo && (
          <div className="rounded-card border border-hairline bg-chalk-white p-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
              >
                <MapPin size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-ink-navy">
                  {deliverTo.line1}
                </p>
                {(deliverTo.line2 || deliverTo.cityLine) && (
                  <p className="text-caption text-muted">
                    {[deliverTo.line2, deliverTo.cityLine].filter(Boolean).join(", ")}
                  </p>
                )}
                {currentBooking && (
                  <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
                    <Clock size={14} className="flex-none text-muted" />
                    <p className="text-caption font-medium text-ink-navy">
                      {visitDateTimeLabel(currentBooking.scheduled_at)}
                    </p>
                  </div>
                )}
              </div>
                {!bookingLocked && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="flex-none rounded-pill px-2 py-1 text-caption font-semibold text-navy-interactive transition hover:bg-mist-navy"
                  >
                    {strings.orderDetail.changeAddress}
                  </button>
                )}
            </div>
          </div>
        )}

        {placeError && (
          <Banner variant="error" className="mt-3">
            <p className="text-caption">{placeError}</p>
          </Banner>
        )}

        {!paidUp && (
          <Button
            fullWidth
            className="mt-3"
            loading={placing || paying}
            disabled={placing || paying}
            onClick={() => {
              if (hasActiveVisit) {
                if (offerPayChoice) {
                  setPayChoiceOpen(true);
                } else {
                  void handlePay();
                }
              } else {
                void handleContinue();
              }
            }}
          >
            {!deliverTo
              ? strings.orderDetail.addAddressCta
              : hasActiveVisit
                ? showCodCta
                  ? (
                      <>
                        {strings.orderDetail.payInAdvance(
                          formatPrice(advanceAmount),
                        )}{" "}
                        <span className="ml-1 inline-block rounded-pill bg-ink-navy px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-chalk-white">
                          {strings.orderDetail.saveTag(formatPrice(codFee))}
                        </span>
                      </>
                    )
                  : strings.orderDetail.continueCta
                : strings.orderDetail.continueCta}
          </Button>
        )}
        {!bookingLocked && hasActiveVisit && deliverTo && (
          <button
            type="button"
            onClick={() => setSlotOpen(true)}
            className="mt-2 w-full py-1 text-center text-caption font-semibold text-navy-interactive underline"
          >
            {strings.orderDetail.changeSlot}
          </button>
        )}
      </div>
      )}

      {/* Address picker — Change opens this; rows attach on tap */}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={strings.orderDetail.addressPageTitle}
      >
        <div className="pb-2">
          {savedAddresses.map((addr) => {
            const selected = addr.id === attachedAddressId;
            const picking = pickingId === addr.id;
            return (
              <button
                key={addr.id}
                type="button"
                disabled={pickingId !== null}
                onClick={() => void handlePick(addr.id)}
                className={`mt-3 flex w-full items-start gap-3 rounded-card border-[1.5px] p-4 text-left transition ${
                  selected
                    ? "border-navy-interactive bg-mist-navy/50"
                    : "border-hairline bg-chalk-white hover:bg-mist-navy/30"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill ${
                    selected
                      ? "bg-navy-interactive text-chalk-white"
                      : "bg-warm-sand text-accent-text"
                  }`}
                >
                  {selected ? <Check size={16} /> : <MapPin size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-ink-navy">
                    {addr.address_line_1}
                  </p>
                  {addr.address_line_2 && (
                    <p className="text-caption text-muted">{addr.address_line_2}</p>
                  )}
                  <p className="mt-0.5 text-caption text-muted">
                    {[addr.city, addr.state, addr.pincode].filter(Boolean).join(", ")}
                  </p>
                </div>
                {picking && (
                  <span className="flex-none text-caption text-muted">
                    {strings.orderDetail.selecting}
                  </span>
                )}
              </button>
            );
          })}

          {pickError && (
            <Banner variant="error" className="mt-3">
              <p className="text-caption">{pickError}</p>
            </Banner>
          )}

          {/* Add new address — opens the add sheet stacked above this one */}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-card border border-dashed border-hairline-strong bg-chalk-white/70 p-4 text-left transition hover:bg-mist-navy/40"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-mist-navy text-ink-navy"
            >
              <Plus size={16} />
            </span>
            <p className="text-body font-medium text-navy-interactive">
              {strings.orderDetail.addNewAddress}
            </p>
          </button>
        </div>
      </BottomSheet>

      {/* Add address — the same shared form as the account page; saving
          returns to the picker, which now lists the new address */}
      <BottomSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={strings.account.addAddressTitle}
      >
        <AddressForm
          active={addOpen}
          saveAddress={(fields, pin) =>
            addressesApi.createAddress({
              address_line_1: fields.address_line_1,
              address_line_2: fields.address_line_2 || null,
              city: fields.city,
              state: fields.state,
              pincode: fields.pincode,
              coordinates: pin,
            })
          }
          onSaved={(addr) => {
            if (addr) {
              setSavedAddresses((list) => [...list, addr]);
              setAddOpen(false);
            }
          }}
        />
      </BottomSheet>

      {/* Slot picker — Continue (or Change slot) opens this; Select books
          (or reschedules) the measurement visit, then the CTA becomes
          "Continue" once the refreshed detail lands */}
      <SlotSheet
        open={slotOpen}
        onClose={() => setSlotOpen(false)}
        orderId={id}
        currentBooking={currentBooking}
        onBooked={() => {
          setSlotOpen(false);
          void refreshDetail();
        }}
        onAlreadyBooked={() => {
          setSlotOpen(false);
          void refreshDetail();
        }}
      />

      {/* Pay-method choice — Pay opens this on a fresh unpaid order. Online
          (free) goes straight to the gateway; Cash on Delivery confirms the
          booking right away and adds the ₹50 advance fee, which is waived
          if the advance is paid before delivery. */}
      <BottomSheet
        open={payChoiceOpen}
        onClose={() => setPayChoiceOpen(false)}
        title={strings.payChoice.title}
      >
        <div className="pb-2">
          <button
            type="button"
            disabled={choosingCod}
            onClick={() => {
              setPayChoiceOpen(false);
              void handlePay();
            }}
            className="flex w-full items-center gap-3 rounded-card border-[1.5px] border-hairline bg-chalk-white p-4 text-left transition hover:bg-mist-navy/30 disabled:opacity-50"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <ShieldCheck size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink-navy">
                {strings.payChoice.onlineLabel}
              </span>
              <span className="block text-caption text-muted">
                {strings.payChoice.onlineCaption}
              </span>
            </span>
            <span className="flex-none rounded-pill bg-success-bg px-2.5 py-1 text-caption font-semibold text-success-text">
              {strings.payChoice.onlineTag}
            </span>
          </button>

          <button
            type="button"
            disabled={choosingCod}
            onClick={() => setCodConfirmOpen(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-card border-[1.5px] border-hairline bg-chalk-white p-4 text-left transition hover:bg-mist-navy/30 disabled:opacity-50"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <HomeVisit size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink-navy">
                {strings.payChoice.codLabel}
              </span>
              <span className="block text-caption text-muted">
                {strings.payChoice.codCaption}
              </span>
            </span>
            <span className="flex-none rounded-pill bg-warm-sand/80 px-2.5 py-1 text-caption font-semibold text-accent-text">
              {strings.payChoice.codTag(formatPrice(COD_FEE_PREVIEW))}
            </span>
          </button>
        </div>
      </BottomSheet>

      {/* COD soft-confirm — stacks above the choice sheet. The case for
          paying online (fee waived, no dummy bookings, refundable) before
          the customer commits to Cash on Delivery. */}
      <BottomSheet
        open={codConfirmOpen}
        onClose={() => setCodConfirmOpen(false)}
        title={strings.payChoice.codSheetTitle}
      >
        <div className="pb-2">
          <div className="mt-2 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <Sparkles size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink-navy">
                {strings.payChoice.codSheetSaveTitle(formatPrice(COD_FEE_PREVIEW))}
              </p>
              <p className="text-caption text-muted">
                {strings.payChoice.codSheetSaveBody}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <Calendar size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink-navy">
                {strings.payChoice.codSheetHonestTitle}
              </p>
              <p className="text-caption text-muted">
                {strings.payChoice.codSheetHonestBody}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <ShieldCheck size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink-navy">
                {strings.payChoice.codSheetRefundTitle}
              </p>
              <p className="text-caption text-muted">
                {strings.payChoice.codSheetRefundBody}
              </p>
            </div>
          </div>

          {choiceError && (
            <Banner variant="error" className="mt-3">
              <p className="text-caption">{choiceError}</p>
            </Banner>
          )}

          <Button
            fullWidth
            className="mt-4"
            disabled={choosingCod}
            onClick={() => {
              setCodConfirmOpen(false);
              setPayChoiceOpen(false);
              void handlePay();
            }}
          >
            {strings.payChoice.codSheetOnlineCta}
          </Button>
          <Button
            variant="secondary"
            fullWidth
            className="mt-2"
            loading={choosingCod}
            disabled={choosingCod}
            onClick={() => void handleChooseCod()}
          >
            {strings.payChoice.codSheetConfirmCta}
          </Button>
        </div>
      </BottomSheet>
    </ScreenShell>
  );
}
