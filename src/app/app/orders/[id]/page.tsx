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
 * Every order ends in a pinned address bar whose state follows the address
 * only, never the order status: attached (or a saved) address → deliver-to
 * card + Continue; no address at all → "Add delivery address" routes to
 * /app/orders/{id}/address, which saves the address AND attaches it (PUT
 * /orders/{id}/contact). Continue attaches a saved pick (PUT
 * /orders/{id}/address) and shows the dummy "order placed" state. Placed
 * orders also get invoice actions above the bar.
 */

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

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
  MapPin,
  Plus,
  Thread,
} from "@/components/ui/icons";
import { ApiError, addressesApi, ordersApi } from "@/lib/api";
import {
  displayOrderNumber,
  formatDate,
  slotVisitLabel,
  visitDateTimeLabel,
} from "@/lib/order-display";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { generateInvoicePdf, type InvoiceInput } from "@/lib/invoice-pdf";
import { AddressForm } from "@/components/contact/AddressForm";
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
  const searchParams = useSearchParams();

  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  /* ── Address finish flow: deliver-to card + Continue + placed state ───── */
  const [placed, setPlaced] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);

  /* ── Address picker + add-address sheets (Change button) ──────────────── */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // ?placed=1 — landing back after saving an address on the full-page form.
  useEffect(() => {
    if (searchParams.get("placed") === "1") setPlaced(true);
  }, [searchParams]);

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

  /* ── Invoice download — same data + generator as the /invoice page ────── */
  async function handleDownloadInvoice() {
    setInvoiceBusy(true);
    setInvoiceError(null);
    try {
      const res = await fetch(`/api/v1/public/invoice/${id}`);
      if (!res.ok) throw new Error(strings.orderDetail.invoiceError);
      const input = (await res.json()) as InvoiceInput;
      await generateInvoicePdf(input);
    } catch {
      setInvoiceError(strings.orderDetail.invoiceError);
    } finally {
      setInvoiceBusy(false);
    }
  }

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

  /* ── Dummy "order placed" state — shown after Continue completes ────── */
  if (placed) {
    return (
      <ScreenShell className="px-4 pt-6">
        <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
          <span
            aria-hidden
            className="flex h-20 w-20 items-center justify-center rounded-pill bg-success-bg text-success-text"
          >
            <Check size={36} />
          </span>
          <h1 className="mt-6 font-heading text-h1 text-ink-navy">
            {strings.orderDetail.placedTitle}
          </h1>
          <p className="mt-1 text-caption text-muted">
            <MonoNumber>{displayOrderNumber(detail.order_number, detail.id)}</MonoNumber>
          </p>
          <p className="mt-3 max-w-[34ch] text-body text-ink/85">
            {strings.orderDetail.placedBody}
          </p>
          <Button fullWidth className="mt-8" onClick={() => router.push("/app")}>
            {strings.orderDetail.viewOrders}
          </Button>
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

  const handleContinue = async () => {
    if (placing) return;
    if (!deliverTo) {
      // No address anywhere yet — the full-page form saves one and attaches it.
      router.push(`/app/orders/${id}/address`);
      return;
    }
    if (attached || !deliverTo.id) {
      setPlaced(true);
      return;
    }
    setPlacing(true);
    setPlaceError(null);
    try {
      await ordersApi.attachOrderAddress(id, deliverTo.id);
      setPlaced(true);
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
      {/* Back + support — WhatsApp chat with the team */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/app"
          className="inline-flex min-h-[44px] items-center gap-1 text-caption font-semibold text-navy-interactive"
        >
          <ArrowLeft size={16} />
          {strings.orderDetail.back}
        </Link>
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

      {/* Invoice actions — placed orders */}
      {!isDraft && (
        <div className="mt-5 space-y-2">
          <Button
            fullWidth
            loading={invoiceBusy}
            disabled={invoiceBusy}
            onClick={() => void handleDownloadInvoice()}
          >
            {invoiceBusy
              ? strings.orderDetail.invoiceBusy
              : strings.orderDetail.downloadInvoice}
          </Button>
          <Link
            href={`/invoice/${detail.id}`}
            className="block py-1 text-center text-caption font-semibold text-navy-interactive underline"
          >
            {strings.orderDetail.viewInvoice}
          </Link>
          {invoiceError && (
            <p className="text-center text-caption text-error-text" role="alert">
              {invoiceError}
            </p>
          )}
        </div>
      )}

      {/* Address bar — pinned to the viewport bottom. Its state follows the
          attached/saved address only, never the order status. */}
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
                <p className="text-caption font-semibold text-muted">
                  {strings.orderDetail.deliverTo}
                </p>
                <p className="mt-0.5 text-body font-medium text-ink-navy">
                  {deliverTo.line1}
                </p>
                {(deliverTo.line2 || deliverTo.cityLine) && (
                  <p className="text-caption text-muted">
                    {[deliverTo.line2, deliverTo.cityLine].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex-none rounded-pill px-2 py-1 text-caption font-semibold text-navy-interactive transition hover:bg-mist-navy"
                >
                  {strings.orderDetail.changeAddress}
                </button>
            </div>
          </div>
        )}

        {placeError && (
          <Banner variant="error" className="mt-3">
            <p className="text-caption">{placeError}</p>
          </Banner>
        )}

        <Button
          fullWidth
          className="mt-3"
          loading={placing}
          disabled={placing}
          onClick={() => void handleContinue()}
        >
          {deliverTo ? strings.orderDetail.continueCta : strings.orderDetail.addAddressCta}
        </Button>
      </div>

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
    </ScreenShell>
  );
}
